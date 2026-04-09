/**
 * Specialized NRQL-to-DQL converters for complex patterns.
 *
 * Each converter handles a specific NRQL construct that requires
 * non-trivial transformation to Dynatrace equivalents.
 */

// =============================================================================
// RegexToDPLConverter
// =============================================================================

/** Result of a DPL conversion: the DPL pattern string and extracted capture names. */
export type DPLConvertResult = [dplPattern: string, captureNames: string[]];

/**
 * Converts RE2 regex patterns to Dynatrace Pattern Language (DPL).
 *
 * Strategy:
 * 1. Extract named capture groups first, converting inner patterns
 * 2. Convert remaining regex to DPL matchers
 * 3. Wrap literal text in quotes
 * 4. Output format: MATCHER:export_name (no spaces around colon)
 */
export class RegexToDPLConverter {
  static readonly DPL_KEYWORDS = new Set([
    'INT', 'LONG', 'WORD', 'ALPHA', 'ALNUM', 'DIGIT', 'SPACE', 'NSPACE',
    'IPV4', 'IPV6', 'IPADDR', 'TIMESTAMP', 'ISO8601', 'LD', 'DATA',
    'UPPER', 'LOWER', 'EOL', 'DQS', 'SQS', 'JSON', 'BOOLEAN',
    'DOUBLE', 'FLOAT', 'HEXINT',
  ]);

  /** Convert RE2 regex to DPL pattern. Returns [dplPattern, captureNames]. */
  convert(regexPattern: string): DPLConvertResult {
    const captureNames: string[] = [];
    const segments: Array<{ type: 'matcher' | 'literal'; content: string }> = [];

    let pos = 0;
    let pattern = regexPattern;

    // Strip anchors
    if (pattern.startsWith('^')) {
      pattern = pattern.slice(1);
    }
    if (pattern.endsWith('$')) {
      pattern = pattern.slice(0, -1);
    }

    while (pos < pattern.length) {
      // Named capture group: (?P<name>inner)
      const namedMatch = /^\(\?P<(\w+)>([^)]*)\)/.exec(pattern.slice(pos));
      if (namedMatch !== null && namedMatch[1] !== undefined && namedMatch[2] !== undefined) {
        const name = namedMatch[1];
        const inner = namedMatch[2];
        captureNames.push(name);
        const dplType = this.innerToDplType(inner);
        segments.push({ type: 'matcher', content: `${dplType}:${name}` });
        pos += namedMatch[0].length;
        continue;
      }

      // Unnamed capture group: (inner) — but not (?...)
      const unnamedMatch = /^\(([^?][^)]*)\)/.exec(pattern.slice(pos));
      if (unnamedMatch !== null && unnamedMatch[1] !== undefined) {
        const inner = unnamedMatch[1];
        const groupName = `group${captureNames.length + 1}`;
        captureNames.push(groupName);
        const dplType = this.innerToDplType(inner);
        segments.push({ type: 'matcher', content: `${dplType}:${groupName}` });
        pos += unnamedMatch[0].length;
        continue;
      }

      // Whitespace shorthand with quantifier: \s+, \s*, \s
      const wsMatch = /^\\s([+*?]?)/.exec(pattern.slice(pos));
      if (wsMatch !== null) {
        const q = wsMatch[1] ?? '';
        segments.push({ type: 'matcher', content: `SPACE${q}` });
        pos += wsMatch[0].length;
        continue;
      }

      // Non-whitespace shorthand: \S+, \S*, \S
      const nwsMatch = /^\\S([+*?]?)/.exec(pattern.slice(pos));
      if (nwsMatch !== null) {
        const q = nwsMatch[1] ?? '';
        segments.push({ type: 'matcher', content: `NSPACE${q}` });
        pos += nwsMatch[0].length;
        continue;
      }

