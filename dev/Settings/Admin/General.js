import ko from 'ko';

import {
	isArray,
	changeTheme,
	convertThemeName
} from 'Common/Utils';

import { addObservablesTo, addSubscribablesTo, addComputablesTo } from 'External/ko';

import { SaveSettingsStep } from 'Common/Enums';
import { Settings, SettingsGet, SettingsCapa } from 'Common/Globals';
import { translatorReload, convertLangName } from 'Common/Translator';

import { AbstractViewSettings } from 'Knoin/AbstractViews';
import { showScreenPopup } from 'Knoin/Knoin';

import Remote from 'Remote/Admin/Fetch';

import { ThemeStore } from 'Stores/Theme';
import { LanguageStore } from 'Stores/Language';
import { LanguagesPopupView } from 'View/Popup/Languages';

export class AdminSettingsGeneral extends AbstractViewSettings {
	constructor() {
		super();

		this.language = LanguageStore.language;
		this.languages = LanguageStore.languages;

		const aLanguagesAdmin = Settings.app('languagesAdmin');
		this.languagesAdmin = ko.observableArray(isArray(aLanguagesAdmin) ? aLanguagesAdmin : []);
		this.languageAdmin = ko
			.observable(SettingsGet('LanguageAdmin'))
			.extend({ limitedList: this.languagesAdmin });

		this.theme = ThemeStore.theme;
		this.themes = ThemeStore.themes;

		this.addSettings(['AllowLanguagesOnSettings','NewMoveToFolder']);

		addObservablesTo(this, {
			attachmentLimitTrigger: SaveSettingsStep.Idle,
			themeTrigger: SaveSettingsStep.Idle,
			capaThemes: SettingsCapa('Themes'),
			capaUserBackground: SettingsCapa('UserBackground'),
			capaAdditionalAccounts: SettingsCapa('AdditionalAccounts'),
			capaIdentities: SettingsCapa('Identities'),
			capaAttachmentThumbnails: SettingsCapa('AttachmentThumbnails'),
			dataFolderAccess: false
		});

		this.weakPassword = rl.app.weakPassword;

		/** https://github.com/RainLoop/rainloop-webmail/issues/1924
		if (this.weakPassword) {
			fetch('./data/VERSION?' + Math.random()).then(response => this.dataFolderAccess(response.ok));
		}
		*/

		this.attachmentLimit = ko
			.observable(SettingsGet('AttachmentLimit') / (1024 * 1024))
			.extend({ debounce: 500 });

		this.addSetting('Language');
		this.addSetting('AttachmentLimit');
		this.addSetting('Theme', value => changeTheme(value, this.themeTrigger));

		this.uploadData = SettingsGet('PhpUploadSizes');
		this.uploadDataDesc =
			this.uploadData && (this.uploadData.upload_max_filesize || this.uploadData.post_max_size)
				? [
						this.uploadData.upload_max_filesize
							? 'upload_max_filesize = ' + this.uploadData.upload_max_filesize + '; '
							: '',
						this.uploadData.post_max_size ? 'post_max_size = ' + this.uploadData.post_max_size : ''
				  ].join('')
				: '';

		addComputablesTo(this, {
			themesOptions: () => this.themes.map(theme => ({ optValue: theme, optText: convertThemeName(theme) })),

			languageFullName: () => convertLangName(this.language()),
			languageAdminFullName: () => convertLangName(this.languageAdmin())
		});

		this.languageAdminTrigger = ko.observable(SaveSettingsStep.Idle).extend({ debounce: 100 });

		const fReloadLanguageHelper = (saveSettingsStep) => () => {
				this.languageAdminTrigger(saveSettingsStep);
				setTimeout(() => this.languageAdminTrigger(SaveSettingsStep.Idle), 1000);
			},
			fSaveHelper = key => value => Remote.saveSetting(key, value);

		addSubscribablesTo(this, {
			languageAdmin: value => {
				this.languageAdminTrigger(SaveSettingsStep.Animate);
				translatorReload(true, value)
					.then(fReloadLanguageHelper(SaveSettingsStep.TrueResult), fReloadLanguageHelper(SaveSettingsStep.FalseResult))
					.then(() => Remote.saveSetting('LanguageAdmin', value));
			},

			capaAdditionalAccounts: fSaveHelper('CapaAdditionalAccounts'),

			capaIdentities: fSaveHelper('CapaIdentities'),

			capaAttachmentThumbnails: fSaveHelper('CapaAttachmentThumbnails'),

			capaThemes: fSaveHelper('CapaThemes'),

			capaUserBackground: fSaveHelper('CapaUserBackground')
		});
	}

	selectLanguage() {
		showScreenPopup(LanguagesPopupView, [this.language, this.languages(), LanguageStore.userLanguage()]);
	}

	selectLanguageAdmin() {
		showScreenPopup(LanguagesPopupView, [
			this.languageAdmin,
			this.languagesAdmin(),
			SettingsGet('UserLanguageAdmin')
		]);
	}
}
