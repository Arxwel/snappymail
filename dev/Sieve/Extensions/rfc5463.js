/**
 * https://tools.ietf.org/html/rfc5463
 */

import {
	GrammarCommand,
	GrammarTest,
	GrammarQuotedString,
	GrammarStringList
} from 'Sieve/Grammar';

/**
 * https://datatracker.ietf.org/doc/html/rfc5463#section-4
 */
export class IHaveTest extends GrammarTest
{
	constructor()
	{
		super();
		this.capabilities = new GrammarStringList;
	}

	get require() { return 'ihave'; }

	toString()
	{
		return 'ihave ' + this.capabilities;
	}

	pushArguments(args)
	{
		this.capabilities = args.pop();
	}
}

/**
 * https://datatracker.ietf.org/doc/html/rfc5463#section-5
 */
export class ErrorCommand extends GrammarCommand
{
	constructor()
	{
		super();
		this.message = new GrammarQuotedString;
	}

	get require() { return 'ihave'; }

	toString()
	{
		return 'error ' + this.message + ';';
	}

	pushArguments(args)
	{
		this.message = args.pop();
	}
}
