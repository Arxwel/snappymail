import ko from 'ko';

import {
	Notification,
	UploadErrorCode
} from 'Common/Enums';

import {
	ComposeType,
	EditorDefaultType,
	SetSystemFoldersNotification
} from 'Common/EnumsUser';

import { pInt, isArray, arrayLength, forEachObjectEntry } from 'Common/Utils';
import { initFullscreen } from 'Common/UtilsUser';
import { encodeHtml, HtmlEditor, htmlToPlain } from 'Common/Html';
import { koArrayWithDestroy } from 'External/ko';

import { UNUSED_OPTION_VALUE } from 'Common/Consts';
import { messagesDeleteHelper } from 'Common/Folders';
import { serverRequest } from 'Common/Links';
import { i18n, getNotification, getUploadErrorDescByCode, timestampToString } from 'Common/Translator';
import { MessageFlagsCache, setFolderHash } from 'Common/Cache';
import { doc, Settings, SettingsGet, getFullscreenElement, exitFullscreen, elementById, addShortcut } from 'Common/Globals';

import { AppUserStore } from 'Stores/User/App';
import { SettingsUserStore } from 'Stores/User/Settings';
import { IdentityUserStore } from 'Stores/User/Identity';
import { AccountUserStore } from 'Stores/User/Account';
import { FolderUserStore } from 'Stores/User/Folder';
import { PgpUserStore } from 'Stores/User/Pgp';
import { OpenPGPUserStore } from 'Stores/User/OpenPGP';
import { GnuPGUserStore } from 'Stores/User/GnuPG';
import { MessageUserStore } from 'Stores/User/Message';
import { MessagelistUserStore } from 'Stores/User/Messagelist';

import Remote from 'Remote/User/Fetch';

import { ComposeAttachmentModel } from 'Model/ComposeAttachment';
import { EmailModel } from 'Model/Email';

import { decorateKoCommands, showScreenPopup } from 'Knoin/Knoin';
import { AbstractViewPopup } from 'Knoin/AbstractViews';

import { FolderSystemPopupView } from 'View/Popup/FolderSystem';
import { AskPopupView } from 'View/Popup/Ask';
import { ContactsPopupView } from 'View/Popup/Contacts';

import { ThemeStore } from 'Stores/Theme';

const
	ScopeCompose = 'Compose',

	base64_encode = text => btoa(text).match(/.{1,76}/g).join('\r\n'),

	email = new EmailModel(),
	getEmail = value => {
		email.clear();
		email.parse(value.trim());
		return email.email || false;
	},

	/**
	 * @param {string} prefix
	 * @param {string} subject
	 * @returns {string}
	 */
	replySubjectAdd = (prefix, subject) => {
		prefix = prefix.toUpperCase().trim();
		subject = subject.replace(/\s+/g, ' ').trim();

		let drop = false,
			re = 'RE' === prefix,
			fwd = 'FWD' === prefix;

		const parts = [],
			prefixIsRe = !fwd;

		if (subject) {
			subject.split(':').forEach(part => {
				const trimmedPart = part.trim();
				if (!drop && (/^(RE|FWD)$/i.test(trimmedPart) || /^(RE|FWD)[[(][\d]+[\])]$/i.test(trimmedPart))) {
					if (!re) {
						re = !!/^RE/i.test(trimmedPart);
					}

					if (!fwd) {
						fwd = !!/^FWD/i.test(trimmedPart);
					}
				} else {
					parts.push(part);
					drop = true;
				}
			});
		}

		if (prefixIsRe) {
			re = false;
		} else {
			fwd = false;
		}

		return ((prefixIsRe ? 'Re: ' : 'Fwd: ') + (re ? 'Re: ' : '')
			+ (fwd ? 'Fwd: ' : '') + parts.join(':').trim()).trim();
	};

ko.extenders.toggleSubscribe = (target, options) => {
	target.subscribe(options[1], options[0], 'beforeChange');
	target.subscribe(options[2], options[0]);
	return target;
};

class MimePart {
	constructor() {
		this.headers = {};
		this.body = '';
		this.boundary = '';
		this.children = [];
	}

	toString() {
		const hasSub = this.children.length,
			boundary = this.boundary || (this.boundary = 'part' + Jua.randomId()),
			headers = this.headers;
		if (hasSub) {
			headers['Content-Type'] += `; boundary="${boundary}"`;
		}
		let result = Object.entries(headers).map(([key, value]) => `${key}: ${value}`).join('\r\n') + '\r\n';
		if (this.body) {
			result += '\r\n' + this.body.replace(/\r?\n/g, '\r\n');
		}
		if (hasSub) {
			this.children.forEach(part => result += '\r\n--' + boundary + '\r\n' + part);
			result += '\r\n--' + boundary + '--\r\n';
		}
		return result;
	}
}

