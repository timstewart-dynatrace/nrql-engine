/**
 * NRQL-to-DQL Compiler — Recursive-descent parser.
 *
 * Ported from Python: /Users/Shared/GitHub/Dynatrace-NewRelic/compiler/parser.py
 */

import type {
  ASTNode,
  Condition,
  FacetItem,
  JoinClause,
  LimitClause,
  OrderByClause,
  Query,
  SelectItem,
  TimeseriesClause,
} from './ast-nodes.js';
import type { Token } from './tokens.js';
import { TokenType } from './tokens.js';

export const TIME_UNITS: ReadonlySet<string> = new Set([
  'second', 'seconds', 'sec', 's',
  'minute', 'minutes', 'min',
  'hour', 'hours', 'hr', 'h',
  'day', 'days', 'd',
  'week', 'weeks', 'w',
  'month', 'months',
]);

/** Functions that accept a WHERE clause as their last argument. */
export const WHERE_FUNCTIONS: ReadonlySet<string> = new Set([
  'percentage', 'filter', 'apdex', 'funnel',
]);

/** Known aggregation functions (used to detect aggregation context). */
export const AGG_FUNCTIONS: ReadonlySet<string> = new Set([
  'count', 'sum', 'average', 'avg', 'max', 'min', 'percentile',
  'uniquecount', 'uniques', 'latest', 'earliest', 'last', 'first',
  'median', 'stddev', 'rate', 'filter', 'percentage', 'apdex',
  'funnel', 'histogram', 'cdfpercentage', 'countdistinct',
  'bucketpercentile', 'derivative', 'cardinality',
  'aggregationendtime', 'predictlinear',
]);

export class ParseError extends Error {
  readonly pos: number;

  constructor(msg: string, pos: number = -1) {
    super(msg);
    this.name = 'ParseError';
    this.pos = pos;
  }
}

export class NRQLParser {
  private readonly tokens: readonly Token[];
  private pos: number;

  constructor(tokens: readonly Token[]) {
    this.tokens = tokens;
    this.pos = 0;
  }

  // -- Helpers --

  private cur(): Token {
    // tokens always has at least one element (EOF), so index is always valid
    return this.tokens[Math.min(this.pos, this.tokens.length - 1)]!;
  }

  private peek(offset: number = 0): Token {
    const idx = this.pos + offset;
    // tokens always has at least one element (EOF), so index is always valid
    return this.tokens[Math.min(idx, this.tokens.length - 1)]!;
  }

  private atEnd(): boolean {
    return this.cur().type === TokenType.EOF;
  }

  private check(...types: TokenType[]): boolean {
    return types.includes(this.cur().type);
  }

  private match(...types: TokenType[]): Token | undefined {
    if (types.includes(this.cur().type)) {
      const t = this.cur();
      this.pos += 1;
      return t;
    }
    return undefined;
  }

  private expect(tt: TokenType): Token {
    const t = this.cur();
    if (t.type !== tt) {
      throw new ParseError(
        `Expected ${tt}, got ${t.type} ('${String(t.value)}') at pos ${t.pos}`,
        t.pos,
      );
    }
    this.pos += 1;
    return t;
  }

  private checkIdent(...names: string[]): boolean {
    const t = this.cur();
    const lower = new Set(names.map(n => n.toLowerCase()));
    if (t.type === TokenType.IDENTIFIER) {
      return lower.has(String(t.value).toLowerCase());
    }
    if (t.type === TokenType.MAX_KW) {
      return lower.has('max');
    }
    return false;
  }

  // -- Top-level query --

  parse(): Query {
    // Handle SHOW EVENT TYPES
    if (this.checkIdent('show')) {
      return this.parseShowEventTypes();
    }
    // Handle WITH...AS CTEs by inlining
    if (this.check(TokenType.WITH)) {
      return this.parseWithCte();
    }
    // Handle FROM-first syntax: FROM EventType SELECT ...
    if (this.check(TokenType.FROM)) {
      return this.parseFromFirst();
    }
    const q = this.parseQuery();
    if (!this.atEnd()) {
      throw new ParseError(
        `Unexpected token: ${String(this.cur().value)}`,
        this.cur().pos,
      );
    }
    return q;
  }

  private parseShowEventTypes(): Query {
    this.pos += 1; // skip 'show'
    if (this.checkIdent('event')) {
      this.pos += 1;
    }
    if (this.checkIdent('types')) {
      this.pos += 1;
    }
    let sinceRaw: string | undefined;
    if (this.check(TokenType.SINCE)) {
      this.pos += 1;
      sinceRaw = this.consumeTimeExpr();
    }
    return {
      selectItems: [{
        expression: { type: 'function', name: 'SHOW_EVENT_TYPES', args: [] },
      }],
      fromClause: '__SHOW_EVENT_TYPES__',
      sinceRaw,
      extrapolate: false,
      predict: false,
    };
  }

