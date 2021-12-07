import { Scope } from 'Common/Enums';
import { keyScope, leftPanelDisabled, SettingsGet, elementById } from 'Common/Globals';
import { addObservablesTo } from 'Common/Utils';
import { ThemeStore } from 'Stores/Theme';

export const AppUserStore = {
	allowContacts: () => !!SettingsGet('ContactsIsAllowed')
};

addObservablesTo(AppUserStore, {
	focusedState: Scope.None,

	threadsAllowed: false,

	composeInEdit: false
});

AppUserStore.focusedState.subscribe(value => {
	switch (value) {
		case Scope.MessageList:
		case Scope.MessageView:
		case Scope.FolderList:
			keyScope(value);
			ThemeStore.isMobile() && leftPanelDisabled(Scope.FolderList !== value);
			break;
	}
	['FolderList','MessageList','MessageView'].forEach(name => {
		let dom = elementById('V-Mail'+name);
		dom && dom.classList.toggle('focused', name === value);
	});
});
