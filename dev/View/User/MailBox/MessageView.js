import ko from 'ko';
import { koComputable } from 'External/ko';

import { UNUSED_OPTION_VALUE } from 'Common/Consts';

import { Scope } from 'Common/Enums';

import {
	ComposeType,
	ClientSideKeyNameLastReplyAction,
	ClientSideKeyNameMessageHeaderFullInfo,
	ClientSideKeyNameMessageAttachmentControls,
	FolderType,
	MessageSetAction
} from 'Common/EnumsUser';

import {
	elementById,
	$htmlCL,
	leftPanelDisabled,
	keyScopeReal,
	moveAction,
	Settings,
	SettingsCapa,
	getFullscreenElement,
	exitFullscreen,
	fireEvent,
	addShortcut,
	registerShortcut
} from 'Common/Globals';

import { arrayLength } from 'Common/Utils';
import { download, mailToHelper, showMessageComposer, initFullscreen } from 'Common/UtilsUser';

import { SMAudio } from 'Common/Audio';

import { i18n } from 'Common/Translator';
import { attachmentDownload } from 'Common/Links';

import { MessageFlagsCache } from 'Common/Cache';

import { AppUserStore } from 'Stores/User/App';
import { SettingsUserStore } from 'Stores/User/Settings';
import { AccountUserStore } from 'Stores/User/Account';
import { FolderUserStore } from 'Stores/User/Folder';
import { MessageUserStore } from 'Stores/User/Message';
import { MessagelistUserStore } from 'Stores/User/Messagelist';
import { ThemeStore } from 'Stores/Theme';

import * as Local from 'Storage/Client';

import Remote from 'Remote/User/Fetch';

import { decorateKoCommands } from 'Knoin/Knoin';
import { AbstractViewRight } from 'Knoin/AbstractViews';

import { PgpUserStore } from 'Stores/User/Pgp';

import { MimeToMessage } from 'Mime/Utils';

const
	oMessageScrollerDom = () => elementById('messageItem') || {},

	currentMessage = () => MessageUserStore.message();