  private peekWithTimezone(): boolean {
    if (!this.check(TokenType.WITH)) {
      return false;
    }
    const nxt = this.peek(1);
    return nxt.type === TokenType.IDENTIFIER && String(nxt.value).toLowerCase() === 'timezone';
  }

  private tryParseJoin(): JoinClause | undefined {
    let joinType: 'INNER' | 'LEFT' = 'INNER';
    const savedPos = this.pos;

    if (this.checkIdent('inner')) {
      joinType = 'INNER';
      this.pos += 1;
    } else if (this.checkIdent('left')) {
      joinType = 'LEFT';
      this.pos += 1;
    }

    if (!this.checkIdent('join')) {
      // Back up if we consumed inner/left but no join follows
      this.pos = savedPos;
      return undefined;
    }

    this.pos += 1; // consume 'join'
    this.expect(TokenType.LPAREN);
    // Parse the subquery (can be FROM-first or SELECT-first)
    let sub: Query;
    if (this.check(TokenType.FROM)) {
      sub = this.parseFromFirst();
    } else {
      sub = this.parseQuery();
    }
    this.expect(TokenType.RPAREN);

    // Parse ON clause
    let onLeft: string | undefined;
    let onRight: string | undefined;

    if (this.checkIdent('on')) {
      this.pos += 1;
      const key1Tok = this.cur();
      if (key1Tok.type === TokenType.IDENTIFIER || key1Tok.type === TokenType.MAX_KW) {
        const key1 = String(key1Tok.value);
        this.pos += 1;
        if (this.match(TokenType.EQ)) {
          const key2Tok = this.cur();
          if (key2Tok.type === TokenType.IDENTIFIER || key2Tok.type === TokenType.MAX_KW) {
            const key2 = String(key2Tok.value);
            this.pos += 1;
            onLeft = key1;
            onRight = key2;
          } else {
            onLeft = key1;
            onRight = key1;
          }
        } else {
          // ON key (same on both sides)
          onLeft = key1;
          onRight = key1;
        }
      }
    }

    return { joinType, subquery: sub, onLeft, onRight };
  }

  private parseFromFirst(): Query {
    this.expect(TokenType.FROM);
    const fromTok = this.cur();
    if (fromTok.type !== TokenType.IDENTIFIER && fromTok.type !== TokenType.MAX_KW) {
      throw new ParseError(
        `Expected event type after FROM, got ${String(fromTok.value)}`,
        fromTok.pos,
      );
    }
    const fromType = String(fromTok.value);
    this.pos += 1;

    // Handle JOIN
    const joinClause = this.tryParseJoin();

    // Handle inline WITH (computed columns), but NOT WITH TIMEZONE
    if (this.check(TokenType.WITH) && !this.peekWithTimezone()) {
      this.pos += 1; // skip WITH
      let depth = 0;
      while (!this.atEnd()) {
        if (this.check(TokenType.LPAREN)) {
          depth += 1;
        } else if (this.check(TokenType.RPAREN)) {
          depth -= 1;
        } else if (this.check(TokenType.SELECT) && depth === 0) {
          break;
        }
        this.pos += 1;
      }
    }

    this.expect(TokenType.SELECT);
    const selectItems = this.parseSelectList();

    let where: Condition | undefined;
    let facetItems: FacetItem[] | undefined;
    let timeseries: TimeseriesClause | undefined;
    let sinceRaw: string | undefined;
    let untilRaw: string | undefined;
    let limit: LimitClause | undefined;
    let orderBy: OrderByClause | undefined;
    let compareWithRaw: string | undefined;
    let extrapolate = false;
    let facetOrderBy: ASTNode | undefined;
    let withTimezone: string | undefined;
    let predict = false;

    while (!this.atEnd()) {
      if (this.check(TokenType.WHERE)) {
        this.pos += 1;
        where = this.parseCondition();
      } else if (this.check(TokenType.FACET)) {
        this.pos += 1;
        facetItems = this.parseFacetList();
        const [fob, fobOrder] = this.tryParseFacetOrderBy();
        if (fob) {
          facetOrderBy = fob;
          orderBy = fobOrder;
        }
      } else if (this.check(TokenType.TIMESERIES)) {
        this.pos += 1;
        timeseries = this.parseTimeseriesClause();
      } else if (this.checkIdent('predict')) {
        this.pos += 1;
        predict = true;
      } else if (this.check(TokenType.SINCE)) {
        this.pos += 1;
        sinceRaw = this.consumeTimeExpr();
      } else if (this.check(TokenType.UNTIL)) {
        this.pos += 1;
        untilRaw = this.consumeTimeExpr();
      } else if (this.check(TokenType.LIMIT)) {
        this.pos += 1;
        if (this.check(TokenType.MAX_KW)) {
          this.pos += 1;
          limit = { value: 'MAX' };
        } else {
          limit = { value: Number(this.expect(TokenType.NUMBER).value) };
        }
      } else if (this.check(TokenType.ORDER)) {
        this.pos += 1;
        this.expect(TokenType.BY);
        const expr = this.parseExpression();
        let direction: 'ASC' | 'DESC' = 'ASC';
        if (this.match(TokenType.ASC)) {
          direction = 'ASC';
        } else if (this.match(TokenType.DESC)) {
          direction = 'DESC';
        }
        orderBy = { expression: expr, direction };
      } else if (this.check(TokenType.COMPARE)) {
        this.pos += 1;
        this.expect(TokenType.WITH);
        compareWithRaw = this.consumeTimeExpr();
      } else if (this.check(TokenType.EXTRAPOLATE)) {
        this.pos += 1;
        extrapolate = true;
      } else if (this.check(TokenType.WITH) && this.peekWithTimezone()) {
        this.pos += 1; // skip WITH
        this.pos += 1; // skip 'timezone' identifier
        withTimezone = String(this.expect(TokenType.STRING).value);
      } else {
        break;
      }
    }

    return {
      selectItems,
      fromClause: fromType,
      where,
      facetItems,
      timeseries,
      sinceRaw,
      untilRaw,
      limit,
      orderBy,
      compareWithRaw,
      extrapolate,
      joinClause,
      facetOrderBy,
      withTimezone,
      predict,
    };
  }

