/**
 * https://tools.ietf.org/html/rfc5228#section-8
 */

import { capa, forEachObjectEntry } from 'Sieve/Utils';

import {
	BRACKET_COMMENT,
	HASH_COMMENT,
	IDENTIFIER,
	MULTI_LINE,
	NUMBER,
	QUOTED_STRING,
	STRING_LIST,
	TAG
} from 'Sieve/RegEx';

import {
	GrammarBracketComment,
	GrammarCommand,
	GrammarHashComment,
	GrammarMultiLine,
	GrammarNumber,
	GrammarQuotedString,
	GrammarStringList,
	GrammarTest,
	GrammarTestList
} from 'Sieve/Grammar';

import {
	ConditionalCommand,
	DiscardCommand,
	ElsIfCommand,
	ElseCommand,
	FileIntoCommand,
	IfCommand,
	KeepCommand,
	RedirectCommand,
	RequireCommand,
	StopCommand
} from 'Sieve/Commands';

import {
	AddressTest,
	AllOfTest,
	AnyOfTest,
	EnvelopeTest,
	ExistsTest,
	FalseTest,
	HeaderTest,
	NotTest,
	SizeTest,
	TrueTest
} from 'Sieve/Tests';

import { BodyTest } from 'Sieve/Extensions/rfc5173';
import { EnvironmentTest } from 'Sieve/Extensions/rfc5183';
import { SetCommand, StringTest } from 'Sieve/Extensions/rfc5229';
import { VacationCommand } from 'Sieve/Extensions/rfc5230';

import {
	SetFlagCommand,
	AddFlagCommand,
	RemoveFlagCommand,
	HasFlagTest
} from 'Sieve/Extensions/rfc5232';

import { SpamTestTest, VirusTestTest } from 'Sieve/Extensions/rfc5235';
import { DateTest, CurrentDateTest } from 'Sieve/Extensions/rfc5260';
import { AddHeaderCommand, DeleteHeaderCommand } from 'Sieve/Extensions/rfc5293';
import { ErejectCommand, RejectCommand } from 'Sieve/Extensions/rfc5429';
import { NotifyCommand, ValidNotifyMethodTest, NotifyMethodCapabilityTest } from 'Sieve/Extensions/rfc5435';
import { IHaveTest, ErrorCommand } from 'Sieve/Extensions/rfc5463';
import { MailboxExistsTest, MetadataTest, MetadataExistsTest } from 'Sieve/Extensions/rfc5490';
import { IncludeCommand, ReturnCommand } from 'Sieve/Extensions/rfc6609';