export class MailMessageView extends AbstractViewRight {
	constructor() {
		super();

		const
			/**
			 * @param {Function} fExecute
			 * @param {Function} fCanExecute = true
			 * @returns {Function}
			 */
			createCommand = (fExecute, fCanExecute) => {
				let fResult = () => {
						fResult.canExecute() && fExecute.call(null);
						return false;
					};
				fResult.canExecute = koComputable(() => fCanExecute());
				return fResult;
			},

			createCommandReplyHelper = type =>
				createCommand(() => this.replyOrforward(type), this.canBeRepliedOrForwarded),

			createCommandActionHelper = (folderType, useFolder) =>
				createCommand(() => {
					const message = currentMessage();
					if (message) {
						MessageUserStore.message(null);
						rl.app.deleteMessagesFromFolder(folderType, message.folder, [message.uid], useFolder);
					}
				}, this.messageVisibility);

		this.addObservables({
			showAttachmentControls: false,
			downloadAsZipLoading: false,
			lastReplyAction_: '',
			showFullInfo: '1' === Local.get(ClientSideKeyNameMessageHeaderFullInfo),
			moreDropdownTrigger: false,

			// viewer
			viewFromShort: '',
			viewFromDkimData: ['none', ''],
			viewToShort: ''
		});

		this.moveAction = moveAction;

		this.allowMessageActions = SettingsCapa('MessageActions');

		const attachmentsActions = Settings.app('attachmentsActions');
		this.attachmentsActions = ko.observableArray(arrayLength(attachmentsActions) ? attachmentsActions : []);

		this.message = MessageUserStore.message;
		this.hasCheckedMessages = MessagelistUserStore.hasCheckedMessages;
		this.messageLoadingThrottle = MessageUserStore.loading;
		this.messagesBodiesDom = MessageUserStore.bodiesDom;
		this.messageError = MessageUserStore.error;

		this.fullScreenMode = MessageUserStore.fullScreen;
		this.toggleFullScreen = MessageUserStore.toggleFullScreen;

		this.messageListOfThreadsLoading = ko.observable(false).extend({ rateLimit: 1 });
		this.highlightUnselectedAttachments = ko.observable(false).extend({ falseTimeout: 2000 });

		this.showAttachmentControlsState = v => Local.set(ClientSideKeyNameMessageAttachmentControls, !!v);

		this.downloadAsZipError = ko.observable(false).extend({ falseTimeout: 7000 });

		this.messageDomFocused = ko.observable(false).extend({ rateLimit: 0 });

		// viewer
		this.viewHash = '';

		this.addComputables({
			allowAttachmentControls: () => this.attachmentsActions.length && SettingsCapa('AttachmentsActions'),

			downloadAsZipAllowed: () => this.attachmentsActions.includes('zip') && this.allowAttachmentControls(),

			lastReplyAction: {
				read: this.lastReplyAction_,
				write: value => this.lastReplyAction_(
					[ComposeType.Reply, ComposeType.ReplyAll, ComposeType.Forward].includes(value)
						? ComposeType.Reply
						: value
				)
			},

			messageVisibility: () => !MessageUserStore.loading() && !!currentMessage(),

			canBeRepliedOrForwarded: () => !this.isDraftFolder() && this.messageVisibility(),

			viewFromDkimVisibility: () => 'none' !== this.viewFromDkimData()[0],

			viewFromDkimStatusIconClass:() => {
				switch (this.viewFromDkimData()[0]) {
					case 'none':
						return '';
					case 'pass':
						return 'icon-ok iconcolor-green';
					default:
						return 'icon-warning-alt iconcolor-red';
				}
			},

			viewFromDkimStatusTitle:() => {
				const status = this.viewFromDkimData();
				if (arrayLength(status) && status[0]) {
					return status[1] || 'DKIM: ' + status[0];
				}

				return '';
			},

			pgpSupported: () => currentMessage() && PgpUserStore.isSupported(),

			messageListOrViewLoading:
				() => MessagelistUserStore.isLoading() | MessageUserStore.loading()
		});

		this.addSubscribables({
			showAttachmentControls: v => currentMessage()
				&& currentMessage().attachments.forEach(item => item && item.checked(!!v)),

			lastReplyAction_: value => Local.set(ClientSideKeyNameLastReplyAction, value),

			message: message => {
				MessageUserStore.activeDom(null);

				if (message) {
					this.showAttachmentControls(false);
					if (Local.get(ClientSideKeyNameMessageAttachmentControls)) {
						setTimeout(() => {
							this.showAttachmentControls(true);
						}, 50);
					}

					if (this.viewHash !== message.hash) {
						this.scrollMessageToTop();
					}

					this.viewHash = message.hash;
					this.viewFromShort(message.fromToLine(true, true));
					this.viewFromDkimData(message.fromDkimData());
					this.viewToShort(message.toToLine(true, true));
				} else {
					MessagelistUserStore.selectedMessage(null);

					this.viewHash = '';

					this.scrollMessageToTop();
				}
			},

			fullScreenMode: value => {
				value && currentMessage() && AppUserStore.focusedState(Scope.MessageView);
				if (this.oContent) {
					value ? this.oContent.requestFullscreen() : exitFullscreen();
				} else {
					$htmlCL.toggle('rl-message-fullscreen', value);
				}
			},

			showFullInfo: value => Local.set(ClientSideKeyNameMessageHeaderFullInfo, value ? '1' : '0')
		});

		this.lastReplyAction(Local.get(ClientSideKeyNameLastReplyAction) || ComposeType.Reply);

		// commands
		this.replyCommand = createCommandReplyHelper(ComposeType.Reply);
		this.replyAllCommand = createCommandReplyHelper(ComposeType.ReplyAll);
		this.forwardCommand = createCommandReplyHelper(ComposeType.Forward);
		this.forwardAsAttachmentCommand = createCommandReplyHelper(ComposeType.ForwardAsAttachment);
		this.editAsNewCommand = createCommandReplyHelper(ComposeType.EditAsNew);

		this.deleteCommand = createCommandActionHelper(FolderType.Trash, true);
		this.deleteWithoutMoveCommand = createCommandActionHelper(FolderType.Trash, false);
		this.archiveCommand = createCommandActionHelper(FolderType.Archive, true);
		this.spamCommand = createCommandActionHelper(FolderType.Spam, true);
		this.notSpamCommand = createCommandActionHelper(FolderType.NotSpam, true);

		decorateKoCommands(this, {
			messageEditCommand: self => self.messageVisibility(),
			goUpCommand: self => !self.messageListOrViewLoading(),
			goDownCommand: self => !self.messageListOrViewLoading()
		});
	}

