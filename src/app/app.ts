import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { LongPressService } from './core/browser/long-press';
import { SeoService } from './core/seo/seo.service';
import { NoticeBarComponent } from './shared/notice-bar/notice-bar.component';

@Component({
	selector: 'app-root',
	standalone: true,
	imports: [RouterOutlet, NoticeBarComponent],
	templateUrl: './app.html',
})
export class App {
	private readonly longPress = inject(LongPressService);

	private readonly seo = inject(SeoService);

	constructor() {
		this.seo.start();
	}
}
