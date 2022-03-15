import ko from 'ko';
import { i18nToNodes } from 'Common/Translator';
import { doc, createElement } from 'Common/Globals';
import { SaveSettingsStep } from 'Common/Enums';
import { arrayLength, isFunction, forEachObjectEntry } from 'Common/Utils';

export const
	errorTip = (element, value) => value
			? setTimeout(() => element.setAttribute('data-rainloopErrorTip', value), 100)
			: element.removeAttribute('data-rainloopErrorTip'),

	/**
	 * The value of the pureComputed observable shouldn’t vary based on the
	 * number of evaluations or other “hidden” information. Its value should be
	 * based solely on the values of other observables in the application
	 */
	koComputable = fn => ko.computed(fn, {'pure':true}),

	addObservablesTo = (target, observables) =>
		forEachObjectEntry(observables, (key, value) =>
			target[key] || (target[key] = /*isArray(value) ? ko.observableArray(value) :*/ ko.observable(value)) ),

	addComputablesTo = (target, computables) =>
		forEachObjectEntry(computables, (key, fn) => target[key] = koComputable(fn)),

	addSubscribablesTo = (target, subscribables) =>
		forEachObjectEntry(subscribables, (key, fn) => target[key].subscribe(fn)),

	dispose = disposable => disposable && isFunction(disposable.dispose) && disposable.dispose(),

	// With this we don't need delegateRunOnDestroy
	koArrayWithDestroy = data => {
		data = ko.observableArray(data);
		data.subscribe(changes =>
			changes.forEach(item =>
				'deleted' === item.status && null == item.moved && item.value.onDestroy && item.value.onDestroy()
			)
		, data, 'arrayChange');
		return data;
	};

Object.assign(ko.bindingHandlers, {
	tooltipErrorTip: {
		init: (element, fValueAccessor) => {
			doc.addEventListener('click', () => {
				let value = fValueAccessor();
				ko.isObservable(value) && !ko.isComputed(value) && value('');
				errorTip(element);
			});
		},
		update: (element, fValueAccessor) => {
			let value = ko.unwrap(fValueAccessor());
			value = isFunction(value) ? value() : value;
			errorTip(element, value);
		}
	},

	onEnter: {
		init: (element, fValueAccessor, fAllBindings, viewModel) => {
			let fn = event => {
				if ('Enter' == event.key) {
					element.dispatchEvent(new Event('change'));
					fValueAccessor().call(viewModel);
				}
			};
			element.addEventListener('keydown', fn);
			ko.utils.domNodeDisposal.addDisposeCallback(element, () => element.removeEventListener('keydown', fn));
		}
	},

	onSpace: {
		init: (element, fValueAccessor, fAllBindings, viewModel) => {
			let fn = event => {
				if (' ' == event.key) {
					fValueAccessor().call(viewModel, event);
				}
			};
			element.addEventListener('keyup', fn);
			ko.utils.domNodeDisposal.addDisposeCallback(element, () => element.removeEventListener('keyup', fn));
		}
	},

	i18nInit: {
		init: element => i18nToNodes(element)
	},

	i18nUpdate: {
		update: (element, fValueAccessor) => {
			ko.unwrap(fValueAccessor());
			i18nToNodes(element);
		}
	},

	title: {
		update: (element, fValueAccessor) => element.title = ko.unwrap(fValueAccessor())
	},

	command: {
		init: (element, fValueAccessor, fAllBindings, viewModel, bindingContext) => {
			const command = fValueAccessor();

			if (!command || !command.canExecute) {
				throw new Error('Value should be a command');
			}

			ko.bindingHandlers['FORM'==element.nodeName ? 'submit' : 'click'].init(
				element,
				fValueAccessor,
				fAllBindings,
				viewModel,
				bindingContext
			);
		},
		update: (element, fValueAccessor) => {
			const cl = element.classList,
				command = fValueAccessor();

			let disabled = !command.canExecute();
			cl.toggle('disabled', disabled);

			if (element.matches('INPUT,TEXTAREA,BUTTON')) {
				element.disabled = disabled;
			}
		}
	},

	saveTrigger: {
		init: (element) => {
			let icon = element;
			if (element.matches('input,select,textarea')) {
				element.classList.add('settings-saved-trigger-input');
				element.after(element.saveTriggerIcon = icon = createElement('span'));
			}
			icon.classList.add('settings-save-trigger');
		},
		update: (element, fValueAccessor) => {
			const value = parseInt(ko.unwrap(fValueAccessor()),10);
			let cl = (element.saveTriggerIcon || element).classList;
			if (element.saveTriggerIcon) {
				cl.toggle('saving', value === SaveSettingsStep.Animate);
				cl.toggle('success', value === SaveSettingsStep.TrueResult);
				cl.toggle('error', value === SaveSettingsStep.FalseResult);
			}
			cl = element.classList;
			cl.toggle('success', value === SaveSettingsStep.TrueResult);
			cl.toggle('error', value === SaveSettingsStep.FalseResult);
		}
	}
});

// extenders

ko.extenders.limitedList = (target, limitedList) => {
	const result = ko
		.computed({
			read: target,
			write: newValue => {
				let currentValue = target(),
					list = ko.unwrap(limitedList);
				list = arrayLength(list) ? list : [''];
				if (!list.includes(newValue)) {
					newValue = list.includes(currentValue, list) ? currentValue : list[0];
					target(newValue + ' ');
				}
				target(newValue);
			}
		})
		.extend({ notify: 'always' });

	result(target());

	if (!result.valueHasMutated) {
		result.valueHasMutated = () => target.valueHasMutated();
	}

	return result;
};

ko.extenders.toggleSubscribeProperty = (target, options) => {
	const prop = options[1];
	if (prop) {
		target.subscribe(
			prev => prev && prev[prop] && prev[prop](false),
			options[0],
			'beforeChange'
		);

		target.subscribe(next => next && next[prop] && next[prop](true), options[0]);
	}

	return target;
};

ko.extenders.falseTimeout = (target, option) => {
	target.subscribe((() => target(false)).debounce(parseInt(option, 10) || 0));
	return target;
};

// functions

ko.observable.fn.askDeleteHelper = function() {
	return this.extend({ falseTimeout: 3000, toggleSubscribeProperty: [this, 'askDelete'] });
};