	closeMessage() {
		MessageUserStore.message(null);
	}

	messageEditCommand() {
		if (currentMessage()) {
			showMessageComposer([ComposeType.Draft, currentMessage()]);
		}
	}

	goUpCommand() {
		fireEvent('mailbox.message-list.selector.go-up',
			SettingsUserStore.usePreviewPane() || !!currentMessage() // bForceSelect
		);
	}

	goDownCommand() {
		fireEvent('mailbox.message-list.selector.go-down',
			SettingsUserStore.usePreviewPane() || !!currentMessage() // bForceSelect
		);
	}

	/**
	 * @param {string} sType
	 * @returns {void}
	 */
	replyOrforward(sType) {
		this.lastReplyAction(sType);
		showMessageComposer([sType, currentMessage()]);
	}

	onBuild(dom) {
		const el = dom.querySelector('.b-content');
		this.oContent = initFullscreen(el, () => MessageUserStore.fullScreen(getFullscreenElement() === el));

		const eqs = (ev, s) => ev.target.closestWithin(s, dom);
		dom.addEventListener('click', event => {
			ThemeStore.isMobile() && leftPanelDisabled(true);

			let el = eqs(event, 'a');
			if (el) {
				return !(
					0 === event.button &&
					mailToHelper(el.href)
				);
			}

			if (eqs(event, '.attachmentsPlace .attachmentIconParent')) {
				event.stopPropagation();
			}

			el = eqs(event, '.attachmentsPlace .showPreplay');
			if (el) {
				event.stopPropagation();
				const attachment = ko.dataFor(el);
				if (attachment && SMAudio.supported) {
					switch (true) {
						case SMAudio.supportedMp3 && attachment.isMp3():
							SMAudio.playMp3(attachment.linkDownload(), attachment.fileName);
							break;
						case SMAudio.supportedOgg && attachment.isOgg():
							SMAudio.playOgg(attachment.linkDownload(), attachment.fileName);
							break;
						case SMAudio.supportedWav && attachment.isWav():
							SMAudio.playWav(attachment.linkDownload(), attachment.fileName);
							break;
						// no default
					}
				}
			}

			el = eqs(event, '.attachmentsPlace .attachmentItem .attachmentNameParent');
			if (el) {
				const attachment = ko.dataFor(el);
				attachment && attachment.linkDownload() && download(attachment.linkDownload(), attachment.fileName);
			}

			if (eqs(event, '.messageItemHeader .subjectParent .flagParent')) {
				const message = currentMessage();
				message && MessagelistUserStore.setAction(
					message.folder,
					message.isFlagged() ? MessageSetAction.UnsetFlag : MessageSetAction.SetFlag,
					[message]
				);
			}
		});

		AppUserStore.focusedState.subscribe(value => {
			if (Scope.MessageView !== value) {
				this.scrollMessageToTop();
				this.scrollMessageToLeft();
			}
		});

		keyScopeReal.subscribe(value => this.messageDomFocused(Scope.MessageView === value));

		// initShortcuts

		// exit fullscreen, back
		addShortcut('escape', '', Scope.MessageView, () => {
			if (!this.viewModelDom.hidden && currentMessage()) {
				const preview = SettingsUserStore.usePreviewPane();
				if (MessageUserStore.fullScreen()) {
					MessageUserStore.fullScreen(false);

					if (preview) {
						AppUserStore.focusedState(Scope.MessageList);
					}
				} else if (!preview) {
					MessageUserStore.message(null);
				} else {
					AppUserStore.focusedState(Scope.MessageList);
				}

				return false;
			}
		});

		// fullscreen
		addShortcut('enter,open', '', Scope.MessageView, () => {
			MessageUserStore.toggleFullScreen();
			return false;
		});

		// reply
		registerShortcut('r,mailreply', '', [Scope.MessageList, Scope.MessageView], () => {
			if (currentMessage()) {
				this.replyCommand();
				return false;
			}
			return true;
		});

		// replyAll
		registerShortcut('a', '', [Scope.MessageList, Scope.MessageView], () => {
			if (currentMessage()) {
				this.replyAllCommand();
				return false;
			}
		});
		registerShortcut('mailreply', 'shift', [Scope.MessageList, Scope.MessageView], () => {
			if (currentMessage()) {
				this.replyAllCommand();
				return false;
			}
		});

		// forward
		registerShortcut('f,mailforward', '', [Scope.MessageList, Scope.MessageView], () => {
			if (currentMessage()) {
				this.forwardCommand();
				return false;
			}
		});

		// message information
		registerShortcut('i', 'meta', [Scope.MessageList, Scope.MessageView], () => {
			if (currentMessage()) {
				this.showFullInfo(!this.showFullInfo());
			}
			return false;
		});

		// toggle message blockquotes
		registerShortcut('b', '', [Scope.MessageList, Scope.MessageView], () => {
			const message = currentMessage();
			if (message && message.body) {
				message.body.querySelectorAll('.rlBlockquoteSwitcher').forEach(node => node.click());
				return false;
			}
		});

		addShortcut('arrowup,arrowleft', 'meta', [Scope.MessageList, Scope.MessageView], () => {
			this.goUpCommand();
			return false;
		});

		addShortcut('arrowdown,arrowright', 'meta', [Scope.MessageList, Scope.MessageView], () => {
			this.goDownCommand();
			return false;
		});

		// print
		addShortcut('p,printscreen', 'meta', [Scope.MessageView, Scope.MessageList], () => {
			currentMessage() && currentMessage().printMessage();
			return false;
		});

		// delete
		addShortcut('delete', '', Scope.MessageView, () => {
			this.deleteCommand();
			return false;
		});
		addShortcut('delete', 'shift', Scope.MessageView, () => {
			this.deleteWithoutMoveCommand();
			return false;
		});

		// change focused state
		addShortcut('arrowleft', '', Scope.MessageView, () => {
			if (!MessageUserStore.fullScreen() && currentMessage() && SettingsUserStore.usePreviewPane()
			 && !oMessageScrollerDom().scrollLeft) {
				AppUserStore.focusedState(Scope.MessageList);
				return false;
			}
		});
		addShortcut('tab', 'shift', Scope.MessageView, () => {
			if (!MessageUserStore.fullScreen() && currentMessage() && SettingsUserStore.usePreviewPane()) {
				AppUserStore.focusedState(Scope.MessageList);
			}
			return false;
		});
	}