export class ComposePopupView extends AbstractViewPopup {
	constructor() {
		super('Compose');

		const fEmailOutInHelper = (context, identity, name, isIn) => {
			if (identity && context && identity[name]() && (isIn ? true : context[name]())) {
				const identityEmail = identity[name]();
				let list = context[name]().trim().split(',');

				list = list.filter(email => {
					email = email.trim();
					return email && identityEmail.trim() !== email;
				});

				if (isIn) {
					list.push(identityEmail);
				}

				context[name](list.join(','));
			}
		};

		this.oLastMessage = null;
		this.oEditor = null;
		this.aDraftInfo = null;
		this.sInReplyTo = '';
		this.bFromDraft = false;
		this.sReferences = '';

		this.sLastFocusedField = 'to';

		this.allowContacts = AppUserStore.allowContacts();

		this.bSkipNextHide = false;

		this.addObservables({
			identitiesDropdownTrigger: false,

			from: '',
			to: '',
			cc: '',
			bcc: '',
			replyTo: '',

			subject: '',

			isHtml: false,

			requestDsn: false,
			requestReadReceipt: false,
			markAsImportant: false,

			sendError: false,
			sendSuccessButSaveError: false,
			savedError: false,

			sendErrorDesc: '',
			savedErrorDesc: '',

			savedTime: 0,

			emptyToError: false,

			attachmentsInProcessError: false,
			attachmentsInErrorError: false,

			showCc: false,
			showBcc: false,
			showReplyTo: false,

			pgpSign: false,
			canPgpSign: false,
			pgpEncrypt: false,
			canPgpEncrypt: false,
			canMailvelope: false,

			draftsFolder: '',
			draftUid: 0,
			sending: false,
			saving: false,

			viewArea: 'body',

			attacheMultipleAllowed: false,
			addAttachmentEnabled: false,

			editorArea: null, // initDom

			currentIdentity: IdentityUserStore()[0]
		});

		this.from(IdentityUserStore()[0].formattedName());

		// this.to.subscribe((v) => console.log(v));

		// Used by ko.bindingHandlers.emailsTags
		this.to.focused = ko.observable(false);
		this.to.focused.subscribe(value => value && (this.sLastFocusedField = 'to'));
		this.cc.focused = ko.observable(false);
		this.cc.focused.subscribe(value => value && (this.sLastFocusedField = 'cc'));
		this.bcc.focused = ko.observable(false);
		this.bcc.focused.subscribe(value => value && (this.sLastFocusedField = 'bcc'));

		this.attachments = koArrayWithDestroy();

		this.dragAndDropOver = ko.observable(false).extend({ debounce: 1 });
		this.dragAndDropVisible = ko.observable(false).extend({ debounce: 1 });

		this.currentIdentity.extend({
			toggleSubscribe: [
				this,
				(identity) => {
					fEmailOutInHelper(this, identity, 'bcc');
					fEmailOutInHelper(this, identity, 'replyTo');
				},
				(identity) => {
					fEmailOutInHelper(this, identity, 'bcc', true);
					fEmailOutInHelper(this, identity, 'replyTo', true);
				}
			]
		});

		this.tryToClosePopup = this.tryToClosePopup.debounce(200);

		this.iTimer = 0;

		this.addComputables({
			sendButtonSuccess: () => !this.sendError() && !this.sendSuccessButSaveError(),

			savedTimeText: () =>
				this.savedTime() ? i18n('COMPOSE/SAVED_TIME', { TIME: this.savedTime().format('LT') }) : '',

			emptyToErrorTooltip: () => (this.emptyToError() ? i18n('COMPOSE/EMPTY_TO_ERROR_DESC') : ''),

			attachmentsErrorTooltip: () => {
				let result = '';
				switch (true) {
					case this.attachmentsInProcessError():
						result = i18n('COMPOSE/ATTACHMENTS_UPLOAD_ERROR_DESC');
						break;
					case this.attachmentsInErrorError():
						result = i18n('COMPOSE/ATTACHMENTS_ERROR_DESC');
						break;
					// no default
				}
				return result;
			},

			attachmentsInProcess: () => this.attachments.filter(item => item && !item.complete()),
			attachmentsInError: () => this.attachments.filter(item => item && item.error()),

			attachmentsCount: () => this.attachments.length,
			attachmentsInErrorCount: () => this.attachmentsInError.length,
			attachmentsInProcessCount: () => this.attachmentsInProcess.length,
			isDraftFolderMessage: () => this.draftsFolder() && this.draftUid(),

			identitiesOptions: () =>
				IdentityUserStore.map(item => ({
					item: item,
					optValue: item.id(),
					optText: item.formattedName()
				})),

			canBeSentOrSaved: () => !this.sending() && !this.saving()
		});

		this.addSubscribables({
			sendError: value => !value && this.sendErrorDesc(''),

			savedError: value => !value && this.savedErrorDesc(''),

			sendSuccessButSaveError: value => !value && this.savedErrorDesc(''),

			currentIdentity: value => value && this.from(value.formattedName()),

			from: value => {
				this.canPgpSign(false);
				value = getEmail(value);
				value && PgpUserStore.getKeyForSigning(value).then(result => {
					console.log({
						email: value,
						canPgpSign:result
					});
					this.canPgpSign(result)
				});
			},

			cc: value => {
				if (false === this.showCc() && value.length) {
					this.showCc(true);
				}
				this.initPgpEncrypt();
			},

			bcc: value => {
				if (false === this.showBcc() && value.length) {
					this.showBcc(true);
				}
				this.initPgpEncrypt();
			},

			replyTo: value => {
				if (false === this.showReplyTo() && value.length) {
					this.showReplyTo(true);
				}
			},

			attachmentsInErrorCount: value => {
				if (0 === value) {
					this.attachmentsInErrorError(false);
				}
			},

			to: value => {
				if (this.emptyToError() && value.length) {
					this.emptyToError(false);
				}
				this.initPgpEncrypt();
			},

			attachmentsInProcess: value => {
				if (this.attachmentsInProcessError() && arrayLength(value)) {
					this.attachmentsInProcessError(false);
				}
			}
		});

		decorateKoCommands(this, {
			sendCommand: self => self.canBeSentOrSaved(),
			saveCommand: self => self.canBeSentOrSaved(),
			deleteCommand: self => self.isDraftFolderMessage(),
			skipCommand: self => self.canBeSentOrSaved(),
			contactsCommand: self => self.allowContacts
		});
	}

