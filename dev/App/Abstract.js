import ko from 'ko';

import {
	$htmlCL,
	leftPanelDisabled,
	leftPanelType,
	bMobileDevice
} from 'Common/Globals';

import { KeyState } from 'Common/Enums';
import { rootAdmin, rootUser } from 'Common/Links';
import { initOnStartOrLangChange, initNotificationLanguage } from 'Common/Translator';

import LanguageStore from 'Stores/Language';
import ThemeStore from 'Stores/Theme';

const Settings = rl.settings;

class AbstractApp {
	/**
	 * @param {RemoteStorage|AdminRemoteStorage} Remote
	 */
	constructor() {
		this.isLocalAutocomplete = true;
		this.lastErrorTime = 0;

		const $doc = document;
		$doc.addEventListener('keydown', (event) => {
			if (event && event.ctrlKey) {
				$htmlCL.add('rl-ctrl-key-pressed');
			}
		});
		$doc.addEventListener('keyup', (event) => {
			if (event && !event.ctrlKey) {
				$htmlCL.remove('rl-ctrl-key-pressed');
			}
		});

		const fn = (()=>dispatchEvent(new CustomEvent('rl.auto-logout-refresh'))).debounce(5000);

		$doc.addEventListener('mousemove', fn);
		$doc.addEventListener('keypress', fn);
		$doc.addEventListener('click', fn);

		shortcuts.add('escape,enter', '', KeyState.All, () => rl.Dropdowns.detectVisibility());
	}

	remote() {
		return null;
	}

	data() {
		return null;
	}

	/**
	 * @param {string} link
	 * @returns {boolean}
	 */
	download(link) {
		if (bMobileDevice) {
			open(link, '_self');
			focus();
		} else {
			const oLink = document.createElement('a');
			oLink.href = link;
			document.body.appendChild(oLink).click();
			oLink.remove();
		}
		return true;
	}

	/**
	 * @param {string} token
	 */
	setClientSideToken(token) {
		rl.hash.set();
		Settings.set('AuthAccountHash', token);
	}

	logoutReload(close = false) {
		const logoutLink = rl.adminArea() ? rootAdmin() : rootUser();

		rl.hash.clear();
		close && window.close && window.close();

		if (location.href !== logoutLink) {
			setTimeout(() => (Settings.app('inIframe') ? parent : window).location.href = logoutLink, 100);
		} else {
			rl.route.reload();
		}
	}

	bootstart() {
		const mobile = Settings.app('mobile');

		ko.components.register('SaveTrigger', require('Component/SaveTrigger').default);
		ko.components.register('Input', require('Component/Input').default);
		ko.components.register('Select', require('Component/Select').default);
		ko.components.register('TextArea', require('Component/TextArea').default);

		if (Settings.app('materialDesign') && !bMobileDevice) {
			ko.components.register('Checkbox', require('Component/MaterialDesign/Checkbox').default);
			ko.components.register('CheckboxSimple', require('Component/Checkbox').default);
		} else {
			ko.components.register('Checkbox', require('Component/Checkbox').default);
			ko.components.register('CheckboxSimple', require('Component/Checkbox').default);
		}

		initOnStartOrLangChange(initNotificationLanguage);

		if (!mobile) {
			// mobile
			window.addEventListener('resize', () => leftPanelDisabled(767 >= window.innerWidth));
		} else {
			$htmlCL.add('rl-mobile');
			leftPanelDisabled(true);
		}

		leftPanelDisabled.subscribe((bValue) => {
			$htmlCL.toggle('rl-left-panel-disabled', bValue);
			$htmlCL.toggle('rl-left-panel-enabled', !bValue);
		});

		leftPanelType.subscribe((sValue) => {
			$htmlCL.toggle('rl-left-panel-none', 'none' === sValue);
			$htmlCL.toggle('rl-left-panel-short', 'short' === sValue);
		});

		leftPanelDisabled.valueHasMutated();

		LanguageStore.populate();
		ThemeStore.populate();
	}

	/**
	 * @returns {void}
	 */
	hideLoading() {
		const id = id => document.getElementById(id);
		id('rl-content').hidden = false;
		id('rl-loading').remove();
	}

}

export { AbstractApp, AbstractApp as default };