  private parseWithCte(): Query {
    this.expect(TokenType.WITH);
    const cteNameTok = this.cur();
    if (cteNameTok.type !== TokenType.IDENTIFIER && cteNameTok.type !== TokenType.MAX_KW) {
      throw new ParseError(
        `Expected CTE name, got ${String(cteNameTok.value)}`,
        cteNameTok.pos,
      );
    }
    const cteName = String(cteNameTok.value);
    this.pos += 1;
    this.expect(TokenType.AS);
    this.expect(TokenType.LPAREN);
    const inner = this.parseQuery();
    this.expect(TokenType.RPAREN);
    const outer = this.parseQuery();

    // If outer's FROM matches CTE name, replace with inner's FROM and merge WHERE
    if (outer.fromClause.toLowerCase() === cteName.toLowerCase()) {
      let mergedWhere: Condition | undefined;
      if (inner.where && outer.where) {
        mergedWhere = { type: 'logical', op: 'and', left: inner.where, right: outer.where };
      } else if (inner.where) {
        mergedWhere = inner.where;
      } else {
        mergedWhere = outer.where;
      }
      // Create a new Query with merged fields (readonly interface)
      return {
        ...outer,
        fromClause: inner.fromClause,
        where: mergedWhere,
      };
    }
    return outer;
  }