      // Word shorthand with quantifier: \w+, \w*
      const wordMatch = /^\\w([+*?]?)/.exec(pattern.slice(pos));
      if (wordMatch !== null) {
        const q = wordMatch[1] ?? '';
        if (q === '+') {
          segments.push({ type: 'matcher', content: 'WORD' });
        } else if (q === '*') {
          segments.push({ type: 'matcher', content: 'WORD?' });
        } else {
          segments.push({ type: 'matcher', content: 'ALNUM' });
        }
        pos += wordMatch[0].length;
        continue;
      }

      // Digit with quantifier: \d+, \d*, \d{n}, \d{n,m}
      const digitMatch = /^\\d(\{[^}]+\}|[+*?]?)/.exec(pattern.slice(pos));
      if (digitMatch !== null) {
        const q = digitMatch[1] ?? '';
        if (q === '+' || q === '{1,}') {
          segments.push({ type: 'matcher', content: 'INT' });
        } else if (q === '') {
          segments.push({ type: 'matcher', content: 'DIGIT' });
        } else if (q === '*') {
          segments.push({ type: 'matcher', content: 'INT?' });
        } else if (q.startsWith('{')) {
          segments.push({ type: 'matcher', content: 'INT' });
        } else {
          segments.push({ type: 'matcher', content: 'DIGIT' });
        }
        pos += digitMatch[0].length;
        continue;
      }

      // Character class: [...]
      const ccMatch = /^\[([^\]]+)\]([+*?]?)/.exec(pattern.slice(pos));
      if (ccMatch !== null && ccMatch[1] !== undefined) {
        const ccInner = ccMatch[1];
        const q = ccMatch[2] ?? '';
        const dplCc = this.charClassToDpl(ccInner, q);
        segments.push({ type: 'matcher', content: dplCc });
        pos += ccMatch[0].length;
        continue;
      }

      // Dot with quantifier: .+, .*, .
      const dotMatch = /^\.([+*?])/.exec(pattern.slice(pos));
      if (dotMatch !== null && pos > 0 && pattern[pos - 1] !== '\\') {
        const q = dotMatch[1] ?? '+';
        if (q === '+') {
          segments.push({ type: 'matcher', content: 'LD' });
        } else if (q === '*') {
          segments.push({ type: 'matcher', content: 'LD?' });
        } else {
          segments.push({ type: 'matcher', content: 'LD' });
        }
        pos += dotMatch[0].length;
        continue;
      }

      // Escaped characters
      if (pattern[pos] === '\\' && pos + 1 < pattern.length) {
        const nextCh = pattern[pos + 1] ?? '';
        if (nextCh === 'b') {
          // Word boundary — skip in DPL
          pos += 2;
          continue;
        } else if (nextCh === 'W') {
          segments.push({ type: 'matcher', content: 'SPACE' });
          pos += 2;
          continue;
        } else if (nextCh === 'D') {
          segments.push({ type: 'matcher', content: 'ALPHA' });
          pos += 2;
          continue;
        } else {
          // Escaped literal: \. \/ \- \[ etc.
          segments.push({ type: 'literal', content: nextCh });
          pos += 2;
          continue;
        }
      }

      // Alternation group: (A|B|C) — not a capture
      const altMatch = /^\((\?:)?([^)]+)\)/.exec(pattern.slice(pos));
      if (altMatch !== null && altMatch[2] !== undefined && altMatch[2].includes('|')) {
        const alts = altMatch[2].split('|');
        const altStrs = alts.map((a) => `'${a}'`);
        segments.push({ type: 'matcher', content: `(${altStrs.join(' | ')})` });
        pos += altMatch[0].length;
        continue;
      }

      // Regular literal character
      const ch = pattern[pos] ?? '';
      if (!'()[]\\^$.*+?{}|'.includes(ch)) {
        let litEnd = pos;
        while (litEnd < pattern.length) {
          const litCh = pattern[litEnd] ?? '';
          if ('()[]\\^$.*+?{}|'.includes(litCh)) break;
          litEnd++;
        }
        segments.push({ type: 'literal', content: pattern.slice(pos, litEnd) });
        pos = litEnd;
      } else {
        // Skip unhandled metacharacter
        pos += 1;
      }
    }

    // Build DPL string
    const dplParts = segments.map((seg) =>
      seg.type === 'literal' ? `'${seg.content}'` : seg.content,
    );

    return [dplParts.join(' '), captureNames];
  }

  /** Convert the inner pattern of a capture group to a DPL matcher type. */
  private innerToDplType(rawInner: string): string {
    const inner = rawInner.trim();

    // IP address patterns
    if (/\\d\{1,3\}.*\\d\{1,3\}.*\\d\{1,3\}.*\\d\{1,3\}/.test(inner)) {
      return 'IPV4';
    }

    // ISO timestamp
    if (inner.includes('\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}')) {
      return 'ISO8601';
    }
    if (inner.includes('\\d{4}-\\d{2}-\\d{2}') && inner.includes('T')) {
      return 'ISO8601';
    }
    if (/^\\d\{4\}[-./]\\d\{2\}[-./]\\d\{2\}/.test(inner)) {
      return 'TIMESTAMP';
    }

    // Pure digit patterns
    if (inner === '\\d+' || inner === '[0-9]+' || inner === '\\d{1,}') {
      return 'INT';
    }
    if (/^\\d\{\d+(,\d+)?\}$/.test(inner)) {
      return 'INT';
    }
    if (inner === '\\d') {
      return 'DIGIT';
    }

    // Word patterns
    if (inner === '\\w+' || inner === '[a-zA-Z0-9_]+') {
      return 'WORD';
    }
    if (inner === '\\w') {
      return 'ALNUM';
    }

    // Alpha patterns
    if (inner === '[a-zA-Z]+' || inner === '[A-Za-z]+') {
      return 'ALPHA+';
    }
    if (inner === '[A-Z]+') {
      return 'UPPER+';
    }
    if (inner === '[a-z]+') {
      return 'LOWER+';
    }

    // Non-whitespace (common for URLs, tokens)
    if (inner === '\\S+' || inner === '[^ ]+' || inner === '[^\\s]+') {
      return 'NSPACE+';
    }

    // Character classes with negation
    const negMatch = /^\[\^([^\]]+)\]\+?$/.exec(inner);
    if (negMatch !== null && negMatch[1] !== undefined) {
      const excluded = negMatch[1];
      if (excluded === '"') {
        return 'DQS';
      } else if (excluded === "'") {
        return 'SQS';
      } else if (excluded.includes('/') || excluded.includes(' ')) {
        return 'NSPACE+';
      } else {
        return 'LD';
      }
    }

    // Character classes with specific chars
    const ccMatch = /^\[([^\]]+)\]([+*?]?)$/.exec(inner);
    if (ccMatch !== null && ccMatch[1] !== undefined) {
      const chars = ccMatch[1];
      const q = ccMatch[2] ?? '+';
      return this.charClassToDpl(chars, q);
    }

    // Alternation: INFO|WARN|ERROR|DEBUG
    if (inner.includes('|') && !inner.startsWith('(')) {
      const alts = inner.split('|');
      return `(${alts.map((a) => `'${a}'`).join(' | ')})`;
    }

    // Wildcard .+ or .*
    if (inner === '.+' || inner === '.*') {
      return 'LD';
    }

    // Default: line data
    return 'LD';
  }

  /** Convert a character class like [a-zA-Z0-9.-] to a DPL matcher. */
  private charClassToDpl(ccInner: string, quantifier: string): string {
    const q = quantifier;

    if (ccInner === 'a-zA-Z' || ccInner === 'A-Za-z') {
      return `ALPHA${q}`;
    }
    if (ccInner === 'a-zA-Z0-9' || ccInner === 'A-Za-z0-9' || ccInner === '0-9a-zA-Z') {
      return `ALNUM${q}`;
    }
    if (ccInner === '0-9') {
      return q === '+' || q === '' ? 'INT' : `DIGIT${q}`;
    }
    if (ccInner === 'A-Z') {
      return `UPPER${q}`;
    }
    if (ccInner === 'a-z') {
      return `LOWER${q}`;
    }
    if (ccInner.startsWith('^')) {
      const excluded = ccInner.slice(1);
      if (excluded.includes(' ') || excluded.includes('\\s')) {
        return `NSPACE${q}`;
      }
      if (excluded.includes('"')) {
        return 'DQS';
      }
      return `LD${q}`;
    }

    // Complex character class with dots, dashes etc: keep as LD
    if (ccInner.includes('\\w') || ccInner.includes('a-z')) {
      return q ? `WORD${q}` : 'WORD';
    }

    return `LD${q}`;
  }
}

