/**
 * Where the unwrapped master key lives between page loads.
 *
 * THE PROBLEM THIS SOLVES
 *
 * The key is derived from the password, and the password is typed once. If the key lived only in a
 * variable, every reload - every accidental refresh, every restored tab, every follow of a link back
 * into the application - would be a password prompt, and a password prompt that appears that often
 * is one people learn to type through without reading. That is a worse outcome than the one it was
 * meant to avoid.
 *
 * WHY INDEXEDDB AND NOT localStorage OR sessionStorage
 *
 * A CryptoKey is a structured-cloneable handle, and IndexedDB is the only web storage that can hold
 * one. That distinction is the whole point: what is stored is a key that was imported as
 * non-extractable, so a script that reaches it can ask the browser to decrypt with it but cannot
 * read its bytes or send it anywhere. In localStorage the key would have to be stored as bytes, and
 * bytes are what an injected script exfiltrates in one line. The access token was moved out of
 * localStorage for exactly this reason - see access-token.ts - and putting the key that opens
 * everything back in there would undo more than that move gained.
 *
 * WHAT IT IS STILL WORTH
 *
 * Nothing here defends against a script that is running on this page right now: such a script can
 * decrypt whatever it likes for as long as it runs. What it defends against is the key outliving
 * that: being copied, being read out of a backup of the profile, or being lifted by a script that
 * runs later. And it is bound to a session - the record is deleted whenever the session ends, and
 * it is useless on its own, because reaching the ciphertext at all needs the refresh cookie the
 * server holds the other half of.
 */

const DATABASE = 'premovedprep-vault';
const STORE = 'keys';
const RECORD = 'master';

/** The key, and which account and key generation it belongs to. */
export interface StoredKey {
	readonly userId: number;
	readonly keyId: string;
	readonly key: CryptoKey;
}

export async function rememberKey(stored: StoredKey): Promise<void> {
	await withStore('readwrite', (store) => store.put(stored, RECORD));
}

/**
 * The key this browser is holding, if it is for this account and this generation of the key. A
 * mismatch is deleted rather than returned: it belongs to a session that has ended, or to a key that
 * has since been replaced, and either way nothing it opens is still there to open.
 */
export async function recallKey(userId: number, keyId: string): Promise<CryptoKey | null> {
	const stored = await withStore<StoredKey | undefined>('readonly', (store) => store.get(RECORD));

	if (!stored || stored.userId !== userId || stored.keyId !== keyId) {
		if (stored) {
			await forgetKey();
		}
		return null;
	}
	return stored.key;
}

export async function forgetKey(): Promise<void> {
	await withStore('readwrite', (store) => store.delete(RECORD));
}

/**
 * One transaction, opened and closed.
 *
 * Every failure here answers undefined rather than throwing. This store is a convenience: when it is
 * unavailable - private browsing, storage turned off, a quota refusal - the application asks for the
 * password again, which is correct behaviour and not an error to report.
 */
function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest): Promise<T | undefined> {
	return new Promise<T | undefined>((resolve) => {
		let database: IDBDatabase | null = null;

		let opening: IDBOpenDBRequest;
		try {
			opening = indexedDB.open(DATABASE, 1);
		} catch {
			resolve(undefined);
			return;
		}

		opening.onupgradeneeded = () => {
			opening.result.createObjectStore(STORE);
		};
		opening.onerror = () => resolve(undefined);
		opening.onblocked = () => resolve(undefined);

		opening.onsuccess = () => {
			database = opening.result;
			try {
				const transaction = database.transaction(STORE, mode);
				const request = run(transaction.objectStore(STORE));

				request.onsuccess = () => resolve(request.result as T);
				request.onerror = () => resolve(undefined);
				transaction.oncomplete = () => database?.close();
				transaction.onabort = () => {
					database?.close();
					resolve(undefined);
				};
			} catch {
				database.close();
				resolve(undefined);
			}
		};
	});
}
