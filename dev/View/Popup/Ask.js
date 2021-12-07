import { Scope } from 'Common/Enums';
import { i18n } from 'Common/Translator';
import { isFunction } from 'Common/Utils';

import { AbstractViewPopup } from 'Knoin/AbstractViews';

class AskPopupView extends AbstractViewPopup {
	constructor() {
		super('Ask');
		this.viewNoUserSelect = true;

		this.addObservables({
			askDesc: '',
			yesButton: '',
			noButton: ''
		});

		this.fYesAction = null;
		this.fNoAction = null;

		this.bFocusYesOnShow = true;
		this.bDisabeCloseOnEsc = true;
	}

	yesClick() {
		this.cancelCommand();

		isFunction(this.fYesAction) && this.fYesAction.call(null);
	}

	noClick() {
		this.cancelCommand();

		isFunction(this.fNoAction) && this.fNoAction.call(null);
	}

	/**
	 * @param {string} sAskDesc
	 * @param {Function=} fYesFunc
	 * @param {Function=} fNoFunc
	 * @param {string=} sYesButton
	 * @param {string=} sNoButton
	 * @param {boolean=} bFocusYesOnShow = true
	 * @returns {void}
	 */
	onShow(askDesc, fYesFunc = null, fNoFunc = null, yesButton = '', noButton = '', isFocusYesOnShow = true) {
		this.askDesc(askDesc || '');
		this.yesButton(yesButton || i18n('POPUPS_ASK/BUTTON_YES'));
		this.noButton(noButton || i18n('POPUPS_ASK/BUTTON_NO'));
		this.fYesAction = fYesFunc;
		this.fNoAction = fNoFunc;
		this.bFocusYesOnShow = !!isFocusYesOnShow;
	}

	onShowWithDelay() {
		if (this.bFocusYesOnShow) {
			this.querySelector('.buttonYes').focus();
		}
	}

	onBuild() {
//		shortcuts.add('tab', 'shift', Scope.Ask, () => {
		shortcuts.add('tab,arrowright,arrowleft', '', Scope.Ask, () => {
			let btn = this.querySelector('.buttonYes');
			if (btn.matches(':focus')) {
				btn = this.querySelector('.buttonNo');
			}
			btn.focus();
			return false;
		});

		shortcuts.add('escape', '', Scope.Ask, () => {
			this.noClick();
			return false;
		});
	}
}

export { AskPopupView, AskPopupView as default };
