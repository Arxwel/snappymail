import ko from 'ko';

import { pString, defaultOptionsAfterRender } from 'Common/Utils';

import { Scope } from 'Common/Enums';
import { i18n } from 'Common/Translator';

import { PgpUserStore } from 'Stores/User/Pgp';

import { EmailModel } from 'Model/Email';

import { decorateKoCommands } from 'Knoin/Knoin';
import { AbstractViewPopup } from 'Knoin/AbstractViews';

const KEY_NAME_SUBSTR = -8,
	i18nPGP = (key, params) => i18n('PGP_NOTIFICATIONS/' + key, params);

class ComposeOpenPgpPopupView extends AbstractViewPopup {
	constructor() {
		super('ComposeOpenPgp');
		this.viewNoUserSelect = true;

		this.publicKeysOptionsCaption = i18nPGP('ADD_A_PUBLICK_KEY');
		this.privateKeysOptionsCaption = i18nPGP('SELECT_A_PRIVATE_KEY');

		this.addObservables({
			notification: '',

			sign: false,
			encrypt: false,

			password: '',

			text: '',
			selectedPrivateKey: null,
			selectedPublicKey: null,

			signKey: null,

			submitRequest: false
		});
		this.encryptKeys = ko.observableArray();

		this.addComputables({
			encryptKeysView:  () => this.encryptKeys.map(oKey => (oKey ? oKey.key : null)).filter(v => v),

			privateKeysOptions: () => {
				const opts = PgpUserStore.openpgpkeysPrivate().map(oKey => {
					if (this.signKey() && this.signKey().key.id === oKey.id) {
						return null;
					}
					return oKey.users.map(user => ({
						id: oKey.guid,
						name: '(' + oKey.id.substr(KEY_NAME_SUBSTR).toUpperCase() + ') ' + user,
						key: oKey
					}));
				});

				return opts.flat().filter(v => v);
			},

			publicKeysOptions: () => {
				const opts = PgpUserStore.openpgpkeysPublic().map(oKey => {
					if (this.encryptKeysView().includes(oKey)) {
						return null;
					}
					return oKey.users.map(user => ({
						id: oKey.guid,
						name: '(' + oKey.id.substr(KEY_NAME_SUBSTR).toUpperCase() + ') ' + user,
						key: oKey
					}));
				});
				return opts.flat().filter(v => v);
			}
		});

		this.resultCallback = null;

		this.selectedPrivateKey.subscribe((value) => {
			if (value) {
				this.selectCommand();
				this.updateCommand();
			}
		});

		this.selectedPublicKey.subscribe((value) => {
			if (value) {
				this.addCommand();
			}
		});

		this.defaultOptionsAfterRender = defaultOptionsAfterRender;

		this.deletePublickKey = this.deletePublickKey.bind(this);

		decorateKoCommands(this, {
			doCommand: self => !self.submitRequest() && (self.sign() || self.encrypt()),
			selectCommand: 1,
			addCommand: 1,
			updateCommand: 1,
		});
	}

	doCommand() {
		let result = true,
			privateKey = null,
			aPublicKeys = [];

		this.submitRequest(true);

		if (result && this.sign()) {
			if (!this.signKey()) {
				this.notification(i18nPGP('NO_PRIVATE_KEY_FOUND'));
				result = false;
			} else if (!this.signKey().key) {
				this.notification(
					i18nPGP('NO_PRIVATE_KEY_FOUND_FOR', {
						EMAIL: this.signKey().email
					})
				);

				result = false;
			}

			if (result) {
				const privateKeys = this.signKey().key.getNativeKeys();
				privateKey = privateKeys[0] || null;

				try {
					if (privateKey) {
						privateKey.decrypt(pString(this.password()));
					}
				} catch (e) {
					privateKey = null;
				}

				if (!privateKey) {
					this.notification(i18nPGP('NO_PRIVATE_KEY_FOUND'));
					result = false;
				}
			}
		}

		if (result && this.encrypt()) {
			if (this.encryptKeys.length) {
				aPublicKeys = [];

				this.encryptKeys.forEach(oKey => {
					if (oKey && oKey.key) {
						aPublicKeys = aPublicKeys.concat(oKey.key.getNativeKeys().flat(Infinity).filter(v => v));
					} else if (oKey && oKey.email) {
						this.notification(
							i18nPGP('NO_PUBLIC_KEYS_FOUND_FOR', {
								EMAIL: oKey.email
							})
						);

						result = false;
					}
				});

				if (result && (!aPublicKeys.length || this.encryptKeys.length !== aPublicKeys.length)) {
					result = false;
				}
			} else {
				this.notification(i18nPGP('NO_PUBLIC_KEYS_FOUND'));
				result = false;
			}
		}

		if (result && this.resultCallback) {
			setTimeout(() => {
				let pgpPromise = null;

				try {
					if (aPublicKeys.length) {
						if (privateKey) {
							pgpPromise = PgpUserStore.openpgp.encrypt({
								data: this.text(),
								publicKeys: aPublicKeys,
								privateKeys: [privateKey]
							});
						} else {
							pgpPromise = PgpUserStore.openpgp.encrypt({
								data: this.text(),
								publicKeys: aPublicKeys
							});
						}
					} else if (privateKey) {
						pgpPromise = PgpUserStore.openpgp.sign({
							data: this.text(),
							privateKeys: [privateKey]
						});
					}
				} catch (e) {
					console.log(e);

					this.notification(
						i18nPGP('PGP_ERROR', {
							ERROR: '' + e
						})
					);
				}

				if (pgpPromise) {
					try {
						pgpPromise
							.then((mData) => {
								this.resultCallback(mData.data);
								this.cancelCommand();
							})
							.catch((e) => {
								this.notification(
									i18nPGP('PGP_ERROR', {
										ERROR: '' + e
									})
								);
							});
					} catch (e) {
						this.notification(
							i18nPGP('PGP_ERROR', {ERROR: '' + e})
						);
					}
				}

				this.submitRequest(false);
			}, 20);
		} else {
			this.submitRequest(false);
		}

		return result;
	}