  private parseQuery(): Query {
    this.expect(TokenType.SELECT);
    const selectItems = this.parseSelectList();
    this.expect(TokenType.FROM);

    const fromTok = this.cur();
    if (fromTok.type !== TokenType.IDENTIFIER && fromTok.type !== TokenType.MAX_KW) {
      throw new ParseError(
        `Expected event type after FROM, got ${String(fromTok.value)}`,
        fromTok.pos,
      );
    }
    const fromType = String(fromTok.value);
    this.pos += 1;

    // Handle JOIN
    const joinClause = this.tryParseJoin();

    // Handle inline WITH (computed columns), but NOT WITH TIMEZONE
    if (this.check(TokenType.WITH) && !this.peekWithTimezone()) {
      this.pos += 1; // skip WITH
      let depth = 0;
      while (!this.atEnd()) {
        if (this.check(TokenType.LPAREN)) {
          depth += 1;
        } else if (this.check(TokenType.RPAREN)) {
          depth -= 1;
          if (depth < 0) {
            depth = 0;
          }
        } else if (
          depth === 0 &&
          this.check(
            TokenType.WHERE, TokenType.FACET, TokenType.TIMESERIES,
            TokenType.SINCE, TokenType.UNTIL, TokenType.LIMIT,
            TokenType.ORDER, TokenType.COMPARE, TokenType.EXTRAPOLATE,
          )
        ) {
          break;
        }
        this.pos += 1;
      }
    }

    let where: Condition | undefined;
    let facetItems: FacetItem[] | undefined;
    let timeseries: TimeseriesClause | undefined;
    let sinceRaw: string | undefined;
    let untilRaw: string | undefined;
    let limit: LimitClause | undefined;
    let orderBy: OrderByClause | undefined;
    let compareWithRaw: string | undefined;
    let extrapolate = false;
    let facetOrderBy: ASTNode | undefined;
    let withTimezone: string | undefined;
    let predict = false;

    while (!this.atEnd()) {
      if (this.check(TokenType.WHERE)) {
        this.pos += 1;
        where = this.parseCondition();
      } else if (this.check(TokenType.FACET)) {
        this.pos += 1;
        facetItems = this.parseFacetList();
        const [fob, fobOrder] = this.tryParseFacetOrderBy();
        if (fob) {
          facetOrderBy = fob;
          orderBy = fobOrder;
        }
      } else if (this.check(TokenType.TIMESERIES)) {
        this.pos += 1;
        timeseries = this.parseTimeseriesClause();
      } else if (this.checkIdent('predict')) {
        this.pos += 1;
        predict = true;
      } else if (this.check(TokenType.SINCE)) {
        this.pos += 1;
        sinceRaw = this.consumeTimeExpr();
      } else if (this.check(TokenType.UNTIL)) {
        this.pos += 1;
        untilRaw = this.consumeTimeExpr();
      } else if (this.check(TokenType.LIMIT)) {
        this.pos += 1;
        if (this.check(TokenType.MAX_KW)) {
          this.pos += 1;
          limit = { value: 'MAX' };
        } else {
          limit = { value: Number(this.expect(TokenType.NUMBER).value) };
        }
      } else if (this.check(TokenType.ORDER)) {
        this.pos += 1;
        this.expect(TokenType.BY);
        const expr = this.parseExpression();
        let direction: 'ASC' | 'DESC' = 'ASC';
        if (this.match(TokenType.ASC)) {
          direction = 'ASC';
        } else if (this.match(TokenType.DESC)) {
          direction = 'DESC';
        }
        orderBy = { expression: expr, direction };
      } else if (this.check(TokenType.COMPARE)) {
        this.pos += 1;
        this.expect(TokenType.WITH);
        compareWithRaw = this.consumeTimeExpr();
      } else if (this.check(TokenType.EXTRAPOLATE)) {
        this.pos += 1;
        extrapolate = true;
      } else if (this.check(TokenType.WITH) && this.peekWithTimezone()) {
        this.pos += 1; // skip WITH
        this.pos += 1; // skip 'timezone' identifier
        withTimezone = String(this.expect(TokenType.STRING).value);
      } else {
        break;
      }
    }

    return {
      selectItems,
      fromClause: fromType,
      where,
      facetItems,
      timeseries,
      sinceRaw,
      untilRaw,
      limit,
      orderBy,
      compareWithRaw,
      extrapolate,
      joinClause,
      facetOrderBy,
      withTimezone,
      predict,
    };
  }

  // -- SELECT list --

  private parseSelectList(): SelectItem[] {
    const items: SelectItem[] = [this.parseSelectItem()];
    while (this.match(TokenType.COMMA)) {
      items.push(this.parseSelectItem());
    }
    return items;
  }

  private parseSelectItem(): SelectItem {
    const expr = this.parseExpression();
    let alias: string | undefined;
    if (this.match(TokenType.AS)) {
      const tok = this.cur();
      if (tok.type === TokenType.IDENTIFIER) {
        alias = String(tok.value);
        this.pos += 1;
      } else if (tok.type === TokenType.STRING) {
        alias = String(tok.value);
        this.pos += 1;
      } else if (tok.type === TokenType.MAX_KW) {
        alias = String(tok.value);
        this.pos += 1;
      } else {
        throw new ParseError(
          `Expected alias name after AS, got ${String(tok.value)}`,
          tok.pos,
        );
      }
    }
    return { expression: expr, alias };
  }

  // -- FACET list --

  private parseFacetList(): FacetItem[] {
    // Handle FACET CASES(...)
    if (this.check(TokenType.CASES)) {
      this.pos += 1;
      this.expect(TokenType.LPAREN);
      const args = this.parseCasesArgs();
      this.expect(TokenType.RPAREN);
      return [{ expression: { type: 'function', name: 'cases', args } }];
    }

    const items: FacetItem[] = [this.parseFacetItem()];
    while (this.match(TokenType.COMMA)) {
      items.push(this.parseFacetItem());
    }
    return items;
  }

  private parseFacetItem(): FacetItem {
    // Handle CASES(...) appearing as a facet item (not just first position)
    if (this.check(TokenType.CASES)) {
      this.pos += 1;
      this.expect(TokenType.LPAREN);
      const args = this.parseCasesArgs();
      this.expect(TokenType.RPAREN);
      return { expression: { type: 'function', name: 'cases', args } };
    }
    const expr = this.parseExpression();
    let alias: string | undefined;
    if (this.match(TokenType.AS)) {
      const tok = this.cur();
      if (
        tok.type === TokenType.IDENTIFIER ||
        tok.type === TokenType.STRING ||
        tok.type === TokenType.MAX_KW
      ) {
        alias = String(tok.value);
        this.pos += 1;
      } else {
        throw new ParseError(
          `Expected alias after AS in FACET, got ${String(tok.value)}`,
          tok.pos,
        );
      }
    }
    return { expression: expr, alias };
  }