	/**
	 * @returns {boolean}
	 */
	isDraftFolder() {
		return currentMessage() && FolderUserStore.draftsFolder() === currentMessage().folder;
	}

	/**
	 * @returns {boolean}
	 */
	isSentFolder() {
		return currentMessage() && FolderUserStore.sentFolder() === currentMessage().folder;
	}

	/**
	 * @returns {boolean}
	 */
	isSpamFolder() {
		return currentMessage() && FolderUserStore.spamFolder() === currentMessage().folder;
	}

	/**
	 * @returns {boolean}
	 */
	isSpamDisabled() {
		return currentMessage() && FolderUserStore.spamFolder() === UNUSED_OPTION_VALUE;
	}

	/**
	 * @returns {boolean}
	 */
	isArchiveFolder() {
		return currentMessage() && FolderUserStore.archiveFolder() === currentMessage().folder;
	}

	/**
	 * @returns {boolean}
	 */
	isArchiveDisabled() {
		return currentMessage() && FolderUserStore.archiveFolder() === UNUSED_OPTION_VALUE;
	}

	/**
	 * @returns {boolean}
	 */
	isDraftOrSentFolder() {
		return this.isDraftFolder() || this.isSentFolder();
	}

	composeClick() {
		showMessageComposer();
	}

	scrollMessageToTop() {
		oMessageScrollerDom().scrollTop = (50 < oMessageScrollerDom().scrollTop) ? 50 : 0;
	}