	selectCommand() {
		const keyId = this.selectedPrivateKey(),
			option = keyId ? this.privateKeysOptions().find(item => item && keyId === item.id) : null;

		if (option) {
			this.signKey({
				empty: !option.key,
				selected: ko.observable(!!option.key),
				users: option.key.users,
				hash: option.key.id.substr(KEY_NAME_SUBSTR).toUpperCase(),
				key: option.key
			});
		}
	}

	addCommand() {
		const keyId = this.selectedPublicKey(),
			option = keyId ? this.publicKeysOptions().find(item => item && keyId === item.id) : null;

		if (option) {
			this.encryptKeys.push({
				empty: !option.key,
				selected: ko.observable(!!option.key),
				removable: ko.observable(!this.sign() || !this.signKey() || this.signKey().key.id !== option.key.id),
				users: option.key.users,
				hash: option.key.id.substr(KEY_NAME_SUBSTR).toUpperCase(),
				key: option.key
			});
		}
	}

	updateCommand() {
		this.encryptKeys.forEach(oKey =>
			oKey.removable(!this.sign() || !this.signKey() || this.signKey().key.id !== oKey.key.id)
		);
	}

	deletePublickKey(publicKey) {
		this.encryptKeys.remove(publicKey);
	}

	clearPopup() {
		this.notification('');

		this.sign(false);
		this.encrypt(false);

		this.password('');

		this.signKey(null);
		this.encryptKeys([]);
		this.text('');

		this.resultCallback = null;
	}

	onBuild() {
//		shortcuts.add('tab', 'shift', Scope.ComposeOpenPgp, () => {
		shortcuts.add('tab', '', Scope.ComposeOpenPgp, () => {
			let btn = this.querySelector('.inputPassword');
			if (btn.matches(':focus')) {
				btn = this.querySelector('.buttonDo');
			}
			btn.focus();
			return false;
		});
	}

	onHideWithDelay() {
		this.clearPopup();
	}

	onShowWithDelay() {
		this.querySelector(this.sign() ? '.inputPassword' : '.buttonDo').focus();
	}

	onShow(fCallback, sText, identity, sTo, sCc, sBcc) {
		this.clearPopup();

		let rec = [],
			emailLine = '';

		const email = new EmailModel();

		this.resultCallback = fCallback;

		if (sTo) {
			rec.push(sTo);
		}

		if (sCc) {
			rec.push(sCc);
		}

		if (sBcc) {
			rec.push(sBcc);
		}

		rec = rec.join(', ').split(',');
		rec = rec.map(value => {
				email.clear();
				email.parse(value.trim());
				return email.email || false;
			}).filter(v => v);

		if (identity && identity.email()) {
			emailLine = identity.email();
			rec.unshift(emailLine);

			const keys = PgpUserStore.findAllPrivateKeysByEmailNotNative(emailLine);
			if (keys && keys[0]) {
				this.signKey({
					users: keys[0].users || [emailLine],
					hash: keys[0].id.substr(KEY_NAME_SUBSTR).toUpperCase(),
					key: keys[0]
				});
			}
		}

		if (this.signKey()) {
			this.sign(true);
		}

		if (rec.length) {
			this.encryptKeys(
				rec.map(recEmail => {
					const keys = PgpUserStore.findAllPublicKeysByEmailNotNative(recEmail);
					return keys
						? keys.map(publicKey => ({
								empty: !publicKey,
								selected: ko.observable(!!publicKey),
								removable: ko.observable(
									!this.sign() || !this.signKey() || this.signKey().key.id !== publicKey.id
								),
								users: publicKey ? publicKey.users || [recEmail] : [recEmail],
								hash: publicKey ? publicKey.id.substr(KEY_NAME_SUBSTR).toUpperCase() : '',
								key: publicKey
						  }))
						: [];
				}).flat().validUnique(encryptKey => encryptKey.hash)
			);

			if (this.encryptKeys.length) {
				this.encrypt(true);
			}
		}

		this.text(sText);
	}
}

export { ComposeOpenPgpPopupView, ComposeOpenPgpPopupView as default };