// =============================================================================
// AparseConverter
// =============================================================================

/**
 * Converts NRQL aparse() anchor patterns (% delimiters) to DPL.
 *
 * NRQL: aparse(message, 'status=%status% user=%user%')
 * DPL:  'status=' LD:status ' user=' LD:user
 */
export class AparseConverter {
  /** Convert aparse pattern to DPL. Returns [dplPattern, captureNames]. */
  convert(pattern: string): DPLConvertResult {
    const captureNames: string[] = [];
    const dplParts: string[] = [];
    const parts = pattern.split('%');

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i] ?? '';
      if (i % 2 === 0) {
        if (part) {
          dplParts.push(`'${part}'`);
        }
      } else {
        captureNames.push(part);
        const dplType = this.inferType(part);
        dplParts.push(`${dplType}:${part}`);
      }
    }

    return [dplParts.join(' '), captureNames];
  }

  /** Infer DPL matcher type from the capture name. */
  private inferType(name: string): string {
    const nameLower = name.toLowerCase();
    if (nameLower.includes('ip') || nameLower.includes('addr')) return 'IPADDR';
    if (
      nameLower.includes('port') ||
      nameLower.includes('code') ||
      nameLower.includes('num') ||
      nameLower.includes('count')
    ) {
      return 'INT';
    }
    if (nameLower.includes('time') || nameLower.includes('date')) return 'TIMESTAMP';
    if (nameLower.includes('user') || nameLower.includes('name')) return 'WORD';
    if (nameLower.includes('email')) return 'NSPACE';
    if (nameLower.includes('url') || nameLower.includes('path')) return 'NSPACE';
    if (nameLower.includes('msg') || nameLower.includes('message')) return 'LD';
    return 'LD';
  }
}

