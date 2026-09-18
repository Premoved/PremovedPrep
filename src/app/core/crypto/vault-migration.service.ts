import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { KdfParameters, deriveFromPassword } from './kdf';
import { VaultService } from './vault.service';
import { writePayload } from '../services/item-payload';
import { ItemType } from '../models/collection.model';

/**
 * Carrying an account written before V23 across, once.
 *
 * WHY THIS IS A CLIENT AND NOT A SCRIPT
 *
 * The obvious way to migrate a database is a job that reads every row and writes it back encrypted.
 * That job cannot exist here. The key is derived from the account's password; the server holds a
 * BCrypt hash of that password, which is a one-way function and not a slow way of reading one. No
 * amount of server-side scheduling produces a key, so no server-side process can seal anything.
 *
 * The only moment an account's key can exist is inside the browser of the person signing in with it.
 * So that is when this runs: immediately after a legacy sign-in, while the password is still in a
 * local variable. It creates key material, swaps the account's stored credential for the derived
 * secret, and then pulls its own still-plaintext entries down a page at a time, seals them, and
 * posts them back.
 *
 * WHAT IT LOOKS LIKE TO THE PERSON
 *
 * A progress line. The recovery code an adopting account needs is not this service's business: the
 * sign-in that called it finishes by making one, the same way it does for a new account, and the
 * dialog on the profile is what shows it.
 *
 * IF IT IS INTERRUPTED
 *
 * Nothing is lost. Each entry is sealed and written back on its own, conditionally on its plaintext
 * still being there, so closing the tab half way leaves half the account encrypted and the next
 * sign-in resumes from where it stopped. The key material is written once and refuses to be written
 * twice, so two tabs racing cannot produce two master keys and an account that can open neither half
 * of itself.
 */
@Injectable({ providedIn: 'root' })
export class VaultMigrationService {
	private readonly http = inject(HttpClient);
	private readonly vault = inject(VaultService);
	private readonly baseUrl = environment.apiBaseUrl;

	private readonly _remaining = signal<number | null>(null);

	/** How many entries are still in the clear, or null when nothing is migrating. */
	readonly remaining = this._remaining.asReadonly();

	readonly running = computed(() => this._remaining() !== null);

	/**
	 * The whole upgrade: key material, then the contents.
	 *
	 * Called from the sign-in path, with the password it was given. A failure is reported and then
	 * swallowed: the person is signed in, and an account that could not be upgraded this time is one
	 * that tries again next time, not one that is refused entry.
	 */
	async adopt(email: string, password: string, kdf: KdfParameters, userId: number): Promise<void> {
		try {
			const created = await this.vault.create(password, email, kdf);
			const derived = await deriveFromPassword(password, email, kdf);

			await firstValueFrom(
				this.http.post<void>(
					`${this.baseUrl}/vault/adopt`,
					{ currentPassword: password, authSecret: created.authSecret, vault: created.material },
					{ withCredentials: true },
				),
			);

			await this.vault.adoptCreated(created, derived.vaultKey, userId);
			await this.sealEverything();
		} catch (error) {
			this._remaining.set(null);
			console.error('This account could not be moved to encrypted storage; it will be retried', error);
		}
	}

	/**
	 * Pulls the remaining plaintext down a page at a time and posts it back sealed.
	 *
	 * A page rather than the lot because an account may hold two megabytes of PGN and this runs while
	 * somebody is waiting to use the application. The loop ends when the server says nothing is left,
	 * and it also ends if a page comes back that it cannot make progress on - an entry that refuses to
	 * seal must not become a loop that asks for it forever.
	 */
	async sealEverything(): Promise<void> {
		for (;;) {
			const batch = await this.fetchBatch();
			this._remaining.set(batch.remaining);

			if (batch.items.length === 0 && batch.collections.length === 0) {
				this._remaining.set(null);
				return;
			}

			const collections = await Promise.all(
				batch.collections.map(async (collection) => ({
					collectionId: collection.id,
					nameCipher: await this.vault.seal('collection-name', collection.name),
				})),
			);

			const items: { itemId: number; payload: string }[] = [];
			for (const row of batch.items) {
				items.push({
					itemId: row.id,
					payload: await this.vault.seal('item', writePayload({ pgn: row.pgn, title: row.title, author: row.author })),
				});
			}

			const after = await this.postBatch(items, collections);
			this._remaining.set(after.remaining);

			/** No progress: stop rather than ask for the same page again. */
			if (after.remaining >= batch.remaining && after.items.length > 0) {
				this._remaining.set(null);
				throw new Error('Some entries could not be moved to encrypted storage');
			}
		}
	}

	private fetchBatch(): Promise<MigrationBatch> {
		return firstValueFrom(this.http.get<MigrationBatch>(`${this.baseUrl}/collections/migration`));
	}

	private postBatch(
		items: readonly { itemId: number; payload: string }[],
		collections: readonly { collectionId: number; nameCipher: string }[],
	): Promise<MigrationBatch> {
		return firstValueFrom(
			this.http.post<MigrationBatch>(`${this.baseUrl}/collections/migration`, { items, collections }),
		);
	}
}

/** What the migration endpoint hands back: the only place this API returns a readable PGN. */
interface MigrationBatch {
	readonly remaining: number;
	readonly collections: readonly { id: number; name: string }[];
	readonly items: readonly {
		readonly id: number;
		readonly collectionId: number;
		readonly itemType: ItemType;
		readonly sortOrder: number;
		readonly title: string | null;
		readonly author: string | null;
		readonly startFen: string | null;
		readonly pgn: string;
	}[];
}