const
	AllCommands = {
		// Control commands
		if: IfCommand,
		elsif: ElsIfCommand,
		else: ElseCommand,
		conditional: ConditionalCommand,
		require: RequireCommand,
		stop: StopCommand,
		// Action commands
		discard: DiscardCommand,
		fileinto: FileIntoCommand,
		keep: KeepCommand,
		redirect: RedirectCommand,
		// Test commands
		address: AddressTest,
		allof: AllOfTest,
		anyof: AnyOfTest,
		envelope: EnvelopeTest,
		exists: ExistsTest,
		false: FalseTest,
		header: HeaderTest,
		not: NotTest,
		size: SizeTest,
		true: TrueTest,
		// rfc5173
		body: BodyTest,
		// rfc5183
		environment: EnvironmentTest,
		// rfc5229
		set: SetCommand,
		string: StringTest,
		// rfc5230
		vacation: VacationCommand,
		// rfc5232
		setflag: SetFlagCommand,
		addflag: AddFlagCommand,
		removeflag: RemoveFlagCommand,
		hasflag: HasFlagTest,
		// rfc5235
		spamtest: SpamTestTest,
		virustest: VirusTestTest,
		// rfc5260
		date: DateTest,
		currentdate: CurrentDateTest,
		// rfc5293
		AddHeaderCommand,
		DeleteHeaderCommand,
		// rfc5429
		ereject: ErejectCommand,
		reject: RejectCommand,
		// rfc5435
		notify: NotifyCommand,
		valid_notify_method: ValidNotifyMethodTest,
		notify_method_capability: NotifyMethodCapabilityTest,
		// rfc5463
		ihave: IHaveTest,
		error: ErrorCommand,
		// rfc5490
		mailboxexists: MailboxExistsTest,
		metadata: MetadataTest,
		metadataexists: MetadataExistsTest,
		// rfc6609
		include: IncludeCommand,
		return: ReturnCommand
	},

	T_UNKNOWN           = 0,
	T_STRING_LIST       = 1,
	T_QUOTED_STRING     = 2,
	T_MULTILINE_STRING  = 3,
	T_HASH_COMMENT      = 4,
	T_BRACKET_COMMENT   = 5,
	T_BLOCK_START       = 6,
	T_BLOCK_END         = 7,
	T_LEFT_PARENTHESIS  = 8,
	T_RIGHT_PARENTHESIS = 9,
	T_COMMA             = 10,
	T_SEMICOLON         = 11,
	T_TAG               = 12,
	T_IDENTIFIER        = 13,
	T_NUMBER            = 14,
	T_WHITESPACE        = 15,

	TokensRegEx = '(' + [
		/* T_STRING_LIST       */ STRING_LIST,
		/* T_QUOTED_STRING     */ QUOTED_STRING,
		/* T_MULTILINE_STRING  */ MULTI_LINE,
		/* T_HASH_COMMENT      */ HASH_COMMENT,
		/* T_BRACKET_COMMENT   */ BRACKET_COMMENT,
		/* T_BLOCK_START       */ '\\{',
		/* T_BLOCK_END         */ '\\}',
		/* T_LEFT_PARENTHESIS  */ '\\(', // anyof / allof
		/* T_RIGHT_PARENTHESIS */ '\\)', // anyof / allof
		/* T_COMMA             */ ',',
		/* T_SEMICOLON         */ ';',
		/* T_TAG               */ TAG,
		/* T_IDENTIFIER        */ IDENTIFIER,
		/* T_NUMBER            */ NUMBER,
		/* T_WHITESPACE        */ '(?: |\\r\\n|\\t)+',
		/* T_UNKNOWN           */ '[^ \\r\\n\\t]+'
	].join(')|(') + ')';