  private parseCasesArgs(): ASTNode[] {
    const args: ASTNode[] = [];
    while (!this.check(TokenType.RPAREN) && !this.atEnd()) {
      if (this.match(TokenType.WHERE)) {
        const cond = this.parseCondition();
        args.push(cond);
        // Label can follow with AS or comma
        if (this.match(TokenType.AS)) {
          args.push(this.parseExpression());
        } else if (this.check(TokenType.COMMA)) {
          this.match(TokenType.COMMA);
          if (!this.check(TokenType.WHERE) && !this.check(TokenType.RPAREN)) {
            args.push(this.parseExpression());
            this.match(TokenType.COMMA);
          }
          continue;
        }
      } else {
        // Bare expression (e.g., matchesPhrase(targetUrl, "/search") as 'label')
        args.push(this.parseExpression());
        // Check for AS alias after bare expression
        if (this.match(TokenType.AS)) {
          args.push(this.parseExpression());
        }
      }
      this.match(TokenType.COMMA); // optional trailing comma
    }
    return args;
  }

  private tryParseFacetOrderBy(): [ASTNode | undefined, OrderByClause | undefined] {
    if (!this.check(TokenType.ORDER)) {
      return [undefined, undefined];
    }
    const saved = this.pos;
    this.pos += 1;
    if (!this.check(TokenType.BY)) {
      this.pos = saved;
      return [undefined, undefined];
    }
    this.pos += 1;
    const expr = this.parseExpression();
    let direction: 'ASC' | 'DESC' = 'DESC'; // FACET ORDER BY defaults to DESC
    if (this.match(TokenType.ASC)) {
      direction = 'ASC';
    } else if (this.match(TokenType.DESC)) {
      direction = 'DESC';
    }
    return [expr, { expression: expr, direction }];
  }

  // -- TIMESERIES --

  private parseTimeseriesClause(): TimeseriesClause {
    if (this.check(TokenType.AUTO)) {
      this.pos += 1;
      const slideBy = this.parseSlideBy();
      return { interval: 'AUTO', slideBy };
    }
    if (this.check(TokenType.MAX_KW)) {
      this.pos += 1;
      const slideBy = this.parseSlideBy();
      return { interval: 'MAX', slideBy };
    }
    if (this.check(TokenType.NUMBER)) {
      const val = this.cur().value;
      this.pos += 1;
      const unit = this.consumeTimeUnit();
      if (unit) {
        const slideBy = this.parseSlideBy();
        return { interval: `${String(val)} ${unit}`, slideBy };
      }
      const slideBy = this.parseSlideBy();
      return { interval: String(val), slideBy };
    }
    return {};
  }

  private parseSlideBy(): string | undefined {
    if (!this.checkIdent('slide')) {
      return undefined;
    }
    this.pos += 1; // consume 'slide'
    this.expect(TokenType.BY);
    if (this.check(TokenType.AUTO)) {
      this.pos += 1;
      return 'AUTO';
    }
    if (this.check(TokenType.MAX_KW)) {
      this.pos += 1;
      return 'MAX';
    }
    if (this.check(TokenType.NUMBER)) {
      const val = this.cur().value;
      this.pos += 1;
      const unit = this.consumeTimeUnit();
      if (unit) {
        return `${String(val)} ${unit}`;
      }
      return String(val);
    }
    return undefined;
  }

  private consumeTimeUnit(): string | undefined {
    const t = this.cur();
    if (t.type === TokenType.IDENTIFIER && TIME_UNITS.has(String(t.value).toLowerCase())) {
      this.pos += 1;
      return String(t.value).toLowerCase();
    }
    if (t.type === TokenType.MAX_KW) {
      // 'max' is not a time unit
      return undefined;
    }
    return undefined;
  }

