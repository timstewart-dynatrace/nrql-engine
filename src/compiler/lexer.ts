/**
 * NRQL-to-DQL Compiler — Lexer (tokenizer).
 */

import { KEYWORDS, NON_KEYWORD_IDENTS, type Token, TokenType } from './tokens.js';

export class LexError extends Error {
  readonly pos: number;

  constructor(msg: string, pos = -1) {
    super(msg);
    this.name = 'LexError';
    this.pos = pos;
  }
}

const OP_MAP: ReadonlyMap<string, TokenType> = new Map([
  ['=', TokenType.EQ],
  ['<', TokenType.LT],
  ['>', TokenType.GT],
  ['+', TokenType.PLUS],
  ['-', TokenType.MINUS],
  ['*', TokenType.STAR],
  ['/', TokenType.SLASH],
  ['%', TokenType.PERCENT],
  ['(', TokenType.LPAREN],
  [')', TokenType.RPAREN],
  [',', TokenType.COMMA],
]);

const NUMBER_RE = /(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/;
const IDENT_RE = /[a-zA-Z_][a-zA-Z0-9_.:]*/ ;
const TEMPLATE_VAR_RE = /[a-zA-Z_][a-zA-Z0-9_]*/;

export class NRQLLexer {
  private readonly src: string;
  private pos: number;

  constructor(source: string) {
    this.src = source;
    this.pos = 0;
  }

  tokenize(): Token[] {
    const tokens: Token[] = [];

    while (this.pos < this.src.length) {
      const c = this.src[this.pos]!;

      // Skip whitespace
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
        this.pos++;
        continue;
      }

      // SQL line comments (-- to end of line)
      if (c === '-' && this.pos + 1 < this.src.length && this.src[this.pos + 1] === '-') {
        while (this.pos < this.src.length && this.src[this.pos] !== '\n') {
          this.pos++;
        }
        continue;
      }

      // Skip semicolons
      if (c === ';') {
        this.pos++;
        continue;
      }

      // Single-quoted string literal
      if (c === "'") {
        tokens.push(this.parseString());
        continue;
      }

      // Number (including leading decimal like .30)
      if (
        c >= '0' && c <= '9' ||
        (c === '.' && this.pos + 1 < this.src.length && this.src[this.pos + 1]! >= '0' && this.src[this.pos + 1]! <= '9')
      ) {
        tokens.push(this.parseNumber());
        continue;
      }

      // Two-char operators
      if (this.pos + 1 < this.src.length) {
        const two = this.src[this.pos] + this.src[this.pos + 1]!;
        if (two === '!=') {
          tokens.push({ type: TokenType.NEQ, value: '!=', pos: this.pos });
          this.pos += 2;
          continue;
        }
        if (two === '<=') {
          tokens.push({ type: TokenType.LTE, value: '<=', pos: this.pos });
          this.pos += 2;
          continue;
        }
        if (two === '>=') {
          tokens.push({ type: TokenType.GTE, value: '>=', pos: this.pos });
          this.pos += 2;
          continue;
        }
      }

      // Single-char operators & punctuation
      const opType = OP_MAP.get(c);
      if (opType !== undefined) {
        tokens.push({ type: opType, value: c, pos: this.pos });
        this.pos++;
        continue;
      }

      // Backtick-quoted identifier
      if (c === '`') {
        tokens.push(this.parseBacktickIdent());
        continue;
      }

      // Identifier or keyword
      if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_') {
        tokens.push(this.parseIdentifier());
        continue;
      }

      // Double-quoted string literal
      if (c === '"') {
        tokens.push(this.parseDquoteString());
        continue;
      }

      // Skip colons
      if (c === ':') {
        this.pos++;
        continue;
      }

      // Template variables: {{varName}}
      if (c === '{' && this.pos + 1 < this.src.length && this.src[this.pos + 1] === '{') {
        const tplStart = this.pos;
        this.pos += 2; // skip {{
        const m = TEMPLATE_VAR_RE.exec(this.src.slice(this.pos));
        const varName = m ? m[0] : 'template_var';
        if (m) {
          this.pos += m[0].length;
        }
        // Skip closing }}
        while (this.pos < this.src.length && this.src[this.pos] === '}') {
          this.pos++;
        }
        tokens.push({ type: TokenType.STRING, value: varName, pos: tplStart });
        continue;
      }

      // Brackets: skip entire bracket expression
      if (c === '[') {
        this.pos++; // skip [
        let depth = 1;
        while (this.pos < this.src.length && depth > 0) {
          if (this.src[this.pos] === '[') depth++;
          else if (this.src[this.pos] === ']') depth--;
          this.pos++;
        }
        continue;
      }

      if (c === '{' || c === '}') {
        this.pos++;
        continue;
      }

      throw new LexError(`Unexpected character '${c}' at position ${this.pos}`, this.pos);
    }

    tokens.push({ type: TokenType.EOF, value: null, pos: this.pos });
    return tokens;
  }

  private parseString(): Token {
    const start = this.pos;
    this.pos++; // skip '
    const buf: string[] = [];

    while (this.pos < this.src.length) {
      const c = this.src[this.pos]!;
      if (c === "'") {
        // Escaped '' ?
        if (this.pos + 1 < this.src.length && this.src[this.pos + 1] === "'") {
          buf.push("'");
          this.pos += 2;
        } else {
          this.pos++;
          return { type: TokenType.STRING, value: buf.join(''), pos: start };
        }
      } else if (c === '\\' && this.pos + 1 < this.src.length) {
        const nextC = this.src[this.pos + 1]!;
        if (nextC === "'" || nextC === '\\') {
          buf.push(nextC);
        } else {
          buf.push('\\');
          buf.push(nextC);
        }
        this.pos += 2;
      } else {
        buf.push(c);
        this.pos++;
      }
    }

    throw new LexError(`Unterminated string at position ${start}`, start);
  }

  private parseDquoteString(): Token {
    const start = this.pos;
    this.pos++; // skip "
    const buf: string[] = [];

    while (this.pos < this.src.length) {
      const c = this.src[this.pos]!;
      if (c === '"') {
        this.pos++;
        return { type: TokenType.STRING, value: buf.join(''), pos: start };
      } else if (c === '\\' && this.pos + 1 < this.src.length) {
        const nextC = this.src[this.pos + 1]!;
        if (nextC === '"' || nextC === '\\') {
          buf.push(nextC);
        } else {
          buf.push('\\');
          buf.push(nextC);
        }
        this.pos += 2;
      } else {
        buf.push(c);
        this.pos++;
      }
    }

    throw new LexError(`Unterminated double-quoted string at position ${start}`, start);
  }

  private parseNumber(): Token {
    const start = this.pos;
    const m = NUMBER_RE.exec(this.src.slice(this.pos));
    if (!m) {
      throw new LexError(`Invalid number at position ${start}`, start);
    }
    const s = m[0];
    this.pos += s.length;
    const val = s.includes('.') || s.toLowerCase().includes('e')
      ? parseFloat(s)
      : parseInt(s, 10);
    return { type: TokenType.NUMBER, value: val, pos: start };
  }

  private parseIdentifier(): Token {
    const start = this.pos;
    const m = IDENT_RE.exec(this.src.slice(this.pos));
    if (!m) {
      throw new LexError(`Invalid identifier at position ${start}`, start);
    }
    let raw = m[0];
    // Trim trailing dots/colons
    raw = raw.replace(/[.:]+$/, '');
    this.pos += raw.length;
    const low = raw.toLowerCase();

    // 'max' as keyword only in certain contexts (LIMIT MAX, SINCE MAX)
    if (low === 'max') {
      return { type: TokenType.MAX_KW, value: raw, pos: start };
    }
    const kwType = KEYWORDS.get(low);
    if (kwType !== undefined && !NON_KEYWORD_IDENTS.has(low)) {
      return { type: kwType, value: raw, pos: start };
    }
    return { type: TokenType.IDENTIFIER, value: raw, pos: start };
  }

  private parseBacktickIdent(): Token {
    const start = this.pos;
    this.pos++; // skip `
    const buf: string[] = [];
    while (this.pos < this.src.length && this.src[this.pos] !== '`') {
      buf.push(this.src[this.pos]!);
      this.pos++;
    }
    if (this.pos >= this.src.length) {
      throw new LexError(`Unterminated backtick identifier at position ${start}`, start);
    }
    this.pos++; // skip `
    return { type: TokenType.IDENTIFIER, value: buf.join(''), pos: start };
  }
}
