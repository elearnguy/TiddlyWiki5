/*\
title: $:/plugins/tiddlywiki/railroad/parser.js
type: application/javascript
module-type: library

Parser for the source of a railroad diagram.

[:x]			optional, normally included
[x]				optional, normally omitted
{x}				one or more
{x +","}		one or more, comma-separated
[{:x}]			zero or more, normally included
[{:x +","}]		zero or more, comma-separated, normally included
[{x}]			zero or more, normally omitted
[{x +","}]		zero or more, comma-separated, normally omitted
x y z			sequence
<-x y z->		explicit sequence
(x|y|z)			alternatives
(x|:y|z)		alternatives, normally y
"x"				terminal
<"x">			nonterminal
/"blah"/		comment
-				dummy

"x" can also be written 'x' or """x"""

Future extensions:
[[x|tiddler]]	link
{{tiddler}}		transclusion

\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

var components = require("$:/plugins/tiddlywiki/railroad/components.js").components;

var Parser = function(source) {
	this.source = source;
	this.tokens = this.tokenise(source);
	this.tokenPos = 0;
	this.advance();
	this.root = new components.Root(this.parseContent());
	this.checkFinished();
};

/////////////////////////// Parser dispatch

Parser.prototype.parseContent = function() {
	var content = [];
	// Parse zero or more components
	while(true) {
		var component = this.parseComponent();
		if(!component) {
			break;
		}
		content.push(component);
	}
	return content;
};

Parser.prototype.parseComponent = function() {
	var component = null;
	if(this.token) {
		if(this.at("string")) {
			component = this.parseTerminal();
		} else if(this.at("identifier")) {
			component = this.parseIdentifier();
		} else {
			switch(this.token.value) {
				case "[":
					component = this.parseOptional();
					break;
				case "{":
					component = this.parseRepeated();
					break;
				case "<":
					component = this.parseNonterminal();
					break;
				case "(":
					component = this.parseChoice();
					break;
				case "/":
					component = this.parseComment();
					break;
				case "<-":
					component = this.parseSequence();
					break;
				case "-":
					component = this.parseDummy();
					break;
			}
		}
	}
	return component;
};

/////////////////////////// Specific components

Parser.prototype.parseChoice = function() {
	// Consume the (
	this.advance();
	var content = [],
		colon = -1;
	do {
		// Allow at most one branch to be prefixed with a colon
		if(colon === -1 && this.eat(":")) {
			colon = content.length;
		}
		// Parse the next branch
		content.push(this.parseContent());
	} while(this.eat("|"));
	// Create a component
	var component = new components.Choice(content,colon === -1 ? 0 : colon);
	// Consume the closing bracket
	this.close(")");
	return component;
};

Parser.prototype.parseComment = function() {
	// Consume the /
	this.advance();
	// The comment's content should be in a string literal
	this.expectStringLiteral("/");
	// Create a component
	var component = new components.Comment(this.token.value);
	// Consume the string literal
	this.advance();
	// Consume the closing /
	this.close("/");
	return component;
};

Parser.prototype.parseDummy = function() {
	// Consume the -
	this.advance();
	// Create a component
	return new components.Dummy();
};

Parser.prototype.parseIdentifier = function() {
	// Create a component
	var component = new components.Nonterminal(this.token.value);
	// Consume the identifier
	this.advance();
	return component;
};


Parser.prototype.parseNonterminal = function() {
	// Consume the <
	this.advance();
	// The nonterminal's name should be in a string literal
	this.expectStringLiteral("<");
	// Create a component
	var component = new components.Nonterminal(this.token.value);
	// Consume the string literal
	this.advance();
	// Consume the closing bracket
	this.close(">");
	return component;
};

Parser.prototype.parseOptional = function() {
	// Consume the [
	this.advance();
	// Consume the { if there is one
	var repeated = this.eat("{");
	// Note whether omission is the normal route
	var normal = this.eat(":");
	// Parse the content
	var content = this.parseContent(),
		separator = null;
	// Parse the separator if there is one
	if(repeated && this.eat("+")) {
		separator = this.parseContent();
	}
	// Create a component
	var component = repeated ? new components.OptionalRepeated(content,separator,normal) : new components.Optional(content,normal);
	// Consume the closing brackets
	if(repeated) {
		this.close("}");
	}
	this.close("]");
	return component;
};

Parser.prototype.parseRepeated = function() {
	// Consume the {
	this.advance();
	// Parse the content
	var content = this.parseContent(),
		separator = null;
	// Parse the separator if there is one
	if(this.eat("+")) {
		separator = this.parseContent();
	}
	// Create a component
	var component = new components.Repeated(content,separator);
	// Consume the closing bracket
	this.close("}");
	return component;
};

Parser.prototype.parseSequence = function() {
	// Consume the ~
	this.advance();
	// Parse the content
	var content = this.parseContent();
	// Create a component
	var component = new components.Sequence(content);
	// Consume the closing ~
	this.close("->");
	return component;
};

Parser.prototype.parseTerminal = function() {
	var component = new components.Terminal(this.token.value);
	// Consume the string literal
	this.advance();
    return component;
};

/////////////////////////// Token manipulation

Parser.prototype.advance = function() {
	if(this.tokenPos >= this.tokens.length) {
		this.token = null;
	}
	this.token = this.tokens[this.tokenPos++];
};

Parser.prototype.at = function(token) {
	return this.token && (this.token.type === token || this.token.type === "token" && this.token.value === token);
};

Parser.prototype.eat = function(token) {
	var at = this.at(token);
	if(at) {
		this.advance();
	}
	return at;
};

Parser.prototype.expectStringLiteral = function(preamble) {
	if(!this.at("string")) {
		throw "String expected after " + preamble;
	}
};

Parser.prototype.close = function(token) {
	if(!this.eat(token)) {
		throw "Closing " + token + " expected";
	}
};

Parser.prototype.checkFinished = function() {
	if(this.token) {
		throw "Syntax error at " + this.token.value;
	}
};

/////////////////////////// Tokenisation

Parser.prototype.tokenise = function(source) {
	var tokens = [],
		pos = 0,
		c, s, token;
	while(pos < source.length) {
		// Initialise this iteration
		s = token = null;
		// Skip whitespace
		pos = $tw.utils.skipWhiteSpace(source,pos);
		// Avoid falling off the end of the string
		if (pos >= source.length) {
			break;
		}
		// Examine the next character
		c = source.charAt(pos);
		if("\"'".indexOf(c) !== -1) {
			// String literal
			token = $tw.utils.parseStringLiteral(source,pos);
			if(!token) {
				throw "Unterminated string literal";
			}
		} else if("[]{}".indexOf(c) !== -1) {
			// Single or double character
			s = source.charAt(pos+1) === c ? c + c : c;
		} else if(c === "<") {
			// < or <-
			s = source.charAt(pos+1) === "-" ? "<-" : "<";
		} else if(c === "-") {
			// - or ->
			s = source.charAt(pos+1) === ">" ? "->" : "-";
		} else if("()>+|/:".indexOf(c) !== -1) {
			// Single character
			s = c;
		} else if(c.match(/[a-zA-Z]/)) {
			// Identifier
			token = this.readIdentifier(source,pos);
		} else {
			throw "Syntax error at " + c;
		}
		// Add our findings to the return array
		if(token) {
			tokens.push(token);
		} else {
			token = $tw.utils.parseTokenString(source,pos,s);
			tokens.push(token);
		}
		// Prepare for the next character
		pos = token.end;
	}
	return tokens;
};

Parser.prototype.readIdentifier = function(source,pos) {
	var re = /([a-zA-Z0-9_.-]+)/g;
	re.lastIndex = pos;
	var match = re.exec(source);
	if(match && match.index === pos) {
		return {type: "identifier", value: match[1], start: pos, end: pos + match[1].length};
	} else {
		throw "Invalid identifier";
	}
};

/////////////////////////// Exports

exports.parser = Parser;

})();