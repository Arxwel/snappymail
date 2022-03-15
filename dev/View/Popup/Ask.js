import { i18n } from 'Common/Translator';
import { isFunction } from 'Common/Utils';

import { AbstractViewPopup } from 'Knoin/AbstractViews';

export class AskPopupView extends AbstractViewPopup {
	constructor() {
		super('Ask');

		this.addObservables({
			askDesc: '',
			yesButton: '',
			noButton: '',
			passphrase: '',
			askPass: false
		});

		this.fYesAction = null;
		this.fNoAction = null;

		this.focusOnShow = true;
	}

	yesClick() {
		this.close();

		isFunction(this.fYesAction) && this.fYesAction();
	}

	noClick() {
		this.close();

		isFunction(this.fNoAction) && this.fNoAction();
	}

	/**
	 * @param {string} sAskDesc
	 * @param {Function=} fYesFunc
	 * @param {Function=} fNoFunc
	 * @param {boolean=} focusOnShow = true
	 * @returns {void}
	 */
	onShow(sAskDesc, fYesFunc = null, fNoFunc = null, focusOnShow = true, askPass = false, btnText = '') {
		this.askDesc(sAskDesc || '');
		this.askPass(askPass);
		this.passphrase('');
		this.yesButton(i18n(btnText || 'POPUPS_ASK/BUTTON_YES'));
		this.noButton(i18n(askPass ? 'GLOBAL/CANCEL' : 'POPUPS_ASK/BUTTON_NO'));
		this.fYesAction = fYesFunc;
		this.fNoAction = fNoFunc;
		this.focusOnShow = focusOnShow ? (askPass ? 'input[type="password"]' : '.buttonYes') : '';
	}

	afterShow() {
		this.focusOnShow && this.querySelector(this.focusOnShow).focus();
	}

	onClose() {
		this.noClick();
		return false;
	}

	onBuild() {
//		shortcuts.add('tab', 'shift', 'Ask', () => {
		shortcuts.add('tab,arrowright,arrowleft', '', 'Ask', () => {
			let btn = this.querySelector('.buttonYes');
			if (btn.matches(':focus')) {
				btn = this.querySelector('.buttonNo');
			}
			btn.focus();
			return false;
		});
	}
}

AskPopupView.password = function(sAskDesc, btnText) {
	return new Promise(resolve => {
		this.showModal([
			sAskDesc,
			() => resolve(this.__vm.passphrase()),
			() => resolve(null),
			true,
			true,
			btnText
		]);
	});
}