	scrollMessageToLeft() {
		oMessageScrollerDom().scrollLeft = 0;
	}

	downloadAsZip() {
		const hashes = (currentMessage() ? currentMessage().attachments : [])
			.map(item => (item && !item.isLinked() && item.checked() ? item.download : ''))
			.filter(v => v);
		if (hashes.length) {
			Remote.post('AttachmentsActions', this.downloadAsZipLoading, {
				Do: 'Zip',
				Hashes: hashes
			})
			.then(result => {
				let hash = result && result.Result && result.Result.FileHash;
				if (hash) {
					download(attachmentDownload(hash), hash+'.zip');
				} else {
					this.downloadAsZipError(true);
				}
			})
			.catch(() => this.downloadAsZipError(true));
		} else {
			this.highlightUnselectedAttachments(true);
		}
	}

	/**
	 * @param {MessageModel} oMessage
	 * @returns {void}
	 */
	showImages() {
		currentMessage().showExternalImages();
	}

	/**
	 * @returns {string}
	 */
	printableCheckedMessageCount() {
		const cnt = MessagelistUserStore.listCheckedOrSelectedUidsWithSubMails().length;
		return 0 < cnt ? (100 > cnt ? cnt : '99+') : '';
	}

	/**
	 * @param {MessageModel} oMessage
	 * @returns {void}
	 */
	readReceipt() {
		let oMessage = currentMessage()
		if (oMessage.readReceipt()) {
			Remote.request('SendReadReceiptMessage', null, {
				MessageFolder: oMessage.folder,
				MessageUid: oMessage.uid,
				ReadReceipt: oMessage.readReceipt(),
				Subject: i18n('READ_RECEIPT/SUBJECT', { SUBJECT: oMessage.subject() }),
				Text: i18n('READ_RECEIPT/BODY', { 'READ-RECEIPT': AccountUserStore.email() })
			});

			oMessage.flags.push('$mdnsent');
//			oMessage.flags.valueHasMutated();

			MessageFlagsCache.store(oMessage);

			MessagelistUserStore.reloadFlagsAndCachedMessage();
		}
	}

	pgpDecrypt() {
		const oMessage = currentMessage();
		PgpUserStore.decrypt(oMessage).then(result => {
			if (result) {
				oMessage.pgpDecrypted(true);
				if (result.data) {
					MimeToMessage(result.data, oMessage);
					oMessage.html() ? oMessage.viewHtml() : oMessage.viewPlain();
					if (result.signatures && result.signatures.length) {
						oMessage.pgpSigned(true);
						oMessage.pgpVerified({
							signatures: result.signatures,
							success: !!result.signatures.length
						});
					}
				}
			}
		});
	}

	pgpVerify(/*self, event*/) {
		const oMessage = currentMessage()/*, ctrl = event.target.closest('.openpgp-control')*/;
		PgpUserStore.verify(oMessage).then(result => {
			if (result) {
				oMessage.pgpVerified(result);
			}
/*
			if (result && result.success) {
				i18n('OPENPGP/GOOD_SIGNATURE', {
					USER: validKey.user + ' (' + validKey.id + ')'
				});
				message.getText()
			} else {
				const keyIds = arrayLength(signingKeyIds) ? signingKeyIds : null,
					additional = keyIds
						? keyIds.map(item => (item && item.toHex ? item.toHex() : null)).filter(v => v).join(', ')
						: '';

				i18n('OPENPGP/ERROR', {
					ERROR: 'message'
				}) + (additional ? ' (' + additional + ')' : '');
			}
*/
		});
	}

}