  private consumeTimeExpr(): string {
    const parts: string[] = [];
    if (this.check(TokenType.MAX_KW)) {
      this.pos += 1;
      return 'MAX';
    }
    // Consume tokens until we hit a clause keyword
    const clauseKws = new Set<TokenType>([
      TokenType.WHERE, TokenType.FACET, TokenType.TIMESERIES,
      TokenType.SINCE, TokenType.UNTIL, TokenType.LIMIT,
      TokenType.ORDER, TokenType.COMPARE, TokenType.EXTRAPOLATE, TokenType.EOF,
    ]);
    while (!this.atEnd() && !clauseKws.has(this.cur().type)) {
      const t = this.cur();
      if (t.type === TokenType.STRING) {
        parts.push(`'${String(t.value)}'`);
      } else if (t.type === TokenType.NUMBER) {
        parts.push(String(t.value));
      } else if (t.type === TokenType.AGO) {
        parts.push('ago');
      } else if (t.type === TokenType.IDENTIFIER) {
        parts.push(String(t.value));
      } else if (t.type === TokenType.MAX_KW) {
        parts.push(String(t.value));
      } else if (t.type === TokenType.MINUS) {
        parts.push('-');
      } else {
        break;
      }
      this.pos += 1;
    }
    return parts.join(' ');
  }

  // -- Conditions (WHERE clause) --

  private parseCondition(): Condition {
    return this.parseOr();
  }

  private parseOr(): Condition {
    let left = this.parseAnd();
    while (this.match(TokenType.OR)) {
      const right = this.parseAnd();
      left = { type: 'logical', op: 'or', left, right };
    }
    return left;
  }

  private parseAnd(): Condition {
    let left = this.parseNot();
    while (this.match(TokenType.AND)) {
      const right = this.parseNot();
      left = { type: 'logical', op: 'and', left, right };
    }
    return left;
  }

  private parseNot(): Condition {
    if (this.match(TokenType.NOT)) {
      return { type: 'not', inner: this.parseNot() };
    }
    return this.parsePrimaryCondition();
  }

  private parsePrimaryCondition(): Condition {
    // Parenthesized -- could be a grouped condition OR an arithmetic expression
    if (this.check(TokenType.LPAREN)) {
      const savedPos = this.pos;
      try {
        this.pos += 1; // skip (
        const cond = this.parseCondition();
        this.expect(TokenType.RPAREN);
        return cond;
      } catch (e) {
        if (e instanceof ParseError) {
          // Not a grouped condition -- backtrack and parse as expression comparison
          this.pos = savedPos;
        } else {
          throw e;
        }
      }
    }

    // Bare boolean function conditions: isNotNull(field), isNull(field)
    if (this.check(TokenType.IDENTIFIER)) {
      const funcName = String(this.cur().value).toLowerCase();
      if (
        (funcName === 'isnotnull' || funcName === 'isnull') &&
        this.peek(1).type === TokenType.LPAREN
      ) {
        this.pos += 1; // skip function name
        this.pos += 1; // skip (
        const innerExpr = this.parseExpression();
        this.expect(TokenType.RPAREN);
        return { type: 'isNull', expr: innerExpr, negated: funcName === 'isnotnull' };
      }
    }

    // Parse left-hand expression (includes parenthesized arithmetic like (a/b)*100)
    const left = this.parseExpression();

    // IS [NOT] NULL / IS [NOT] TRUE / IS [NOT] FALSE
    if (this.check(TokenType.IS)) {
      this.pos += 1;
      const negated = Boolean(this.match(TokenType.NOT));
      if (this.check(TokenType.NULL)) {
        this.pos += 1;
        return { type: 'isNull', expr: left, negated };
      } else if (this.check(TokenType.TRUE)) {
        this.pos += 1;
        const op = negated ? '!=' : '==';
        return { type: 'comparison', left, op, right: { type: 'literal', value: true } };
      } else if (this.check(TokenType.FALSE)) {
        this.pos += 1;
        const op = negated ? '!=' : '==';
        return { type: 'comparison', left, op, right: { type: 'literal', value: false } };
      } else {
        this.expect(TokenType.NULL); // Will raise proper error
      }
    }

    // [NOT] IN (...)
    let negated = false;
    if (this.check(TokenType.NOT)) {
      // Peek ahead for IN or LIKE or RLIKE
      if (
        this.peek(1).type === TokenType.IN ||
        this.peek(1).type === TokenType.LIKE ||
        this.peek(1).type === TokenType.RLIKE
      ) {
        this.pos += 1;
        negated = true;
      }
    }

    if (this.match(TokenType.IN)) {
      return this.parseInClause(left, negated);
    }

    // [NOT] LIKE
    if (this.match(TokenType.LIKE)) {
      const pattern = String(this.expect(TokenType.STRING).value);
      return { type: 'like', expr: left, pattern, negated };
    }

    // [NOT] RLIKE
    if (this.match(TokenType.RLIKE)) {
      // Handle r'...' raw string prefix (NR syntax)
      if (this.check(TokenType.IDENTIFIER) && String(this.cur().value).toLowerCase() === 'r') {
        this.pos += 1; // skip 'r' prefix
      }
      const pattern = String(this.expect(TokenType.STRING).value);
      return { type: 'rlike', expr: left, pattern, negated };
    }

    // Comparison: =, !=, <, >, <=, >=
    const opMap: ReadonlyArray<[TokenType, string]> = [
      [TokenType.EQ, '='],
      [TokenType.NEQ, '!='],
      [TokenType.LT, '<'],
      [TokenType.GT, '>'],
      [TokenType.LTE, '<='],
      [TokenType.GTE, '>='],
    ];
    for (const [tt, opStr] of opMap) {
      if (this.match(tt)) {
        const right = this.parseExpression();
        return { type: 'comparison', op: opStr, left, right };
      }
    }

    throw new ParseError(
      `Expected comparison operator after expression, got ${String(this.cur().value)}`,
      this.cur().pos,
    );
  }

