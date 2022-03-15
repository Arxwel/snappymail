import { Settings } from 'Common/Globals';
import { i18n } from 'Common/Translator';

import { root } from 'Common/Links';

export default App => {

	rl.app = App;
	rl.logoutReload = App.logoutReload;

	rl.i18n = i18n;

	rl.Enums = {
		StorageResultType: {
			Success: 0,
			Error: 1,
			Abort: 2
		}
	};

	rl.route = {
		root: () => {
			rl.route.off();
			hasher.setHash(root());
		},
		reload: () => {
			rl.route.root();
			setTimeout(() => (Settings.app('inIframe') ? parent : window).location.reload(), 100);
		},
		off: () => hasher.active = false,
		on: () => hasher.active = true
	};

	rl.fetch = (resource, init, postData) => {
		init = Object.assign({
			mode: 'same-origin',
			cache: 'no-cache',
			redirect: 'error',
			referrerPolicy: 'no-referrer',
			credentials: 'same-origin',
			headers: {}
		}, init);
		if (postData) {
			init.method = 'POST';
			init.headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
			const buildFormData = (formData, data, parentKey) => {
				if (data && typeof data === 'object' && !(data instanceof Date || data instanceof File)) {
					Object.keys(data).forEach(key =>
						buildFormData(formData, data[key], parentKey ? `${parentKey}[${key}]` : key)
					);
				} else {
					formData.set(parentKey, data == null ? '' : data);
				}
				return formData;
			};
			postData = (postData instanceof FormData)
				? postData
				: buildFormData(new FormData(), postData);
			postData.set('XToken', Settings.app('token'));
//			init.body = JSON.stringify(Object.fromEntries(postData));
			init.body = new URLSearchParams(postData);
		}

		return fetch(resource, init);
	};

	rl.fetchJSON = (resource, init, postData) => {
		init = Object.assign({ headers: {} }, init);
		init.headers.Accept = 'application/json';
		return rl.fetch(resource, init, postData).then(response => {
			if (!response.ok) {
				return Promise.reject('Network response error: ' + response.status);
			}
			/* TODO: use this for non-developers?
			response.clone()
			let data = response.text();
			try {
				return JSON.parse(data);
			} catch (e) {
				console.error(e);
//				console.log(data);
				return Promise.reject(Notification.JsonParse);
				return {
					Result: false,
					ErrorCode: 952, // Notification.JsonParse
					ErrorMessage: e.message,
					ErrorMessageAdditional: data
				}
			}
			*/
			return response.json();
		});
	};

};