// =============================================================================
// RateDerivativeConverter
// =============================================================================

/** Result of a rate/derivative conversion: [dqlAggExpr, rateParam]. */
export type RateConvertResult = [dqlAggExpr: string, rateParam: string];

/**
 * Converts NRQL rate() and derivative() to DQL timeseries with rate: param.
 *
 * NRQL: rate(count(*), 1 minute) -> DQL: count(), rate:1m
 */
export class RateDerivativeConverter {
  private static readonly UNIT_MAP: Readonly<Record<string, string>> = {
    second: 's', seconds: 's', sec: 's',
    minute: 'm', minutes: 'm', min: 'm',
    hour: 'h', hours: 'h', hr: 'h',
    day: 'd', days: 'd',
  };

  private static readonly AGG_MAP: Readonly<Record<string, string>> = {
    count: 'count', sum: 'sum', avg: 'avg',
    average: 'avg', min: 'min', max: 'max',
  };

  /** Convert rate(agg(field), N unit) to DQL. Returns [dqlAggExpr, rateParam] or undefined. */
  convertRate(rateExpr: string): RateConvertResult | undefined {
    const match = /^rate\s*\(\s*(\w+)\s*\(\s*([^)]*)\s*\)\s*,\s*(\d+)\s*(\w+)\s*\)/i.exec(rateExpr);
    if (!match) return undefined;

    const agg = match[1] ?? '';
    const field = match[2] ?? '';
    const amount = match[3] ?? '';
    const unit = match[4] ?? '';
    const dqlAgg = RateDerivativeConverter.AGG_MAP[agg.toLowerCase()] ?? agg.toLowerCase();
    const dqlUnit = RateDerivativeConverter.UNIT_MAP[unit.toLowerCase()] ?? unit[0]?.toLowerCase() ?? '';