  private parseInClause(left: ASTNode, negated: boolean): Condition {
    this.expect(TokenType.LPAREN);
    // Check for subquery: IN (FROM Type SELECT ...) or IN (SELECT expr FROM Type WHERE ...)
    if (this.check(TokenType.FROM) || this.check(TokenType.SELECT)) {
      const subquery = this.parseSubquery();
      this.expect(TokenType.RPAREN);
      return { type: 'inSubquery', expr: left, subquery, negated };
    }
    // Value list
    const values: ASTNode[] = [this.parseExpression()];
    while (this.match(TokenType.COMMA)) {
      values.push(this.parseExpression());
    }
    this.expect(TokenType.RPAREN);
    return { type: 'inList', expr: left, values, negated };
  }

  private parseSubquery(): Query {
    if (this.check(TokenType.SELECT)) {
      // SELECT-first: SELECT expr FROM Type [WHERE ...] [LIMIT MAX]
      this.expect(TokenType.SELECT);
      const sel: SelectItem[] = [this.parseSelectItem()];
      this.expect(TokenType.FROM);
      const fromTok = this.cur();
      if (fromTok.type !== TokenType.IDENTIFIER && fromTok.type !== TokenType.MAX_KW) {
        throw new ParseError(
          `Expected event type in subquery, got ${String(fromTok.value)}`,
          fromTok.pos,
        );
      }
      const fromType = String(fromTok.value);
      this.pos += 1;

      let where: Condition | undefined;
      if (this.check(TokenType.WHERE)) {
        this.pos += 1;
        where = this.parseCondition();
      }

      // Handle LIMIT [MAX|number] inside subquery -- consume but ignore
      if (this.check(TokenType.LIMIT)) {
        this.pos += 1;
        if (this.check(TokenType.MAX_KW) || this.check(TokenType.NUMBER)) {
          this.pos += 1;
        }
      }

      return {
        selectItems: sel,
        fromClause: fromType,
        where,
        extrapolate: false,
        predict: false,
      };
    }

    // FROM-first: FROM Type SELECT expr [WHERE ...]
    this.expect(TokenType.FROM);
    const fromTok = this.cur();
    if (fromTok.type !== TokenType.IDENTIFIER && fromTok.type !== TokenType.MAX_KW) {
      throw new ParseError(
        `Expected event type in subquery, got ${String(fromTok.value)}`,
        fromTok.pos,
      );
    }
    const fromType = String(fromTok.value);
    this.pos += 1;
    this.expect(TokenType.SELECT);
    const sel: SelectItem[] = [this.parseSelectItem()];

    let where: Condition | undefined;
    if (this.check(TokenType.WHERE)) {
      this.pos += 1;
      where = this.parseCondition();
    }

    // Handle LIMIT [MAX|number] inside subquery -- consume but ignore
    if (this.check(TokenType.LIMIT)) {
      this.pos += 1;
      if (this.check(TokenType.MAX_KW) || this.check(TokenType.NUMBER)) {
        this.pos += 1;
      }
    }

    return {
      selectItems: sel,
      fromClause: fromType,
      where,
      extrapolate: false,
      predict: false,
    };
  }

  // -- Expressions (arithmetic) --

  private parseExpression(): ASTNode {
    return this.parseAdditive();
  }

  private parseAdditive(): ASTNode {
    let left = this.parseMultiplicative();
    while (this.check(TokenType.PLUS, TokenType.MINUS)) {
      const op = this.cur().type === TokenType.PLUS ? '+' : '-';
      this.pos += 1;
      const right = this.parseMultiplicative();
      left = { type: 'binary', op, left, right };
    }
    return left;
  }

  private parseMultiplicative(): ASTNode {
    let left = this.parseUnary();
    while (this.check(TokenType.STAR, TokenType.SLASH, TokenType.PERCENT)) {
      const t = this.cur();
      const op = t.type === TokenType.STAR ? '*' : t.type === TokenType.SLASH ? '/' : '%';
      this.pos += 1;
      const right = this.parseUnary();
      left = { type: 'binary', op, left, right };
    }
    return left;
  }