export const parseScript = (script, name = 'script.sieve') => {
	script = script.replace(/\r?\n/g, '\r\n');

	// Only activate available commands
	const Commands = {};
	forEachObjectEntry(AllCommands, (key, cmd) => {
		const requires = (new cmd).require;
		if (!requires
		 || (Array.isArray(requires) ? requires : [requires]).every(string => capa.includes(string))
		) {
			Commands[key] = cmd;
		}
	});

	let match,
		line = 1,
		tree = [],

		// Create one regex to find the tokens
		// Use exec() to forward since lastIndex
		regex = RegExp(TokensRegEx, 'gm'),

		levels = [],
		command = null,
		requires = [],
		args = [];

	const
		error = message => {
//			throw new SyntaxError(message + ' at ' + regex.lastIndex + ' line ' + line, name, line)
			throw new SyntaxError(message + ' on line ' + line
				+ ' around:\n\n' + script.substr(regex.lastIndex - 20, 30), name, line)
		},
		pushArg = arg => {
			command || error('Argument not part of command');
			let prev_arg = args[args.length-1];
			if (':is' === arg || ':contains' === arg || ':matches' === arg) {
				command.match_type = arg;
			} else if (':value' === prev_arg || ':count' === prev_arg) {
				// Sieve relational [RFC5231] match types
				/^(gt|ge|lt|le|eq|ne)$/.test(arg.value) || error('Invalid relational match-type ' + arg);
				command.match_type = prev_arg + ' ' + arg;
				--args.length;
//				requires.push('relational');
			} else if (':comparator' === prev_arg) {
				command.comparator = arg;
				--args.length;
			} else {
				args.push(arg);
			}
		},
		pushArgs = () => {
			if (args.length) {
				command && command.pushArguments(args);
				args = [];
			}
		};

	levels.last = () => levels[levels.length - 1];

	while ((match = regex.exec(script))) {
		// the last element in match will contain the matched value and the key will be the type
		let type = match.findIndex((v,i) => 0 < i && undefined !== v),
			value = match[type];

		// create the part
		switch (type)
		{
		case T_IDENTIFIER: {
			pushArgs();
			value = value.toLowerCase();
			let new_command;
			if ('if' === value) {
				new_command = new ConditionalCommand(value);
			} else if ('elsif' === value || 'else' === value) {
//				(prev_command instanceof ConditionalCommand) || error('Not after IF condition');
				new_command = new ConditionalCommand(value);
			} else if (Commands[value]) {
				if ('allof' === value || 'anyof' === value) {
//					(command instanceof ConditionalCommand || command instanceof NotTest) || error('Test-list not in conditional');
				}
				new_command = new Commands[value]();
			} else {
				console.error('Unknown command: ' + value);
				if (command && (
				    command instanceof ConditionalCommand
				 || command instanceof NotTest
				 || command.tests instanceof GrammarTestList)) {
					new_command = new GrammarTest(value);
				} else {
					new_command = new GrammarCommand(value);
				}
			}

			if (new_command instanceof GrammarTest) {
				if (command instanceof ConditionalCommand || command instanceof NotTest) {
					// if/elsif/else new_command
					// not new_command
					command.test = new_command;
				} else if (command.tests instanceof GrammarTestList) {
					// allof/anyof .tests[] new_command
					command.tests.push(new_command);
				} else {
					error('Test "' + value + '" not allowed in "' + command.identifier + '" command');
				}
			} else if (command) {
				if (command.commands) {
					command.commands.push(new_command);
				} else {
					error('commands not allowed in "' + command.identifier + '" command');
				}
			} else {
				tree.push(new_command);
			}
			levels.push(new_command);
			command = new_command;
			if (command.require) {
				(Array.isArray(command.require) ? command.require : [command.require])
					.forEach(string => requires.push(string));
			}
			if (command.comparator) {
				requires.push('comparator-' + command.comparator);
			}
			break; }

		// Arguments
		case T_TAG:
			pushArg(value.toLowerCase());
			break;
		case T_STRING_LIST:
			pushArg(GrammarStringList.fromString(value));
			break;
		case T_MULTILINE_STRING:
			pushArg(GrammarMultiLine.fromString(value));
			break;
		case T_QUOTED_STRING:
			pushArg(new GrammarQuotedString(value.substr(1,value.length-2)));
			break;
		case T_NUMBER:
			pushArg(new GrammarNumber(value));
			break;

		// Comments
		case T_BRACKET_COMMENT:
		case T_HASH_COMMENT: {
			let obj = (T_HASH_COMMENT == type)
				? new GrammarHashComment(value.substr(1).trim())
				: new GrammarBracketComment(value.substr(2, value.length-4));
			if (command) {
				if (!command.comments) {
					command.comments = [];
				}
				(command.commands || command.comments).push(obj);
			} else {
				tree.push(obj);
			}
			break; }

		case T_WHITESPACE:
//			(command ? command.commands : tree).push(value.trim());
			command || tree.push(value.trim());
			break;

		// Command end
		case T_SEMICOLON:
			command || error('Semicolon not at end of command');
			pushArgs();
			if (command instanceof RequireCommand) {
				command.capabilities.forEach(string => requires.push(string.value));
			}
			levels.pop();
			command = levels.last();
			break;

		// Command block
		case T_BLOCK_START:
			pushArgs();
			// https://tools.ietf.org/html/rfc5228#section-2.9
			// Action commands do not take tests or blocks
			while (command && !(command instanceof ConditionalCommand)) {
				levels.pop();
				command = levels.last();
			}
			command || error('Block start not part of control command');
			break;
		case T_BLOCK_END:
			(command instanceof ConditionalCommand) || error('Block end has no matching block start');
			levels.pop();
//			prev_command = command;
			command = levels.last();
			break;

		// anyof / allof ( ... , ... )
		case T_LEFT_PARENTHESIS:
			pushArgs();
			while (command && !(command.tests instanceof GrammarTestList)) {
				levels.pop();
				command = levels.last();
			}
			command || error('Test start not part of anyof/allof test');
			break;
		case T_RIGHT_PARENTHESIS:
			pushArgs();
			levels.pop();
			command = levels.last();
			(command.tests instanceof GrammarTestList) || error('Test end not part of test-list');
			break;
		case T_COMMA:
			pushArgs();
			// Must be inside PARENTHESIS aka test-list
			while (command && !(command.tests instanceof GrammarTestList)) {
				levels.pop();
				command = levels.last();
			}
			command || error('Comma not part of test-list');
			break;

		case T_UNKNOWN:
			error('Invalid token ' + value);
		}

		// Set current script position
		line += (value.split('\n').length - 1); // (value.match(/\n/g) || []).length;
	}

	tree.requires = requires;
	return tree;
};