    const fieldPart = field === '*' || !field ? '' : field;
    return [`${dqlAgg}(${fieldPart})`, `rate:${amount}${dqlUnit}`];
  }

  /** Convert derivative(agg(field), N unit) to DQL. Returns [dqlAggExpr, rateParam] or undefined. */
  convertDerivative(derivExpr: string): RateConvertResult | undefined {
    const match = /^derivative\s*\(\s*(\w+)\s*\(\s*([^)]*)\s*\)\s*,\s*(\d+)\s*(\w+)\s*\)/i.exec(derivExpr);
    if (!match) return undefined;

    const agg = match[1] ?? '';
    const field = match[2] ?? '';
    const amount = match[3] ?? '';
    const unit = match[4] ?? '';
    const dqlAgg = RateDerivativeConverter.AGG_MAP[agg.toLowerCase()] ?? agg.toLowerCase();
    const dqlUnit = RateDerivativeConverter.UNIT_MAP[unit.toLowerCase()] ?? unit[0]?.toLowerCase() ?? '';

    const fieldPart = field === '*' || !field ? '' : field;
    return [`${dqlAgg}(${fieldPart})`, `rate:${amount}${dqlUnit}`];
  }
}

// =============================================================================
// CompareWithConverter
// =============================================================================

/** Result of a COMPARE WITH conversion: [cleanedNrql, shiftParam]. */
export type CompareWithResult = [cleanedNrql: string, shiftParam: string];

/**
 * Converts NRQL COMPARE WITH -> DQL timeseries shift: parameter.
 *
 * NRQL: SELECT ... COMPARE WITH 1 day ago -> shift:-1d
 */
export class CompareWithConverter {
  private static readonly UNIT_MAP: Readonly<Record<string, string>> = {
    second: 's', minute: 'm', hour: 'h', day: 'd', week: 'd', month: 'd',
  };

  /** Extract COMPARE WITH and return [cleanedNrql, shiftParam] or undefined. */
  convert(nrql: string): CompareWithResult | undefined {
    const match = /\s*COMPARE\s+WITH\s+(\d+)\s+(second|minute|hour|day|week|month)s?\s+ago\s*/i.exec(nrql);
    if (!match) return undefined;

    const amountStr = match[1] ?? '0';
    const unitStr = match[2] ?? 'day';
    const amount = parseInt(amountStr, 10);
    const unit = unitStr.toLowerCase();

    let shiftAmount: number;
    let shiftUnit: string;
    if (unit === 'week') {
      shiftAmount = amount * 7;
      shiftUnit = 'd';
    } else if (unit === 'month') {
      shiftAmount = amount * 30;
      shiftUnit = 'd';
    } else {
      shiftAmount = amount;
      shiftUnit = CompareWithConverter.UNIT_MAP[unit] ?? unit[0] ?? '';
    }

    const shiftParam = `shift:-${shiftAmount}${shiftUnit}`;
    const cleaned = nrql.replace(/\s*COMPARE\s+WITH\s+\d+\s+\w+\s+ago\s*/gi, '').trim();
    return [cleaned, shiftParam];
  }
}

// =============================================================================
// FunnelConverter
// =============================================================================

/** Result of a funnel conversion. */
export interface FunnelConvertResult {
  readonly usql: string;
  readonly steps: ReadonlyArray<{ readonly field: string; readonly op: string; readonly value: string }>;
  readonly type: 'usql';
  readonly note: string;
}

/**
 * Converts NRQL funnel() to Dynatrace USQL FUNNEL.
 */
export class FunnelConverter {
  private static readonly FIELD_MAP: Readonly<Record<string, string>> = {
    action: 'useraction.name',
    name: 'useraction.name',
    page: 'useraction.name',
    type: 'useraction.type',
    application: 'useraction.application',
    app: 'useraction.application',
  };