  private parseUnary(): ASTNode {
    if (this.match(TokenType.MINUS)) {
      return { type: 'unaryMinus', expr: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): ASTNode {
    const t = this.cur();

    // Star (wildcard)
    if (t.type === TokenType.STAR) {
      this.pos += 1;
      return { type: 'star' };
    }

    // Number literal
    if (t.type === TokenType.NUMBER) {
      this.pos += 1;
      // Check for time interval: NUMBER IDENTIFIER(time_unit)
      if (
        this.cur().type === TokenType.IDENTIFIER &&
        TIME_UNITS.has(String(this.cur().value).toLowerCase())
      ) {
        const unit = String(this.cur().value).toLowerCase();
        this.pos += 1;
        return { type: 'timeInterval', value: Number(t.value), unit };
      }
      return { type: 'literal', value: t.value as number };
    }

    // String literal
    if (t.type === TokenType.STRING) {
      this.pos += 1;
      return { type: 'literal', value: t.value as string };
    }

    // Boolean / null
    if (t.type === TokenType.TRUE) {
      this.pos += 1;
      return { type: 'literal', value: true };
    }
    if (t.type === TokenType.FALSE) {
      this.pos += 1;
      return { type: 'literal', value: false };
    }
    if (t.type === TokenType.NULL) {
      this.pos += 1;
      return { type: 'literal', value: null };
    }

    // Parenthesized expression
    if (t.type === TokenType.LPAREN) {
      this.pos += 1;
      const expr = this.parseExpression();
      this.expect(TokenType.RPAREN);
      return expr;
    }

    // Identifier: function call or field reference
    if (t.type === TokenType.IDENTIFIER || t.type === TokenType.MAX_KW) {
      const name = String(t.value);
      this.pos += 1;
      // Function call?
      if (this.check(TokenType.LPAREN)) {
        this.pos += 1; // consume (
        const [args, whereClause] = this.parseFunctionArgs(name);
        this.expect(TokenType.RPAREN);
        return { type: 'function', name, args, where: whereClause };
      }
      return { type: 'field', name };
    }

    throw new ParseError(
      `Expected expression, got ${String(t.value)}`,
      t.pos,
    );
  }

  private parseFunctionArgs(funcName: string): [ASTNode[], Condition | undefined] {
    const args: ASTNode[] = [];
    let whereClause: Condition | undefined;

    if (this.check(TokenType.RPAREN)) {
      return [args, undefined];
    }

    // NR's filter(WHERE cond) -- WHERE appears immediately with no leading expression arg
    if (funcName.toLowerCase() === 'filter' && this.check(TokenType.WHERE)) {
      this.pos += 1; // skip WHERE
      whereClause = this.parseCondition();
      return [args, whereClause];
    }

    // NR's if(condition, trueVal, falseVal) -- first arg is a condition
    if (funcName.toLowerCase() === 'if') {
      const cond = this.parseCondition();
      args.push(cond);
      while (this.match(TokenType.COMMA)) {
        args.push(this.parseExpression());
      }
      return [args, undefined];
    }

    // NR's funnel(column, WHERE cond AS 'label', WHERE cond AS 'label', ...)
    if (funcName.toLowerCase() === 'funnel') {
      args.push(this.parseExpression()); // column (e.g. session)
      this.match(TokenType.COMMA); // consume comma after column
      while (!this.check(TokenType.RPAREN) && !this.atEnd()) {
        if (this.check(TokenType.WHERE)) {
          this.pos += 1; // skip WHERE
          const cond = this.parseCondition();
          args.push(cond);
          if (this.match(TokenType.AS)) {
            args.push(this.parseExpression()); // label string
          }
        } else {
          args.push(this.parseExpression());
        }
        this.match(TokenType.COMMA); // optional separator
      }
      return [args, undefined];
    }

    args.push(this.parseExpression());

    // Handle NR OR-coalesce inside function args: average(fieldA OR fieldB)
    if (this.check(TokenType.OR)) {
      this.pos += 1; // skip OR
      // Consume the rest until RPAREN, discarding the fallback expression
      let depth = 1;
      while (!this.atEnd() && depth > 0) {
        if (this.check(TokenType.LPAREN)) {
          depth += 1;
        } else if (this.check(TokenType.RPAREN)) {
          if (depth === 1) {
            break;
          }
          depth -= 1;
        }
        this.pos += 1;
      }
      return [args, undefined];
    }

    while (this.match(TokenType.COMMA)) {
      // Check for WHERE in functions that support it
      if (WHERE_FUNCTIONS.has(funcName.toLowerCase()) && this.check(TokenType.WHERE)) {
        this.pos += 1;
        whereClause = this.parseCondition();
        break;
      }
      args.push(this.parseExpression());
    }

    return [args, whereClause];
  }
}
