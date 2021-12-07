import ko from 'ko';

import { i18n, trigger as translatorTrigger } from 'Common/Translator';

import { MessageUserStore } from 'Stores/User/Message';

import { decorateKoCommands } from 'Knoin/Knoin';
import { AbstractViewPopup } from 'Knoin/AbstractViews';
import { FolderUserStore } from 'Stores/User/Folder';

class AdvancedSearchPopupView extends AbstractViewPopup {
	constructor() {
		super('AdvancedSearch');
		this.viewNoUserSelect = true;

		this.addObservables({
			from: '',
			to: '',
			subject: '',
			text: '',
			selectedDateValue: -1,
			selectedTreeValue: '',

			hasAttachment: false,
			starred: false,
			unseen: false
		});

		this.showMultisearch = ko.computed(() => FolderUserStore.hasCapability('MULTISEARCH'));

		let prefix = 'SEARCH/LABEL_ADV_DATE_';
		this.selectedDates = ko.computed(() => {
			translatorTrigger();
			return [
				{ id: -1, name: i18n(prefix + 'ALL') },
				{ id: 3, name: i18n(prefix + '3_DAYS') },
				{ id: 7, name: i18n(prefix + '7_DAYS') },
				{ id: 30, name: i18n(prefix + 'MONTH') },
				{ id: 90, name: i18n(prefix + '3_MONTHS') },
				{ id: 180, name: i18n(prefix + '6_MONTHS') },
				{ id: 365, name: i18n(prefix + 'YEAR') }
			];
		});

		prefix = 'SEARCH/LABEL_ADV_SUBFOLDERS_';
		this.selectedTree = ko.computed(() => {
			translatorTrigger();
			return [
				{ id: '', name: i18n(prefix + 'NONE') },
				{ id: 'subtree-one', name: i18n(prefix + 'SUBTREE_ONE') },
				{ id: 'subtree', name: i18n(prefix + 'SUBTREE') }
			];
		});

		decorateKoCommands(this, {
			searchCommand: 1
		});
	}

	searchCommand() {
		const search = this.buildSearchString();
		if (search) {
			MessageUserStore.mainMessageListSearch(search);
		}

		this.cancelCommand();
	}

	parseSearchStringValue(search) {
		const parts = (search || '').split(/[\s]+/g);
		parts.forEach(part => {
			switch (part) {
				case 'has:attachment':
					this.hasAttachment(true);
					break;
				case 'is:unseen,flagged':
					this.starred(true);
				/* falls through */
				case 'is:unseen':
					this.unseen(true);
					break;
				// no default
			}
		});
	}

	buildSearchString() {
		const
			data = new FormData(),
			append = (key, value) => value.length && data.append(key, value);

		append('from', this.from().trim());
		append('to', this.to().trim());
		append('subject', this.subject().trim());
		append('text', this.text().trim());
		append('in', this.selectedTreeValue());
		if (-1 < this.selectedDateValue()) {
			let d = new Date();
			d.setDate(d.getDate() - this.selectedDateValue());
			append('date', d.format('Y.m.d') + '/');
		}

		let result = new URLSearchParams(data).toString();

		if (this.hasAttachment()) {
			result += '&attachment';
		}
		if (this.unseen()) {
			result += '&unseen';
		}
		if (this.starred()) {
			result += '&flagged';
		}

		return result.replace(/^&+/, '');
	}

	onShow(search) {
		this.from('');
		this.to('');
		this.subject('');
		this.text('');

		this.selectedDateValue(-1);
		this.hasAttachment(false);
		this.starred(false);
		this.unseen(false);

		this.parseSearchStringValue(search);
	}
}

export { AdvancedSearchPopupView, AdvancedSearchPopupView as default };