  /** Convert NRQL funnel() to USQL. Returns result or undefined. */
  convert(nrql: string): FunnelConvertResult | undefined {
    const funnelMatch = /funnel\s*\(\s*(\w+)\s*,\s*(.+?)\s*\)\s*/i.exec(nrql);
    if (!funnelMatch) return undefined;

    const body = funnelMatch[2] ?? '';
    const conditionRegex = /WHERE\s+(\w+)\s*(=|!=|LIKE)\s*['"]([^'"]+)['"]/gi;
    const conditions: Array<{ field: string; op: string; value: string }> = [];
    let condMatch: RegExpExecArray | null;
    while ((condMatch = conditionRegex.exec(body)) !== null) {
      const field = condMatch[1] ?? '';
      const op = condMatch[2] ?? '';
      const value = condMatch[3] ?? '';
      conditions.push({ field, op, value });
    }

    if (conditions.length === 0) return undefined;

    const usqlParts: string[] = [];
    const steps: Array<{ field: string; op: string; value: string }> = [];

    for (const { field, op, value } of conditions) {
      const usqlField = FunnelConverter.FIELD_MAP[field.toLowerCase()] ?? `useraction.${field}`;
      const usqlOp = op.toUpperCase() === '=' || op.toUpperCase() === 'LIKE' ? '=' : '!=';
      usqlParts.push(`${usqlField}${usqlOp}"${value}"`);
      steps.push({ field, op, value });
    }

    return {
      usql: `SELECT FUNNEL(${usqlParts.join(', ')}) FROM usersession`,
      steps,
      type: 'usql',
      note: 'Requires User Sessions API, not DQL',
    };
  }
}

// =============================================================================
// ExtrapolateHandler
// =============================================================================

/** Result of extrapolate handling: [cleanedNrql, updatedDql, note]. */
export type ExtrapolateResult = [cleanedNrql: string, updatedDql: string, note: string | undefined];

/**
 * Handles NRQL EXTRAPOLATE keyword -> DT auto-sampling or extrapolate:true.
 */
export class ExtrapolateHandler {
  /** Process EXTRAPOLATE. Returns [cleanedNrql, updatedDql, note]. */
  handle(nrql: string, dql: string): ExtrapolateResult {
    if (!nrql.toUpperCase().includes('EXTRAPOLATE')) {
      return [nrql, dql, undefined];
    }

    const cleanedNrql = nrql.replace(/\s+EXTRAPOLATE\s*/gi, ' ').trim();

    if (dql.includes('countDistinct')) {
      const updatedDql = dql.replace(
        /countDistinct\(([^)]+)\)/g,
        'countDistinct($1, extrapolate:true)',
      );
      return [cleanedNrql, updatedDql, 'Added extrapolate:true to countDistinct'];
    }

    return [cleanedNrql, dql, 'EXTRAPOLATE removed - Dynatrace handles sampling automatically'];
  }
}

// =============================================================================
// BucketPercentileConverter
// =============================================================================

/**
 * Converts NRQL bucketPercentile() -> DQL multiple percentile() calls.
 *
 * NRQL: bucketPercentile(http_req_duration_bucket, 50, 95, 99)
 * DQL:  percentile(http_req_duration, 50), percentile(..., 95), ...
 */
export class BucketPercentileConverter {
  /** Convert bucketPercentile() to multiple percentile() calls. Returns DQL string or undefined. */
  convert(expr: string): string | undefined {
    const match = /^bucketPercentile\s*\(\s*([^,]+)\s*,\s*(.+)\s*\)/i.exec(expr);
    if (!match) return undefined;

    const metricRaw = match[1] ?? '';
    const percentilesRaw = match[2] ?? '';
    const metric = metricRaw.trim().replace(/_bucket$/, '');
    const percentiles = percentilesRaw.split(',').map((p) => p.trim());
    return percentiles.map((p) => `percentile(${metric}, ${p})`).join(', ');
  }
}

// =============================================================================
// WithAsConverter
// =============================================================================

/** CTE definition extracted from a WITH...AS clause. */
interface CTEDefinition {
  readonly name: string;
  readonly query: string;
  readonly agg?: string;
  readonly field?: string;
  readonly simple: boolean;
}

