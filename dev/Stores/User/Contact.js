import ko from 'ko';
import { SettingsGet } from 'Common/Globals';
import { pInt } from 'Common/Utils';
import { addObservablesTo, koArrayWithDestroy } from 'External/ko';
import Remote from 'Remote/User/Fetch';

export const ContactUserStore = koArrayWithDestroy();

ContactUserStore.loading = ko.observable(false).extend({ debounce: 200 });
ContactUserStore.importing = ko.observable(false).extend({ debounce: 200 });
ContactUserStore.syncing = ko.observable(false).extend({ debounce: 200 });

addObservablesTo(ContactUserStore, {
	allowSync: false, // Admin setting
	enableSync: false,
	syncUrl: '',
	syncUser: '',
	syncPass: ''
});

/**
 * @param {Function} fResultFunc
 * @returns {void}
 */
ContactUserStore.sync = fResultFunc => {
	if (ContactUserStore.enableSync()
	 && !ContactUserStore.importing()
	 && !ContactUserStore.syncing()
	) {
		ContactUserStore.syncing(true);
		Remote.request('ContactsSync', (iError, oData) => {
			ContactUserStore.syncing(false);
			fResultFunc && fResultFunc(iError, oData);
		}, null, 200000);
	}
};

ContactUserStore.init = () => {
	let value = !!SettingsGet('ContactsSyncIsAllowed');
	ContactUserStore.allowSync(value);
	if (value) {
		ContactUserStore.enableSync(!!SettingsGet('EnableContactsSync'));
		ContactUserStore.syncUrl(SettingsGet('ContactsSyncUrl'));
		ContactUserStore.syncUser(SettingsGet('ContactsSyncUser'));
		ContactUserStore.syncPass(SettingsGet('ContactsSyncPassword'));
		setTimeout(ContactUserStore.sync, 10000);
		value = pInt(SettingsGet('ContactsSyncInterval'));
		value = 5 <= value ? (320 >= value ? value : 320) : 20;
		setInterval(ContactUserStore.sync, value * 60000 + 5000);
	}
};
