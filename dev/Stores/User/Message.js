import { Scope } from 'Common/Enums';
import { elementById } from 'Common/Globals';
import { addObservablesTo, addSubscribablesTo } from 'External/ko';

import { AppUserStore } from 'Stores/User/App';
import { SettingsUserStore } from 'Stores/User/Settings';

export const MessageUserStore = new class {
	constructor() {
		addObservablesTo(this, {
			// message viewer
			message: null,
			error: '',
			loading: false,
			fullScreen: false,

			// Cache mail bodies
			bodiesDom: null,
			activeDom: null
		});

		// Subscribers

		addSubscribablesTo(this, {
			message: message => {
				clearTimeout(this.MessageSeenTimer);
				elementById('rl-right').classList.toggle('message-selected', !!message);
				if (message) {
					if (!SettingsUserStore.usePreviewPane()) {
						AppUserStore.focusedState(Scope.MessageView);
					}
				} else {
					AppUserStore.focusedState(Scope.MessageList);

					this.fullScreen(false);
					this.hideMessageBodies();
				}
			},
		});

		this.purgeMessageBodyCache = this.purgeMessageBodyCache.throttle(30000);
	}

	toggleFullScreen() {
		MessageUserStore.fullScreen(!MessageUserStore.fullScreen());
	}

	purgeMessageBodyCache() {
		const messagesDom = this.bodiesDom(),
			children = messagesDom && messagesDom.children;
		if (children) {
			while (15 < children.length) {
				children[0].remove();
			}
		}
	}

	hideMessageBodies() {
		const messagesDom = this.bodiesDom();
		messagesDom && Array.from(messagesDom.children).forEach(el => el.hidden = true);
	}
};