/** Result of a WITH...AS conversion. */
export interface WithAsConvertResult {
  readonly dql: string;
  readonly strategy: 'inline' | 'manual_review';
  readonly ctes: readonly CTEDefinition[];
  readonly note?: string;
}

/**
 * Handles NRQL WITH...AS (CTE) patterns -> DQL inline or append strategy.
 */
export class WithAsConverter {
  private static readonly AGG_MAP: Readonly<Record<string, string>> = {
    count: 'count', sum: 'sum', avg: 'avg',
    average: 'avg', min: 'min', max: 'max',
    uniquecount: 'countDistinct',
  };

  /** Convert WITH...AS CTE to DQL. Returns result or undefined. */
  convert(nrql: string): WithAsConvertResult | undefined {
    const cteMatch = /^WITH\s+((?:\w+\s+AS\s*\([^)]+\)\s*,?\s*)+)/i.exec(nrql);
    if (!cteMatch) return undefined;

    const cteBody = cteMatch[1] ?? '';
    const cteDefRegex = /(\w+)\s+AS\s*\(([^)]+)\)/gi;
    const cteDefs: Array<[string, string]> = [];
    let defMatch: RegExpExecArray | null;
    while ((defMatch = cteDefRegex.exec(cteBody)) !== null) {
      const defName = defMatch[1] ?? '';
      const defQuery = defMatch[2] ?? '';
      cteDefs.push([defName, defQuery]);
    }

    if (cteDefs.length === 0) return undefined;

    const mainQuery = nrql.slice(cteMatch[0].length);
    const mainMatch = /^\s*SELECT\s+(.+)/i.exec(mainQuery);
    if (!mainMatch) return undefined;

    const mainSelect = mainMatch[1] ?? '';
    const ctes: CTEDefinition[] = [];
    let allSimple = true;

    for (const [name, query] of cteDefs) {
      const aggMatch = /SELECT\s+(\w+)\s*\(\s*([^)]*)\s*\)/i.exec(query);
      if (aggMatch) {
        ctes.push({
          name,
          query,
          agg: aggMatch[1] ?? '',
          field: aggMatch[2] ?? '*',
          simple: true,
        });
      } else {
        ctes.push({ name, query, simple: false });
        allSimple = false;
      }
    }

    if (allSimple && ctes.length <= 2) {
      return this.inlineStrategy(ctes, mainSelect);
    }
    return this.appendStrategy(ctes, mainSelect);
  }

  private inlineStrategy(ctes: readonly CTEDefinition[], mainSelect: string): WithAsConvertResult {
    const aggParts: string[] = [];
    for (const cte of ctes) {
      if (!cte.agg) continue;
      const dqlAgg = WithAsConverter.AGG_MAP[cte.agg.toLowerCase()] ?? cte.agg.toLowerCase();
      const f = cte.field;
      if (f === '*' || !f) {
        aggParts.push(`${cte.name} = ${dqlAgg}()`);
      } else {
        aggParts.push(`${cte.name} = ${dqlAgg}(${f})`);
      }
    }

    let resultExpr = mainSelect;
    for (const cte of ctes) {
      resultExpr = resultExpr.replace(new RegExp(`${cte.name}\\.\\w+`, 'g'), cte.name);
    }

    const dql = `fetch spans\n| summarize ${aggParts.join(', ')}\n| fieldsAdd result = ${resultExpr}`;
    return { dql, strategy: 'inline', ctes };
  }

  private appendStrategy(ctes: readonly CTEDefinition[], mainSelect: string): WithAsConvertResult {
    const dqlParts = ctes.map((c) => `// CTE: ${c.name}\n// ${c.query}`);
    const dql = dqlParts.join('\n') + `\n\n// Main query needs manual review:\n// SELECT ${mainSelect}`;
    return {
      dql,
      strategy: 'manual_review',
      ctes,
      note: 'Complex CTE requires manual review - use append or join',
    };
  }
}