	async getMessageRequestParams(sSaveFolder, draft)
	{
		const
			identity = this.currentIdentity(),
			params = {
				IdentityID: identity.id(),
				MessageFolder: this.draftsFolder(),
				MessageUid: this.draftUid(),
				SaveFolder: sSaveFolder,
				From: this.from(),
				To: this.to(),
				Cc: this.cc(),
				Bcc: this.bcc(),
				ReplyTo: this.replyTo(),
				Subject: this.subject(),
				DraftInfo: this.aDraftInfo,
				InReplyTo: this.sInReplyTo,
				References: this.sReferences,
				MarkAsImportant: this.markAsImportant() ? 1 : 0,
				Attachments: this.prepareAttachmentsForSendOrSave(),
				// Only used at send, not at save:
				Dsn: this.requestDsn() ? 1 : 0,
				ReadReceiptRequest: this.requestReadReceipt() ? 1 : 0
			},
			recipients = draft ? [identity.email()] : this.allRecipients(),
			sign = !draft && this.pgpSign() && this.canPgpSign(),
			encrypt = this.pgpEncrypt() && this.canPgpEncrypt(),
			TextIsHtml = this.oEditor.isHtml();

		let Text = this.oEditor.getData();
		if (TextIsHtml) {
			let l;
			do {
				l = Text.length;
				Text = Text
					// Remove Microsoft Office styling
					.replace(/(<[^>]+[;"'])\s*mso-[a-z-]+\s*:[^;"']+/gi, '$1')
					// Remove hubspot data-hs- attributes
					.replace(/(<[^>]+)\s+data-hs-[a-z-]+=("[^"]+"|'[^']+')/gi, '$1');
			} while (l != Text.length)
			params.Html = Text;
			params.Text = htmlToPlain(Text);
		} else {
			params.Text = Text;
		}

		if (this.mailvelope && 'mailvelope' === this.viewArea()) {
			params.Encrypted = draft
				? await this.mailvelope.createDraft()
				: await this.mailvelope.encrypt(recipients);
		} else if (sign || encrypt) {
			let data = new MimePart;
			data.headers['Content-Type'] = 'text/'+(TextIsHtml?'html':'plain')+'; charset="utf-8"';
			data.headers['Content-Transfer-Encoding'] = 'base64';
			data.body = base64_encode(Text);
			if (TextIsHtml) {
				const alternative = new MimePart, plain = new MimePart;
				alternative.headers['Content-Type'] = 'multipart/alternative';
				plain.headers['Content-Type'] = 'text/plain; charset="utf-8"';
				plain.headers['Content-Transfer-Encoding'] = 'base64';
				plain.body = base64_encode(params.Text);
				// First add plain
				alternative.children.push(plain);
				// Now add HTML
				alternative.children.push(data);
				data = alternative;
			}
			if (sign && !draft && sign[1]) {
				if ('openpgp' == sign[0]) {
					// Doesn't sign attachments
					params.Html = params.Text = '';
					let signed = new MimePart;
					signed.headers['Content-Type'] =
						'multipart/signed; micalg="pgp-sha256"; protocol="application/pgp-signature"';
					signed.headers['Content-Transfer-Encoding'] = '7Bit';
					signed.children.push(data);
					let signature = new MimePart;
					signature.headers['Content-Type'] = 'application/pgp-signature; name="signature.asc"';
					signature.headers['Content-Transfer-Encoding'] = '7Bit';
					signature.body = await OpenPGPUserStore.sign(data.toString(), sign[1], 1);
					signed.children.push(signature);
					params.Signed = signed.toString();
					params.Boundary = signed.boundary;
					data = signed;
				} else if ('gnupg' == sign[0]) {
					// TODO: sign in PHP fails
//					params.SignData = data.toString();
					params.SignFingerprint = sign[1].fingerprint;
					params.SignPassphrase = await GnuPGUserStore.sign(sign[1]);
				} else {
					throw 'Signing with ' + sign[0] + ' not yet implemented';
				}
			}
			if (encrypt) {
				if ('openpgp' == encrypt) {
					// Doesn't encrypt attachments
					params.Encrypted = await OpenPGPUserStore.encrypt(data.toString(), recipients);
					params.Signed = '';
				} else if ('gnupg' == encrypt) {
					// Does encrypt attachments
					params.EncryptFingerprints = JSON.stringify(GnuPGUserStore.getPublicKeyFingerprints(recipients));
				} else {
					throw 'Encryption with ' + encrypt + ' not yet implemented';
				}
			}
		}
		return params;
	}

	sendCommand() {
		let sSentFolder = FolderUserStore.sentFolder();

		this.attachmentsInProcessError(false);
		this.attachmentsInErrorError(false);
		this.emptyToError(false);

		if (this.attachmentsInProcess().length) {
			this.attachmentsInProcessError(true);
			this.attachmentsArea();
		} else if (this.attachmentsInError().length) {
			this.attachmentsInErrorError(true);
			this.attachmentsArea();
		}

		if (!this.to().trim() && !this.cc().trim() && !this.bcc().trim()) {
			this.emptyToError(true);
		}

		if (!this.emptyToError() && !this.attachmentsInErrorError() && !this.attachmentsInProcessError()) {
			if (SettingsUserStore.replySameFolder()) {
				if (
					3 === arrayLength(this.aDraftInfo) &&
					null != this.aDraftInfo[2] &&
					this.aDraftInfo[2].length
				) {
					sSentFolder = this.aDraftInfo[2];
				}
			}

			if (!sSentFolder) {
				showScreenPopup(FolderSystemPopupView, [SetSystemFoldersNotification.Sent]);
			} else try {
				this.sendError(false);
				this.sending(true);

				if (3 === arrayLength(this.aDraftInfo)) {
					const flagsCache = MessageFlagsCache.getFor(this.aDraftInfo[2], this.aDraftInfo[1]);
					if (isArray(flagsCache)) {
						flagsCache.push(('forward' === this.aDraftInfo[0]) ? '$forwarded' : '\\answered');
						MessageFlagsCache.setFor(this.aDraftInfo[2], this.aDraftInfo[1], flagsCache);
						MessagelistUserStore.reloadFlagsAndCachedMessage();
						setFolderHash(this.aDraftInfo[2], '');
					}
				}

				sSentFolder = UNUSED_OPTION_VALUE === sSentFolder ? '' : sSentFolder;

				this.getMessageRequestParams(sSentFolder).then(params => {
					Remote.request('SendMessage',
						(iError, data) => {
							this.sending(false);
							if (iError) {
								if (Notification.CantSaveMessage === iError) {
									this.sendSuccessButSaveError(true);
									this.savedErrorDesc(i18n('COMPOSE/SAVED_ERROR_ON_SEND').trim());
								} else {
									this.sendError(true);
									this.sendErrorDesc(getNotification(iError, data && data.ErrorMessage)
										|| getNotification(Notification.CantSendMessage));
								}
							} else {
								this.close();
							}
							setFolderHash(this.draftsFolder(), '');
							setFolderHash(sSentFolder, '');
							this.reloadDraftFolder();
						},
						params,
						30000
					);
				}).catch(e => {
					console.error(e);
					this.sendError(true);
					this.sendErrorDesc(e);
					this.sending(false);
				});
			} catch (e) {
				console.error(e);
				this.sendError(true);
				this.sendErrorDesc(e);
				this.sending(false);
			}
		}
	}

	saveCommand() {
		if (FolderUserStore.draftsFolderNotEnabled()) {
			showScreenPopup(FolderSystemPopupView, [SetSystemFoldersNotification.Draft]);
		} else {
			this.savedError(false);
			this.saving(true);
			this.autosaveStart();
			this.getMessageRequestParams(FolderUserStore.draftsFolder(), 1).then(params => {
				Remote.request('SaveMessage',
					(iError, oData) => {
						let result = false;

						this.saving(false);

						if (!iError) {
							if (oData.Result.NewFolder && oData.Result.NewUid) {
								result = true;

								if (this.bFromDraft) {
									const message = MessageUserStore.message();
									if (message && this.draftsFolder() === message.folder && this.draftUid() == message.uid) {
										MessageUserStore.message(null);
									}
								}

								this.draftsFolder(oData.Result.NewFolder);
								this.draftUid(oData.Result.NewUid);

								this.savedTime(new Date);

								if (this.bFromDraft) {
									setFolderHash(this.draftsFolder(), '');
								}
								setFolderHash(FolderUserStore.draftsFolder(), '');
							}
						}

						if (!result) {
							this.savedError(true);
							this.savedErrorDesc(getNotification(Notification.CantSaveMessage));
						}

						this.reloadDraftFolder();
					},
					params,
					200000
				);
			}).catch(e => {
				this.saving(false);
				this.savedError(true);
				this.savedErrorDesc(getNotification(Notification.CantSaveMessage) + ': ' + e);
			});
		}
	}

	deleteCommand() {
		AskPopupView.hidden()
		&& showScreenPopup(AskPopupView, [
			i18n('POPUPS_ASK/DESC_WANT_DELETE_MESSAGES'),
			() => {
				const
					sFromFolderFullName = this.draftsFolder(),
					aUidForRemove = [this.draftUid()];
				messagesDeleteHelper(sFromFolderFullName, aUidForRemove);
				MessagelistUserStore.removeMessagesFromList(sFromFolderFullName, aUidForRemove);
				this.close();
			}
		]);
	}

	onClose() {
		this.skipCommand();
		return false;
	}

	skipCommand() {
		this.bSkipNextHide = true;

		if (
			!this.saving() &&
			!this.sending() &&
			!FolderUserStore.draftsFolderNotEnabled() &&
			SettingsUserStore.allowDraftAutosave()
		) {
			this.saveCommand();
		}

		this.tryToClosePopup();
	}

	contactsCommand() {
		if (this.allowContacts) {
			this.skipCommand();
			setTimeout(() => {
				showScreenPopup(ContactsPopupView, [true, this.sLastFocusedField]);
			}, 200);
		}
	}

	autosaveStart() {
		clearTimeout(this.iTimer);
		this.iTimer = setTimeout(()=>{
			if (this.modalVisible()
				&& !FolderUserStore.draftsFolderNotEnabled()
				&& SettingsUserStore.allowDraftAutosave()
				&& !this.isEmptyForm(false)
				&& !this.saving()
				&& !this.sending()
				&& !this.savedError()
			) {
				this.saveCommand();
			}

			this.autosaveStart();
		}, 60000);
	}

	// getAutocomplete
	emailsSource(oData, fResponse) {
		Remote.request('Suggestions',
			(iError, data) => {
				if (!iError && isArray(data.Result)) {
					fResponse(
						data.Result.map(item => (item && item[0] ? (new EmailModel(item[0], item[1])).toLine(false) : null))
						.filter(v => v)
					);
				} else if (Notification.RequestAborted !== iError) {
					fResponse([]);
				}
			},
			{
				Query: oData.term
//				,Page: 1
			},
			null,
			'',
			['Suggestions']
		);
	}

	reloadDraftFolder() {
		const draftsFolder = FolderUserStore.draftsFolder();
		if (draftsFolder && UNUSED_OPTION_VALUE !== draftsFolder) {
			setFolderHash(draftsFolder, '');
			if (FolderUserStore.currentFolderFullName() === draftsFolder) {
				MessagelistUserStore.reload(true);
			} else {
				rl.app.folderInformation(draftsFolder);
			}
		}
	}

	findIdentityByMessage(composeType, message) {
		let resultIdentity = null;
		const find = addresses => {
			addresses = addresses.map(item => item.email);
			return IdentityUserStore.find(item => addresses.includes(item.email()));
		};

		if (message) {
			switch (composeType) {
				case ComposeType.Reply:
				case ComposeType.ReplyAll:
				case ComposeType.Forward:
				case ComposeType.ForwardAsAttachment:
					resultIdentity = find(message.to.concat(message.cc, message.bcc))/* || find(message.deliveredTo)*/;
					break;
				case ComposeType.Draft:
					resultIdentity = find(message.from.concat(message.replyTo));
					break;
				// no default
//				case ComposeType.Empty:
			}
		}

		return resultIdentity || IdentityUserStore()[0] || null;
	}

	selectIdentity(identity) {
		identity = identity && identity.item;
		if (identity) {
			this.currentIdentity(identity);
			this.setSignatureFromIdentity(identity);
		}
	}

	onHide() {
		// Stop autosave
		clearTimeout(this.iTimer);

		AppUserStore.composeInEdit(this.bSkipNextHide);

		this.bSkipNextHide || this.reset();

		this.bSkipNextHide = false;

		this.to.focused(false);

		(getFullscreenElement() === this.oContent) && exitFullscreen();
	}

	dropMailvelope() {
		if (this.mailvelope) {
			elementById('mailvelope-editor').textContent = '';
			this.mailvelope = null;
		}
	}

	editor(fOnInit) {
		if (fOnInit && this.editorArea()) {
			if (this.oEditor) {
				fOnInit(this.oEditor);
			} else {
				// setTimeout(() => {
				this.oEditor = new HtmlEditor(
					this.editorArea(),
					null,
					() => fOnInit(this.oEditor),
					bHtml => this.isHtml(!!bHtml)
				);
				// }, 1000);
			}
		}
	}

	setSignatureFromIdentity(identity) {
		if (identity) {
			this.editor(editor => {
				let signature = identity.signature() || '',
					isHtml = ':HTML:' === signature.slice(0, 6),
					fromLine = this.oLastMessage ? this.emailArrayToStringLineHelper(this.oLastMessage.from, true) : '';
				if (fromLine) {
					signature = signature.replace(/{{FROM-FULL}}/g, fromLine);
					if (!fromLine.includes(' ') && 0 < fromLine.indexOf('@')) {
						fromLine = fromLine.replace(/@\S+/, '');
					}
					signature = signature.replace(/{{FROM}}/g, fromLine);
				}
				signature = (isHtml ? signature.slice(6) : signature)
					.replace(/\r/g, '')
					.replace(/\s{1,2}?{{FROM}}/g, '')
					.replace(/\s{1,2}?{{FROM-FULL}}/g, '')
					.replace(/{{DATE}}/g, new Date().format('LLLL'))
					.replace(/{{TIME}}/g, new Date().format('LT'))
					.replace(/{{MOMENT:[^}]+}}/g, '');
				editor.setSignature(signature, isHtml, !!identity.signatureInsertBefore());
			});
		}
	}

	/**
	 * @param {string=} type = ComposeType.Empty
	 * @param {?MessageModel|Array=} oMessageOrArray = null
	 * @param {Array=} aToEmails = null
	 * @param {Array=} aCcEmails = null
	 * @param {Array=} aBccEmails = null
	 * @param {string=} sCustomSubject = null
	 * @param {string=} sCustomPlainText = null
	 */
	onShow(type, oMessageOrArray, aToEmails, aCcEmails, aBccEmails, sCustomSubject, sCustomPlainText) {
		this.autosaveStart();

		this.viewModelDom.dataset.wysiwyg = SettingsUserStore.editorDefaultType();

		if (AppUserStore.composeInEdit()) {
			type = type || ComposeType.Empty;
			if (ComposeType.Empty !== type) {
				showScreenPopup(AskPopupView, [
					i18n('COMPOSE/DISCARD_UNSAVED_DATA'),
					() => {
						this.initOnShow(type, oMessageOrArray, aToEmails, aCcEmails, aBccEmails, sCustomSubject, sCustomPlainText);
					},
					null,
					false
				]);
			} else {
				this.addEmailsTo(this.to, aToEmails);
				this.addEmailsTo(this.cc, aCcEmails);
				this.addEmailsTo(this.bcc, aBccEmails);

				if (sCustomSubject && !this.subject()) {
					this.subject(sCustomSubject);
				}
			}
		} else {
			this.initOnShow(type, oMessageOrArray, aToEmails, aCcEmails, aBccEmails, sCustomSubject, sCustomPlainText);
		}

//		(navigator.standalone || matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches) &&
		ThemeStore.isMobile() && this.oContent.requestFullscreen && this.oContent.requestFullscreen();
	}

	/**
	 * @param {Function} fKoValue
	 * @param {Array} emails
	 */
	addEmailsTo(fKoValue, emails) {
		if (arrayLength(emails)) {
			const value = fKoValue().trim(),
				values = emails.map(item => item ? item.toLine(false) : null)
					.validUnique();

			fKoValue(value + (value ? ', ' :  '') + values.join(', ').trim());
		}
	}

	/**
	 *
	 * @param {Array} aList
	 * @param {boolean} bFriendly
	 * @returns {string}
	 */
	emailArrayToStringLineHelper(aList, bFriendly) {
		bFriendly = !!bFriendly;
		return aList.map(item => item.toLine(bFriendly)).join(', ');
	}

	isPlainEditor() {
		let type = SettingsUserStore.editorDefaultType();
		return EditorDefaultType.Html !== type && EditorDefaultType.HtmlForced !== type;
	}

	/**
	 * @param {string=} sType = ComposeType.Empty
	 * @param {?MessageModel|Array=} oMessageOrArray = null
	 * @param {Array=} aToEmails = null
	 * @param {Array=} aCcEmails = null
	 * @param {Array=} aBccEmails = null
	 * @param {string=} sCustomSubject = null
	 * @param {string=} sCustomPlainText = null
	 */
	initOnShow(sType, oMessageOrArray, aToEmails, aCcEmails, aBccEmails, sCustomSubject, sCustomPlainText) {
		let sFrom = '',
			sTo = '',
			sCc = '',
			sDate = '',
			sSubject = '',
			sText = '',
			identity = null,
			aDraftInfo = null,
			message = null;

		const excludeEmail = {},
			mEmail = AccountUserStore.email(),
			lineComposeType = sType || ComposeType.Empty;

		oMessageOrArray = oMessageOrArray || null;
		if (oMessageOrArray) {
			message =
				1 === arrayLength(oMessageOrArray)
					? oMessageOrArray[0]
					: isArray(oMessageOrArray)
					? null
					: oMessageOrArray;
		}

		this.oLastMessage = message;

		if (null !== mEmail) {
			excludeEmail[mEmail] = true;
		}

		this.reset();

		identity = this.findIdentityByMessage(lineComposeType, message);
		if (identity) {
			excludeEmail[identity.email()] = true;
		}

		if (arrayLength(aToEmails)) {
			this.to(this.emailArrayToStringLineHelper(aToEmails));
		}

		if (arrayLength(aCcEmails)) {
			this.cc(this.emailArrayToStringLineHelper(aCcEmails));
		}

		if (arrayLength(aBccEmails)) {
			this.bcc(this.emailArrayToStringLineHelper(aBccEmails));
		}

		if (lineComposeType && message) {
			sDate = timestampToString(message.dateTimeStampInUTC(), 'FULL');
			sSubject = message.subject();
			aDraftInfo = message.aDraftInfo;

			let resplyAllParts = null;
			switch (lineComposeType) {
				case ComposeType.Empty:
					break;

				case ComposeType.Reply:
					this.to(this.emailArrayToStringLineHelper(message.replyEmails(excludeEmail)));
					this.subject(replySubjectAdd('Re', sSubject));
					this.prepareMessageAttachments(message, lineComposeType);
					this.aDraftInfo = ['reply', message.uid, message.folder];
					this.sInReplyTo = message.sMessageId;
					this.sReferences = (this.sInReplyTo + ' ' + message.sReferences).trim();
					break;

				case ComposeType.ReplyAll:
					resplyAllParts = message.replyAllEmails(excludeEmail);
					this.to(this.emailArrayToStringLineHelper(resplyAllParts[0]));
					this.cc(this.emailArrayToStringLineHelper(resplyAllParts[1]));
					this.subject(replySubjectAdd('Re', sSubject));
					this.prepareMessageAttachments(message, lineComposeType);
					this.aDraftInfo = ['reply', message.uid, message.folder];
					this.sInReplyTo = message.sMessageId;
					this.sReferences = (this.sInReplyTo + ' ' + message.references).trim();
					break;

				case ComposeType.Forward:
					this.subject(replySubjectAdd('Fwd', sSubject));
					this.prepareMessageAttachments(message, lineComposeType);
					this.aDraftInfo = ['forward', message.uid, message.folder];
					this.sInReplyTo = message.sMessageId;
					this.sReferences = (this.sInReplyTo + ' ' + message.sReferences).trim();
					break;

				case ComposeType.ForwardAsAttachment:
					this.subject(replySubjectAdd('Fwd', sSubject));
					this.prepareMessageAttachments(message, lineComposeType);
					this.aDraftInfo = ['forward', message.uid, message.folder];
					this.sInReplyTo = message.sMessageId;
					this.sReferences = (this.sInReplyTo + ' ' + message.sReferences).trim();
					break;

				case ComposeType.Draft:
					this.to(this.emailArrayToStringLineHelper(message.to));
					this.cc(this.emailArrayToStringLineHelper(message.cc));
					this.bcc(this.emailArrayToStringLineHelper(message.bcc));
					this.replyTo(this.emailArrayToStringLineHelper(message.replyTo));

					this.bFromDraft = true;

					this.draftsFolder(message.folder);
					this.draftUid(message.uid);

					this.subject(sSubject);
					this.prepareMessageAttachments(message, lineComposeType);

					this.aDraftInfo = 3 === arrayLength(aDraftInfo) ? aDraftInfo : null;
					this.sInReplyTo = message.sInReplyTo;
					this.sReferences = message.sReferences;
					break;

				case ComposeType.EditAsNew:
					this.to(this.emailArrayToStringLineHelper(message.to));
					this.cc(this.emailArrayToStringLineHelper(message.cc));
					this.bcc(this.emailArrayToStringLineHelper(message.bcc));
					this.replyTo(this.emailArrayToStringLineHelper(message.replyTo));

					this.subject(sSubject);
					this.prepareMessageAttachments(message, lineComposeType);

					this.aDraftInfo = 3 === arrayLength(aDraftInfo) ? aDraftInfo : null;
					this.sInReplyTo = message.sInReplyTo;
					this.sReferences = message.sReferences;
					break;
				// no default
			}

			sText = message.bodyAsHTML();
			let encrypted;

			switch (lineComposeType) {
				case ComposeType.Reply:
				case ComposeType.ReplyAll:
					sFrom = message.fromToLine(false, true);
					sText = '<div><p>' + i18n('COMPOSE/REPLY_MESSAGE_TITLE', { DATETIME: sDate, EMAIL: sFrom })
						+ ':</p><blockquote>'
						+ sText.replace(/<img[^>]+>/g, '').replace(/<a\s[^>]+><\/a>/g, '').trim()
						+ '</blockquote></div>';
					break;

				case ComposeType.Forward:
					sFrom = message.fromToLine(false, true);
					sTo = message.toToLine(false, true);
					sCc = message.ccToLine(false, true);
					sText = '<div><p>' + i18n('COMPOSE/FORWARD_MESSAGE_TOP_TITLE') + '</p>'
						+ i18n('GLOBAL/FROM') + ': ' + sFrom
						+ '<br>'
						+ i18n('GLOBAL/TO') + ': ' + sTo
						+ (sCc.length ? '<br>' + i18n('GLOBAL/CC') + ': ' + sCc : '')
						+ '<br>'
						+ i18n('COMPOSE/FORWARD_MESSAGE_TOP_SENT')
						+ ': '
						+ encodeHtml(sDate)
						+ '<br>'
						+ i18n('GLOBAL/SUBJECT')
						+ ': '
						+ encodeHtml(sSubject)
						+ '<br><br>'
						+ sText.trim()
						+ '</div>';
					break;

				case ComposeType.ForwardAsAttachment:
					sText = '';
					break;
				default:
					encrypted = PgpUserStore.isEncrypted(sText);
					if (encrypted) {
						sText = message.plain();
					}
			}

			this.editor(editor => {
				encrypted || editor.setHtml(sText);

				if (encrypted
					|| EditorDefaultType.PlainForced === SettingsUserStore.editorDefaultType()
					|| (!message.isHtml() && EditorDefaultType.HtmlForced !== SettingsUserStore.editorDefaultType())
				) {
					editor.modePlain();
				}

				!encrypted || editor.setPlain(sText);

				if (identity && ComposeType.Draft !== lineComposeType && ComposeType.EditAsNew !== lineComposeType) {
					this.setSignatureFromIdentity(identity);
				}

				this.setFocusInPopup();
			});
		} else if (ComposeType.Empty === lineComposeType) {
			this.subject(null != sCustomSubject ? '' + sCustomSubject : '');

			sText = null != sCustomPlainText ? '' + sCustomPlainText : '';

			this.editor(editor => {
				editor.setHtml(sText);

				if (this.isPlainEditor()) {
					editor.modePlain();
				}

				if (identity) {
					this.setSignatureFromIdentity(identity);
				}

				this.setFocusInPopup();
			});
		} else if (arrayLength(oMessageOrArray)) {
			oMessageOrArray.forEach(item => this.addMessageAsAttachment(item));

			this.editor(editor => {
				if (this.isPlainEditor()) {
					editor.setPlain('')
				} else {
					editor.setHtml('');
				}

				if (identity && ComposeType.Draft !== lineComposeType && ComposeType.EditAsNew !== lineComposeType) {
					this.setSignatureFromIdentity(identity);
				}

				this.setFocusInPopup();
			});
		} else {
			this.setFocusInPopup();
		}

		const downloads = this.getAttachmentsDownloadsForUpload();
		if (arrayLength(downloads)) {
			Remote.request('MessageUploadAttachments',
				(iError, oData) => {
					if (!iError) {
						forEachObjectEntry(oData.Result, (tempName, id) => {
							const attachment = this.getAttachmentById(id);
							if (attachment) {
								attachment.tempName(tempName);
								attachment
									.waiting(false)
									.uploading(false)
									.complete(true);
							}
						});
					} else {
						this.attachments.forEach(attachment => {
							if (attachment && attachment.fromMessage) {
								attachment
									.waiting(false)
									.uploading(false)
									.complete(true)
									.error(getUploadErrorDescByCode(UploadErrorCode.NoFileUploaded));
							}
						});
					}
				},
				{
					Attachments: downloads
				},
				999000
			);
		}

		if (identity) {
			this.currentIdentity(identity);
		}
	}

	setFocusInPopup() {
		setTimeout(() => {
			if (!this.to()) {
				this.to.focused(true);
			} else if (!this.to.focused()) {
				this.oEditor && this.oEditor.focus();
			}
		}, 100);
	}

	tryToClosePopup() {
		if (AskPopupView.hidden()) {
			if (this.bSkipNextHide || (this.isEmptyForm() && !this.draftUid())) {
				this.close();
			} else {
				showScreenPopup(AskPopupView, [
					i18n('POPUPS_ASK/DESC_WANT_CLOSE_THIS_WINDOW'),
					() => this.close()
				]);
			}
		}
	}

	onBuild(dom) {
		// initUploader
		const oJua = new Jua({
				action: serverRequest('Upload'),
				clickElement: dom.querySelector('#composeUploadButton'),
				dragAndDropElement: dom.querySelector('.b-attachment-place')
			}),
			uploadCache = {},
			attachmentSizeLimit = pInt(SettingsGet('AttachmentLimit'));

		oJua
			// .on('onLimitReached', (limit) => {
			// 	alert(limit);
			// })
			.on('onDragEnter', () => {
				this.dragAndDropOver(true);
			})
			.on('onDragLeave', () => {
				this.dragAndDropOver(false);
			})
			.on('onBodyDragEnter', () => {
				this.attachmentsArea();
				this.dragAndDropVisible(true);
			})
			.on('onBodyDragLeave', () => {
				this.dragAndDropVisible(false);
			})
			.on('onProgress', (id, loaded, total) => {
				let item = uploadCache[id];
				if (!item) {
					item = this.getAttachmentById(id);
					if (item) {
						uploadCache[id] = item;
					}
				}

				if (item) {
					item.progress(Math.floor((loaded / total) * 100));
				}
			})
			.on('onSelect', (sId, oData) => {
				this.dragAndDropOver(false);

				const fileName = undefined === oData.FileName ? '' : oData.FileName.toString(),
					size = pInt(oData.Size, null),
					attachment = new ComposeAttachmentModel(sId, fileName, size);

				attachment.cancel = this.cancelAttachmentHelper(sId, oJua);

				this.attachments.push(attachment);

				this.attachmentsArea();

				if (0 < size && 0 < attachmentSizeLimit && attachmentSizeLimit < size) {
					attachment
						.waiting(false)
						.uploading(true)
						.complete(true)
						.error(i18n('UPLOAD/ERROR_FILE_IS_TOO_BIG'));

					return false;
				}

				return true;
			})
			.on('onStart', (id) => {
				let item = uploadCache[id];
				if (!item) {
					item = this.getAttachmentById(id);
					if (item) {
						uploadCache[id] = item;
					}
				}

				if (item) {
					item
						.waiting(false)
						.uploading(true)
						.complete(false);
				}
			})
			.on('onComplete', (id, result, data) => {
				const attachment = this.getAttachmentById(id),
					response = (data && data.Result) || {},
					errorCode = response.ErrorCode,
					attachmentJson = result && response.Attachment;

				let error = '';
				if (null != errorCode) {
					error = getUploadErrorDescByCode(errorCode);
				} else if (!attachmentJson) {
					error = i18n('UPLOAD/ERROR_UNKNOWN');
				}

				if (attachment) {
					if (error) {
						attachment
							.waiting(false)
							.uploading(false)
							.complete(true)
							.error(error + '\n' + response.ErrorMessage);
					} else if (attachmentJson) {
						attachment
							.waiting(false)
							.uploading(false)
							.complete(true);

						attachment.initByUploadJson(attachmentJson);
					}

					if (undefined === uploadCache[id]) {
						delete uploadCache[id];
					}
				}
			});

		this.addAttachmentEnabled(true);

		addShortcut('q', 'meta', ScopeCompose, ()=>false);
		addShortcut('w', 'meta', ScopeCompose, ()=>false);

		addShortcut('m', 'meta', ScopeCompose, () => {
			this.identitiesDropdownTrigger(true);
			return false;
		});

		addShortcut('arrowdown', 'meta', ScopeCompose, () => {
			this.skipCommand();
			return false;
		});

		addShortcut('s', 'meta', ScopeCompose, () => {
			this.saveCommand();
			return false;
		});
		addShortcut('save', '', ScopeCompose, () => {
			this.saveCommand();
			return false;
		});

		if (Settings.app('allowCtrlEnterOnCompose')) {
			addShortcut('enter', 'meta', ScopeCompose, () => {
				this.sendCommand();
				return false;
			});
		}
		addShortcut('mailsend', '', ScopeCompose, () => {
			this.sendCommand();
			return false;
		});

		addShortcut('escape,close', 'shift', ScopeCompose, () => {
			this.tryToClosePopup();
			return false;
		});

		this.editor(editor => editor[this.isPlainEditor()?'modePlain':'modeWysiwyg']());

		// Fullscreen must be on app, else other popups fail
		const el = doc.getElementById('rl-app');
		this.oContent = initFullscreen(el, () =>
			ThemeStore.isMobile()
			&& this.modalVisible()
			&& (getFullscreenElement() !== el)
			&& this.skipCommand()
		);
	}

	/**
	 * @param {string} id
	 * @returns {?Object}
	 */
	getAttachmentById(id) {
		return this.attachments.find(item => item && id === item.id);
	}

	cancelAttachmentHelper(id, oJua) {
		return () => {
			const attachment = this.getAttachmentById(id);
			if (attachment) {
				this.attachments.remove(attachment);
				oJua && oJua.cancel(id);
			}
		};
	}

	/**
	 * @returns {Object}
	 */
	prepareAttachmentsForSendOrSave() {
		const result = {};
		this.attachments.forEach(item => {
			if (item && item.complete() && item.tempName() && item.enabled()) {
				result[item.tempName()] = [item.fileName(), item.isInline ? '1' : '0', item.CID, item.contentLocation];
			}
		});

		return result;
	}

	/**
	 * @param {MessageModel} message
	 */
	addMessageAsAttachment(message) {
		if (message) {
			let temp = message.subject();
			temp = '.eml' === temp.slice(-4).toLowerCase() ? temp : temp + '.eml';

			const attachment = new ComposeAttachmentModel(message.requestHash, temp, message.size());

			attachment.fromMessage = true;
			attachment.cancel = this.cancelAttachmentHelper(message.requestHash);
			attachment
				.waiting(false)
				.uploading(true)
				.complete(true);

			this.attachments.push(attachment);
		}
	}

	/**
	 * @param {string} url
	 * @param {string} name
	 * @param {number} size
	 * @returns {ComposeAttachmentModel}
	 */
	addAttachmentHelper(url, name, size) {
		const attachment = new ComposeAttachmentModel(url, name, size);

		attachment.fromMessage = false;
		attachment.cancel = this.cancelAttachmentHelper(url);
		attachment
			.waiting(false)
			.uploading(true)
			.complete(false);

		this.attachments.push(attachment);

		this.attachmentsArea();

		return attachment;
	}

	/**
	 * @param {MessageModel} message
	 * @param {string} type
	 */
	prepareMessageAttachments(message, type) {
		if (message) {
			if (ComposeType.ForwardAsAttachment === type) {
				this.addMessageAsAttachment(message);
			} else {
				message.attachments.forEach(item => {
					let add = false;
					switch (type) {
						case ComposeType.Reply:
						case ComposeType.ReplyAll:
							break;

						case ComposeType.Forward:
						case ComposeType.Draft:
						case ComposeType.EditAsNew:
							add = true;
							break;
						// no default
					}

					if (add) {
						const attachment = ComposeAttachmentModel.fromAttachment(item);
						attachment.cancel = this.cancelAttachmentHelper(item.download);
						attachment
							.waiting(false)
							.uploading(true)
							.complete(false);

						this.attachments.push(attachment);
					}
				});
			}
		}
	}

	/**
	 * @param {boolean=} includeAttachmentInProgress = true
	 * @returns {boolean}
	 */
	isEmptyForm(includeAttachmentInProgress = true) {
		const withoutAttachment = includeAttachmentInProgress
			? !this.attachments.length
			: !this.attachments.some(item => item && item.complete());

		return (
			!this.to.length &&
			!this.cc.length &&
			!this.bcc.length &&
			!this.replyTo.length &&
			!this.subject.length &&
			withoutAttachment &&
			(!this.oEditor || !this.oEditor.getData())
		);
	}

	reset() {
		this.to('');
		this.cc('');
		this.bcc('');
		this.replyTo('');
		this.subject('');

		this.requestDsn(false);
		this.requestReadReceipt(false);
		this.markAsImportant(false);

		this.bodyArea();

		this.aDraftInfo = null;
		this.sInReplyTo = '';
		this.bFromDraft = false;
		this.sReferences = '';

		this.sendError(false);
		this.sendSuccessButSaveError(false);
		this.savedError(false);
		this.savedTime(0);
		this.emptyToError(false);
		this.attachmentsInProcessError(false);

		this.showCc(false);
		this.showBcc(false);
		this.showReplyTo(false);

		this.pgpSign(false);
		this.pgpEncrypt(false);

		this.attachments([]);

		this.dragAndDropOver(false);
		this.dragAndDropVisible(false);

		this.draftsFolder('');
		this.draftUid(0);

		this.sending(false);
		this.saving(false);

		this.oEditor && this.oEditor.clear();

		this.dropMailvelope();
	}

	/**
	 * @returns {Array}
	 */
	getAttachmentsDownloadsForUpload() {
		return this.attachments.filter(item => item && !item.tempName()).map(
			item => item.id
		);
	}

	mailvelopeArea() {
		if (!this.mailvelope) {
			/**
			 * Creates an iframe with an editor for a new encrypted mail.
			 * The iframe will be injected into the container identified by selector.
			 * https://mailvelope.github.io/mailvelope/Editor.html
			 */
			let text = this.oEditor.getData(),
				encrypted = PgpUserStore.isEncrypted(text),
				size = SettingsGet('PhpUploadSizes')['post_max_size'],
				quota = pInt(size);
			switch (size.slice(-1)) {
				case 'G': quota *= 1024; // fallthrough
				case 'M': quota *= 1024; // fallthrough
				case 'K': quota *= 1024;
			}
			// Issue: can't select signing key
//			this.pgpSign(this.pgpSign() || confirm('Sign this message?'));
			mailvelope.createEditorContainer('#mailvelope-editor', PgpUserStore.mailvelopeKeyring, {
				// https://mailvelope.github.io/mailvelope/global.html#EditorContainerOptions
				quota: Math.max(2048, (quota / 1024)) - 48, // (text + attachments) limit in kilobytes
				armoredDraft: encrypted ? text : '', // Ascii Armored PGP Text Block
				predefinedText: encrypted ? '' : (this.oEditor.isHtml() ? htmlToPlain(text) : text),
/*
				quotedMail: '', // Ascii Armored PGP Text Block mail that should be quoted
				quotedMailIndent: true, // if true the quoted mail will be indented (default: true)
				quotedMailHeader: '', // header to be added before the quoted mail
				keepAttachments: false, // add attachments of quotedMail to editor (default: false)
				// Issue: can't select signing key
				signMsg: this.pgpSign()
*/
			}).then(editor => this.mailvelope = editor);
		}
		this.viewArea('mailvelope');
	}
	attachmentsArea() {
		this.viewArea('attachments');
	}
	bodyArea() {
		this.viewArea('body');
	}

	allRecipients() {
		return [
				// From/sender is also recipient (Sent mailbox)
//				this.currentIdentity().email(),
				this.from(),
				this.to(),
				this.cc(),
				this.bcc()
			].join(',').split(',').map(value => getEmail(value.trim())).validUnique();
	}

	initPgpEncrypt() {
		const recipients = this.allRecipients();
		PgpUserStore.hasPublicKeyForEmails(recipients).then(result => {
			console.log({canPgpEncrypt:result});
			this.canPgpEncrypt(result);
		});
		PgpUserStore.mailvelopeHasPublicKeyForEmails(recipients).then(result => {
			console.log({canMailvelope:result});
			this.canMailvelope(result);
			if (!result) {
				'mailvelope' === this.viewArea() && this.bodyArea();
//				this.dropMailvelope();
			}
		});
	}

	togglePgpSign() {
		this.pgpSign(!this.pgpSign()/* && this.canPgpSign()*/);
	}

	togglePgpEncrypt() {
		this.pgpEncrypt(!this.pgpEncrypt()/* && this.canPgpEncrypt()*/);
	}
}
