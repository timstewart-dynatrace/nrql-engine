/**
 * DQL syntax auto-fixer.
 *
 * Validates and automatically corrects common NRQL->DQL conversion issues.
 * Ported from Python DQLValidator (renamed DQLFixer to avoid confusion with
 * the DQLSyntaxValidator in dql-validator.ts).
 */

import { NRQLCompiler } from '../compiler/compiler.js';

// ---------------------------------------------------------------------------
// Standalone helper
// ---------------------------------------------------------------------------

/**
 * Convert milliseconds to the most readable DQL duration literal.
 *
 * Delegates to NRQLCompiler.msToDurationLiteral to avoid duplication.
 */
export function msToDqlDuration(ms: number): string {
  return NRQLCompiler.msToDurationLiteral(ms);
}

// ---------------------------------------------------------------------------
// DQLFixer
// ---------------------------------------------------------------------------

export class DQLFixer {
  private fixes: string[] = [];

  /**
   * Validate DQL and fix any syntax issues.
   * Returns a tuple of [fixed_dql, list_of_fixes_applied].
   */
  validateAndFix(dql: string, context = ''): [string, string[]] {
    this.fixes = [];

    if (!dql || dql.trim() === '') {
      return [dql, []];
    }

    // Apply fixes in order
    dql = this.fixVariables(dql);
    dql = this.fixBackticks(dql);
    dql = this.fixQuotes(dql);
    dql = this.fixComparisonOperators(dql);
    dql = this.fixLogicalOperators(dql);
    dql = this.fixNullChecks(dql);
    dql = this.fixLikePatterns(dql);
    dql = this.fixWhereInFilter(dql);
    dql = this.fixTimeseriesCount(dql, context);
    dql = this.fixInvalidFunctions(dql);
    dql = this.fixBrokenByClause(dql);
    dql = this.fixFieldNames(dql);
    dql = this.fixDuplicateAggregations(dql);
    dql = this.fixPercentileNaming(dql);
    dql = this.fixAsAliases(dql);
    dql = this.fixBareFieldInSummarize(dql);
    dql = this.fixNrqlSubqueries(dql);
    dql = this.fixMetricNames(dql);
    dql = this.fixDurationUnits(dql);
    dql = this.fixNegationToFilterout(dql);
    dql = this.fixArrayCountWithoutExpand(dql);
    dql = this.fixWhitespace(dql);

    return [dql, this.fixes];
  }

  // -------------------------------------------------------------------------
  // Private fix methods
  // -------------------------------------------------------------------------

  /**
   * Convert NR template variables {{var}} to DT format $var.
   */
  private fixVariables(dql: string): string {
    return dql.replace(/\{\{(\w+)\}\}/g, (_match, varName: string) => {
      this.fixes.push(`Converted variable {{${varName}}} to $${varName}`);
      return `$${varName}`;
    });
  }

  /**
   * Fix backtick-quoted field names, but preserve backticks where needed.
   *
   * Preserves backticks for:
   * - DQL reserved/type words (duration, timestamp, string, etc.)
   * - Identifiers starting with digits (4XX, 5XX)
   * - Identifiers with special characters (/, $, spaces, hyphens)
   * - fieldsRename lines (always need backticks for display names)
   */
  private fixBackticks(dql: string): string {
    const DQL_RESERVED = new Set([
      'duration', 'timestamp', 'timeframe', 'string', 'long', 'double',
      'boolean', 'ip', 'record', 'array', 'true', 'false', 'null',
      'fetch', 'filter', 'summarize', 'fields', 'sort', 'limit',
      'lookup', 'join', 'append', 'parse', 'from', 'to', 'by',
      'asc', 'desc', 'not', 'and', 'or', 'in', 'is',
    ]);

    const needsBackticks = (field: string): boolean => {
      if (!field) return false;
      // Starts with digit
      if (/^\d/.test(field)) return true;
      // Is a DQL reserved word
      if (DQL_RESERVED.has(field.toLowerCase())) return true;
      // Contains special characters (not just alphanumeric, dots, underscores)
      if (/[^a-zA-Z0-9._]/.test(field)) return true;
      return false;
    };

    const fieldMap: Record<string, string> = {
      'k8s.podName': 'k8s.pod.name',
      'k8s.containerName': 'k8s.container.name',
      'k8s.clusterName': 'k8s.cluster.name',
      'k8s.namespaceName': 'k8s.namespace.name',
      'k8s.deploymentName': 'k8s.deployment.name',
      'k8s.nodeName': 'k8s.node.name',
    };

    const cleanBacktick = (_match: string, field: string): string => {
      const mapped = fieldMap[field];
      if (mapped !== undefined) {
        this.fixes.push(`Converted \`${field}\` to ${mapped}`);
        return mapped;
      }
      if (needsBackticks(field)) {
        return `\`${field}\``;
      }
      return field;
    };

    // Process line by line to skip fieldsRename lines
    const lines = dql.split('\n');
    const resultLines: string[] = [];
    for (const line of lines) {
      const stripped = line.trim().replace(/^\|\s*/, '');
      if (stripped.startsWith('fieldsRename')) {
        // Preserve backticks in fieldsRename - they're intentional
        resultLines.push(line);
      } else {
        resultLines.push(
          line.replace(/`([^`]+)`/g, cleanBacktick),
        );
      }
    }

    return resultLines.join('\n');
  }

  /**
   * DQL uses double quotes for strings, not single quotes.
   */
  private fixQuotes(dql: string): string {
    return dql.replace(/'([^']*)'/g, (_match, content: string) => {
      // Don't replace if it contains double quotes
      if (content.includes('"')) {
        return _match;
      }
      this.fixes.push(`Changed single quotes to double quotes: '${content}'`);
      return `"${content}"`;
    });
  }

  /**
   * Fix comparison operator syntax for DQL.
   */
  private fixComparisonOperators(dql: string): string {
    // <> is not valid in DQL, use !=
    if (dql.includes('<>')) {
      dql = dql.replaceAll('<>', '!=');
      this.fixes.push("Changed '<>' to '!='");
    }

    // CRITICAL: DQL uses == for equality, not =
    // Don't convert = to == in fieldsAdd statements (those are assignments)
    const fixSingleEquals = (_match: string, before: string, after: string): string => {
      this.fixes.push("Changed '=' to '==' for equality comparison");
      return `${before}==${after}`;
    };

    const lines = dql.split('\n');
    const fixedLines: string[] = [];
    for (let line of lines) {
      // Skip fieldsAdd lines - they use = for assignment
      if (
        line.includes('fieldsAdd') ||
        line.includes('fieldsRemove') ||
        line.includes('fieldsRename')
      ) {
        fixedLines.push(line);
        continue;
      }

      // Match single = that's not part of !=, >=, <=, ==
      line = line.replace(/(\s)=(\s*")/g, fixSingleEquals);   // = "string"
      line = line.replace(/(\s)=(\s*\$)/g, fixSingleEquals);  // = $variable
      line = line.replace(/(\s)=(\s*\d)/g, fixSingleEquals);  // = number

      // Also handle field=value without spaces
      line = line.replace(
        /([a-zA-Z_][\w.]*)=(")/g,
        (_m, field: string, quote: string) => `${field}==${quote}`,
      );

      fixedLines.push(line);
    }

    return fixedLines.join('\n');
  }

  /**
   * DQL uses lowercase and/or.
   */
  private fixLogicalOperators(dql: string): string {
    // AND -> and
    if (/\bAND\b/.test(dql)) {
      dql = dql.replace(/\bAND\b/g, 'and');
      this.fixes.push("Changed 'AND' to 'and'");
    }

    // OR -> or
    if (/\bOR\b/.test(dql)) {
      dql = dql.replace(/\bOR\b/g, 'or');
      this.fixes.push("Changed 'OR' to 'or'");
    }

    // NOT -> not (but be careful with isNotNull)
    if (/\bNOT\b(?!\s*[Nn]ull)/.test(dql)) {
      dql = dql.replace(/\bNOT\b(?!\s*[Nn]ull)/g, 'not');
      this.fixes.push("Changed 'NOT' to 'not'");
    }

    return dql;
  }

  /**
   * Fix NULL check syntax.
   */
  private fixNullChecks(dql: string): string {
    // IS NOT NULL -> isNotNull(field)
    if (/(`[^`]+`|[\w.-]+)\s+IS\s+NOT\s+NULL/i.test(dql)) {
      dql = dql.replace(
        /(`[^`]+`|[\w.-]+)\s+IS\s+NOT\s+NULL/gi,
        (_m, field: string) => `isNotNull(${field.replace(/`/g, '')})`,
      );
      this.fixes.push("Changed 'IS NOT NULL' to 'isNotNull()'");
    }

    // IS NULL -> isNull(field)
    if (/(`[^`]+`|[\w.-]+)\s+IS\s+NULL\b/i.test(dql)) {
      dql = dql.replace(
        /(`[^`]+`|[\w.-]+)\s+IS\s+NULL\b/gi,
        (_m, field: string) => `isNull(${field.replace(/`/g, '')})`,
      );
      this.fixes.push("Changed 'IS NULL' to 'isNull()'");
    }

    return dql;
  }

  /**
   * Convert LIKE patterns to DQL functions.
   */
  private fixLikePatterns(dql: string): string {
    // LIKE '%value%' -> contains("value")
    dql = dql.replace(
      /([\w][\w.]*)\s+LIKE\s+['"]([^'"]+)['"]/gi,
      (_match, field: string, pattern: string) => {
        const startsWithWildcard = pattern.startsWith('%');
        const endsWithWildcard = pattern.endsWith('%');
        const value = pattern.replace(/^%|%$/g, '');

        if (startsWithWildcard && endsWithWildcard) {
          this.fixes.push(`Changed '${field} LIKE' to 'contains()'`);
          return `contains(${field}, "${value}")`;
        } else if (startsWithWildcard) {
          this.fixes.push(`Changed '${field} LIKE' to 'endsWith()'`);
          return `endsWith(${field}, "${value}")`;
        } else if (endsWithWildcard) {
          this.fixes.push(`Changed '${field} LIKE' to 'startsWith()'`);
          return `startsWith(${field}, "${value}")`;
        } else {
          this.fixes.push(`Changed '${field} LIKE' to '=='`);
          return `${field} == "${value}"`;
        }
      },
    );

    // NOT LIKE -> not(contains(field, "value"))
    dql = dql.replace(
      /([\w][\w.]*)\s+NOT\s+LIKE\s+['"]([^'"]+)['"]/gi,
      (_match, field: string, pattern: string) => {
        const value = pattern.replace(/^%|%$/g, '');
        this.fixes.push(`Changed '${field} NOT LIKE' to 'not(contains())'`);
        return `not(contains(${field}, "${value}"))`;
      },
    );

    return dql;
  }

  /**
   * Fix 'where' keyword inside filter clauses - should be 'and'.
   */
  private fixWhereInFilter(dql: string): string {
    const lines = dql.split('\n');
    const fixedLines: string[] = [];

    for (const line of lines) {
      if (
        line.toLowerCase().includes('| filter') ||
        line.trim().toLowerCase().startsWith('filter')
      ) {
        // Replace 'where' with 'and' but preserve strings
        const result: string[] = [];
        let inString = false;
        let quoteChar = '';
        let i = 0;
        const lineLower = line.toLowerCase();

        while (i < line.length) {
          // Track string boundaries
          const ch = line[i] as string;
          if (ch === '"' || ch === "'") {
            if (!inString) {
              inString = true;
              quoteChar = ch;
            } else if (ch === quoteChar) {
              inString = false;
            }
            result.push(ch);
            i++;
          } else if (!inString && lineLower.slice(i, i + 5) === 'where') {
            result.push('and');
            i += 5;
            this.fixes.push("Changed 'where' to 'and' in filter clause");
          } else {
            result.push(ch);
            i++;
          }
        }

        fixedLines.push(result.join(''));
      } else {
        fixedLines.push(line);
      }
    }

    return fixedLines.join('\n');
  }

  /**
   * Fix timeseries count() - this is the most critical fix.
   * timeseries requires a metric key, count() alone is invalid.
   * NOTE: Don't match makeTimeseries which is valid!
   */
  private fixTimeseriesCount(dql: string, context = ''): string {
    // Check for standalone timeseries count() (not makeTimeseries)
    if (/(?<!make)timeseries\s+count\(\s*\)/i.test(dql)) {
      this.fixes.push("Converted invalid 'timeseries count()' to 'fetch + summarize'");
      dql = this.convertTimeseriesCountToFetch(dql, context);
    }
    return dql;
  }

  /**
   * Convert timeseries count() to proper fetch + summarize.
   */
  private convertTimeseriesCountToFetch(dql: string, context = ''): string {
    // Extract any existing clauses
    const byMatch = /,\s*by:\s*\{([^}]*)\}/.exec(dql);
    const filterMatch = /,\s*filter:\s*(.+?)(?:,\s*by:|$)/.exec(dql);

    const byClause = byMatch?.[1]?.trim() ?? '';
    const filterClause = filterMatch?.[1]?.trim().replace(/,$/, '') ?? '';

    // Determine data source from context
    const contextLower = context.toLowerCase();
    let source: string;
    if (contextLower.includes('log')) {
      source = 'logs';
    } else if (
      contextLower.includes('synthetic') ||
      contextLower.includes('monitor')
    ) {
      source = 'dt.synthetic.http.request';
    } else if (contextLower.includes('error')) {
      source = 'spans';
    } else {
      source = 'spans';
    }

    // Build new query
    const parts: string[] = [`fetch ${source}`];

    if (filterClause) {
      parts.push(`filter ${filterClause}`);
    }

    if (byClause) {
      parts.push(`summarize count(), by: {${byClause}}`);
    } else {
      parts.push('summarize count()');
    }

    return parts.join('\n| ');
  }

  /**
   * Fix invalid or unsupported functions.
   */
  private fixInvalidFunctions(dql: string): string {
    // uniqueCount -> countDistinct
    if (/uniqueCount\(/i.test(dql)) {
      dql = dql.replace(/uniqueCount\(/gi, 'countDistinct(');
      this.fixes.push("Changed 'uniqueCount()' to 'countDistinct()'");
    }

    // average -> avg
    if (/\baverage\(/i.test(dql)) {
      dql = dql.replace(/\baverage\(/gi, 'avg(');
      this.fixes.push("Changed 'average()' to 'avg()'");
    }

    // latest -> takeAny
    if (dql.includes('latest(')) {
      dql = dql.replace(/latest\(/gi, 'takeAny(');
      this.fixes.push("Changed 'latest()' to 'takeAny()'");
    }

    // Handle clamp_max/clamp_min
    if (/clamp_max\(/i.test(dql) || /clamp_min\(/i.test(dql)) {
      if (!dql.toLowerCase().includes('// note: clamp')) {
        dql = '// NOTE: clamp_max/clamp_min converted to if() - verify logic\n' + dql;
        this.fixes.push('Added note about clamp function conversion');
      }
    }

    // Handle histogram
    const histogramMatch = /\bhistogram\s*\(\s*([^,]+)(?:\s*,\s*(\d+(?:\.\d+)?)(?:\s*,\s*(\d+(?:\.\d+)?)(?:\s*,\s*(\d+(?:\.\d+)?))?)?)?\s*\)/i.exec(dql);
    if (histogramMatch) {
      let field = (histogramMatch[1] ?? '').trim();
      if (field === 'duration.ms') {
        field = 'duration';
      }

      // Calculate bin width
      const ceiling = histogramMatch[2] as string | undefined;
      const numBars = histogramMatch[3] as string | undefined;
      const explicitW = histogramMatch[4] as string | undefined;
      let binW: number;
      if (explicitW) {
        binW = Math.trunc(parseFloat(explicitW));
      } else if (ceiling && numBars) {
        binW = Math.trunc(parseFloat(ceiling) / parseFloat(numBars));
      } else {
        binW = 1000;
      }

      // Use DQL duration literal for duration field
      const binExpr = field === 'duration' ? msToDqlDuration(binW) : String(binW);

      // Replace histogram() call
      dql = dql.replace(
        /\bhistogram\s*\(\s*[^)]+\)/i,
        `count(), by: {bin(${field}, ${binExpr})}`,
      );

      if (!dql.toLowerCase().includes('// note: histogram')) {
        this.fixes.push('histogram() -> count() + bin() for categoricalBarChart');
      }
    }

    // Handle cdfPercentage
    if (/cdfpercentage\(/i.test(dql)) {
      if (!dql.includes('// NOTE: cdfPercentage')) {
        dql = '// NOTE: cdfPercentage() not available in DQL\n' + dql;
        this.fixes.push('Added note about cdfPercentage not available');
      }
    }

    // Handle percentage()
    if (/percentage\(/i.test(dql)) {
      if (!dql.includes('// NOTE: percentage()')) {
        dql =
          '// NOTE: NR percentage() function needs manual conversion in DQL\n// Use: (countIf(condition) / count()) * 100\n' +
          dql;
        this.fixes.push('Added note about percentage() needing manual conversion');
      }
    }

    return dql;
  }

  /**
   * Fix broken by: clauses that have WHERE mixed in.
   */
  private fixBrokenByClause(dql: string): string {
    const match = /by:\s*\{([^}]*)\s+WHERE\s+[^}]*\}/i.exec(dql);
    if (match) {
      const fieldsPart = (match[1] ?? '').trim();
      const oldBy = match[0];
      const newBy = `by: {${fieldsPart}}`;
      dql = dql.replace(oldBy, newBy);
      this.fixes.push('Removed invalid WHERE from by: clause');
    }
    return dql;
  }

  /**
   * Fix common field name issues.
   */
  private fixFieldNames(dql: string): string {
    // Fields with hyphens need backticks in DQL
    // For safety, just note potential issues (same as Python)
    return dql;
  }

  /**
   * Fix duplicate aggregation functions like count(), count(), count().
   */
  private fixDuplicateAggregations(dql: string): string {
    for (const cmd of ['makeTimeseries', 'summarize']) {
      const pattern = new RegExp(
        `(${cmd}\\s+)(.*?)(\\s*,\\s*by:\\s*\\{|$)`,
        'is',
      );
      const match = pattern.exec(dql);
      if (!match) continue;

      const prefix = match[1] ?? '';
      const aggSection = (match[2] ?? '').trim();
      const suffix = match[3] ?? '';

      // Split aggregations on commas (but not commas inside parentheses)
      const aggs = splitOnCommas(aggSection);
      if (aggs.length <= 1) continue;

      // Deduplicate: keep unique aggregations only
      const seen = new Map<string, string>();
      const uniqueAggs: string[] = [];
      for (const agg of aggs) {
        // Normalize for comparison: strip alias prefix
        const normalized = agg.replace(/^\w+\s*=\s*/, '').trim().toLowerCase();
        if (!seen.has(normalized)) {
          seen.set(normalized, agg);
          uniqueAggs.push(agg);
        }
      }

      if (uniqueAggs.length < aggs.length) {
        const removed = aggs.length - uniqueAggs.length;
        dql =
          dql.slice(0, match.index) +
          prefix +
          uniqueAggs.join(', ') +
          suffix +
          dql.slice(match.index + match[0].length);
        this.fixes.push(`Removed ${removed} duplicate aggregation(s)`);
      }
    }

    return dql;
  }

  /**
   * Fix unnamed percentile() in makeTimeseries/summarize.
   *
   * DQL requires named aggregations when percentile has a second argument,
   * because the comma is ambiguous to the parser.
   *
   * BAD:  makeTimeseries percentile(duration, 99), by: {...}
   * GOOD: makeTimeseries p99=percentile(duration, 99), by: {...}
   */
  private fixPercentileNaming(dql: string): string {
    // Only process if there's a percentile in a makeTimeseries/summarize context
    let hasContext = false;
    for (const cmd of ['makeTimeseries', 'summarize']) {
      if (dql.toLowerCase().includes(cmd.toLowerCase()) && dql.toLowerCase().includes('percentile(')) {
        hasContext = true;
        break;
      }
    }
    if (!hasContext) return dql;

    // Match percentile(field, N) -- check for existing alias
    const pattern = /percentile\s*\(\s*([^,)]+?)\s*,\s*(\d+)\s*\)/g;

    const newDql = dql.replace(pattern, (full, field: string, pct: string, offset: number) => {
      // Check if already named: look for "alias=" immediately before
      const prefixSlice = dql.slice(Math.max(0, offset - 30), offset);
      if (/\w+\s*=\s*$/.test(prefixSlice)) {
        return full; // Already named, don't touch
      }
      return `p${pct}=percentile(${field.trim()}, ${pct})`;
    });

    if (newDql !== dql) {
      this.fixes.push('Named percentile aggregation (DQL requires alias for positional params)');
      dql = newDql;
    }

    // Defensive: clean up any double-alias like "p95=p95=expr" -> "p95=expr"
    dql = dql.replace(/(\b\w+)=\1=/g, '$1=');

    // Sanitize numeric-leading aliases: 95th=expr -> _95th=expr
    dql = dql.replace(/(?<=[\s,])(\d+\w*)=(?!=)/g, '_$1=');

    return dql;
  }

  /**
   * Fix 'expression as alias' syntax in by: clauses.
   *
   * DQL uses 'alias=expression' not 'expression as alias'.
   */
  private fixAsAliases(dql: string): string {
    const byPattern = /(by:\s*\{)(.*?)(\})/gs;

    dql = dql.replace(byPattern, (fullMatch, prefix: string, content: string, suffix: string) => {
      if (!content.toLowerCase().includes(' as ')) {
        return fullMatch;
      }

      // Split on commas respecting parentheses depth
      const parts = splitOnCommas(content);

      const fixedParts: string[] = [];
      let changed = false;
      for (const part of parts) {
        const asMatch = /^(.+?)\s+[Aa][Ss]\s+"?(\w+)"?$/.exec(part.trim());
        if (asMatch) {
          const expr = (asMatch[1] ?? '').trim();
          const alias = (asMatch[2] ?? '').trim();
          fixedParts.push(`${alias}=${expr}`);
          changed = true;
        } else {
          fixedParts.push(part);
        }
      }

      if (changed) {
        this.fixes.push("Converted 'expr as alias' to 'alias=expr' in by: clause");
        return prefix + fixedParts.join(', ') + suffix;
      }

      return fullMatch;
    });

    return dql;
  }

  /**
   * Fix bare fields in summarize/makeTimeseries that aren't aggregations.
   *
   * BAD:  summarize duration
   * GOOD: summarize avg(duration)
   *
   * Also handles: summarize takeLast(field) -> summarize avg(field)
   * (takeLast is not a valid DQL aggregation for summarize/makeTimeseries)
   */
  private fixBareFieldInSummarize(dql: string): string {
    const validAggs = new Set([
      'count', 'sum', 'avg', 'min', 'max', 'percentile', 'median',
      'countif', 'sumif', 'avgif', 'countdistinct', 'collectarray',
      'collectdistinct', 'takefirst', 'takelast', 'takeany', 'stdev',
      'variance', 'delta', 'rate',
    ]);
    const invalidTsAggs = new Set([
      'takelast', 'takefirst', 'takeany', 'collectarray', 'collectdistinct',
    ]);

    for (const cmd of ['makeTimeseries', 'summarize']) {
      const pattern = new RegExp(
        `(\\|\\s*${cmd}\\s+)(.*?)(\\s*(?:,\\s*by:|$))`,
        'is',
      );
      const match = pattern.exec(dql);
      if (!match) continue;

      const prefix = match[1] ?? '';
      const aggSection = (match[2] ?? '').trim();
      const suffix = match[3] ?? '';

      // Parse individual aggregation expressions
      const parts = splitOnCommas(aggSection);

      const fixedParts: string[] = [];
      let changed = false;
      for (let part of parts) {
        // Check if this part starts with a known aggregation
        let funcMatch = /^(\w+)\s*=\s*(\w+)\s*\(/.exec(part);
        if (!funcMatch) {
          funcMatch = /^(\w+)\s*\(/.exec(part);
        }

        if (funcMatch) {
          const funcName = (funcMatch[funcMatch.length === 3 ? 2 : 1] ?? '').toLowerCase();
          // Fix invalid timeseries aggs
          if (cmd.toLowerCase() === 'maketimeseries' && invalidTsAggs.has(funcName)) {
            part = part.replace(new RegExp(`\\b${funcName}\\s*\\(`, 'i'), 'avg(');
            this.fixes.push(`${funcName}() -> avg() (not valid in makeTimeseries)`);
            changed = true;
          } else if (validAggs.has(funcName)) {
            // Valid, keep as is
          } else {
            // Unknown function -- might be OK, leave it
          }
        } else {
          // Bare field name with no aggregation -- wrap in avg()
          const aliasMatch = /^(\w+)\s*=\s*(.+)/.exec(part);
          if (aliasMatch) {
            const alias = aliasMatch[1] ?? '';
            const field = (aliasMatch[2] ?? '').trim();
            part = `${alias}=avg(${field})`;
          } else {
            part = `avg(${part})`;
          }
          this.fixes.push(`Wrapped bare field '${part}' in avg() for ${cmd}`);
          changed = true;
        }

        fixedParts.push(part);
      }

      if (changed) {
        const newAggSection = fixedParts.join(', ');
        dql =
          dql.slice(0, match.index) +
          prefix +
          newAggSection +
          suffix +
          dql.slice(match.index + match[0].length);
      }
    }

    return dql;
  }

  /**
   * Fix NRQL subqueries that were passed through literally.
   *
   * BAD:  filter ... and in(trace.id, FROM Span SELECT trace.id and ...)
   * GOOD: lookup [fetch spans | filter ...] joined on trace.id
   */
  private fixNrqlSubqueries(dql: string): string {
    // Check if there's even a subquery remnant (non-comment lines only)
    const codeLines = dql
      .split('\n')
      .filter((l) => !l.trim().startsWith('//'));
    const code = codeLines.join('\n');
    if (!code.includes('FROM ') && !code.includes('SELECT ')) {
      return dql;
    }

    const sourceMap: Record<string, string> = {
      Span: 'spans',
      Transaction: 'spans',
      Log: 'logs',
      SystemSample: 'dt.entity.host',
    };

    const convertSubquery = (
      field: string,
      sourceType: string,
      selectField: string,
      conditions: string,
    ): string => {
      const dtSource = sourceMap[sourceType] ?? 'spans';

      let subFilter = '';
      if (conditions) {
        let w = conditions;
        w = w.replace(/(\w)\s*=\s*(?!=)/g, '$1 == ');
        w = w.replace(/\bAND\b/gi, 'and');
        w = w.replace(/\bappName\b/g, 'service.name');
        subFilter = ` | filter ${w}`;
      }

      const lookupDql =
        `lookup [fetch ${dtSource}${subFilter} ` +
        `| fields ${selectField}], ` +
        `sourceField:${field}, lookupField:${selectField}, prefix:"sub."`;

      this.fixes.push(`Converted NRQL subquery to DQL lookup on ${field}`);
      return lookupDql;
    };

    // Pattern: in(field, FROM Type SELECT field and/WHERE conditions)
    const pattern1 =
      /in\s*\(\s*(\w[\w.]*)\s*,\s*FROM\s+(\w+)\s+SELECT\s+(\w[\w.]*)(?:\s+(?:WHERE|and)\s+(.+?))?\s*\)/gis;
    // Pattern: field in (FROM Type SELECT field and/WHERE conditions)
    const pattern2 =
      /(\w[\w.]*)\s+in\s*\(\s*FROM\s+(\w+)\s+SELECT\s+(\w[\w.]*)(?:\s+(?:WHERE|and)\s+(.+?))?\s*\)/gis;

    let newDql = dql;
    newDql = newDql.replace(pattern1, (_m, field, sourceType, selectField, conditions) =>
      convertSubquery(field, sourceType, selectField, conditions ?? ''),
    );
    newDql = newDql.replace(pattern2, (_m, field, sourceType, selectField, conditions) =>
      convertSubquery(field, sourceType, selectField, conditions ?? ''),
    );

    if (newDql !== dql) {
      // Restructure: lookup can't be inside a filter -- move to separate pipeline step
      const lines = newDql.split('\n');
      const fixedLines: string[] = [];
      for (const line of lines) {
        const stripped = line.trim();
        if (
          stripped.includes('lookup [') &&
          (stripped.includes('| filter') || stripped.startsWith('filter'))
        ) {
          const lookupMatch =
            /(lookup\s+\[fetch\s+.+?\]\s*,\s*sourceField:\s*([\w][\w.]*)\s*,\s*lookupField:\s*[\w][\w.]*\s*,\s*prefix:\s*"(\w+)\.?")/.exec(
              stripped,
            );
          if (lookupMatch) {
            const lookupStmt = lookupMatch[1] ?? '';
            const sourceField = lookupMatch[2] ?? '';
            const prefix = lookupMatch[3] ?? '';

            // Remove the lookup from the filter
            let filterClean = stripped.slice(0, lookupMatch.index).trimEnd();
            // Clean trailing 'and'
            filterClean = filterClean.replace(/\s+and\s*$/, '');

            if (filterClean.trim()) {
              fixedLines.push(filterClean);
            }
            fixedLines.push(`| ${lookupStmt}`);
            fixedLines.push(`| filter isNotNull(${prefix}.${sourceField})`);
          } else {
            fixedLines.push(line);
          }
        } else {
          fixedLines.push(line);
        }
      }

      newDql = fixedLines.join('\n');
    }

    return newDql;
  }

  /**
   * Fix metric names with colons that get misinterpreted as parameters.
   */
  private fixMetricNames(dql: string): string {
    // Match unquoted metric names with colons in aggregation functions
    dql = dql.replace(
      /\b(max|min|avg|sum|count)\(\s*(builtin:[a-zA-Z0-9_.]+)/g,
      (_match, func: string, metric: string) => {
        this.fixes.push(`Quoted metric name: ${metric}`);
        return `${func}("${metric}"`;
      },
    );
    return dql;
  }

  /**
   * Fix common duration unit mistakes in DQL.
   *
   * DQL durations in Dynatrace are often nanoseconds, not milliseconds.
   * resolved_problem_duration is in nanoseconds -- dividing by 1000 gives
   * microseconds, not seconds.
   */
  private fixDurationUnits(dql: string): string {
    if (dql.includes('resolved_problem_duration')) {
      if (/resolved_problem_duration\s*\/\s*1000(?!\d)/.test(dql)) {
        dql = dql.replace(
          /(resolved_problem_duration\s*\/\s*)1000(?!\d)/,
          '$11000000000',
        );
        this.fixes.push(
          'Fixed duration divisor: resolved_problem_duration is in nanoseconds, not milliseconds (÷1B for seconds)',
        );
      }
    }
    return dql;
  }

  /**
   * Suggest filterOut instead of filter not for better performance.
   *
   * DQL anti-pattern: `filter not <condition>` is slower than `filterOut <condition>`.
   * Only add a comment hint, don't change semantics.
   */
  private fixNegationToFilterout(dql: string): string {
    if (/\|\s*filter\s+not\s*\(/i.test(dql)) {
      if (!dql.includes('// PERF:')) {
        dql = dql.replace(
          /(\|\s*filter\s+not\s*\()/i,
          '// PERF: Consider using filterOut instead of filter not() for better performance\n$1',
        );
        this.fixes.push('Added performance hint: filterOut is faster than filter not()');
      }
    }
    return dql;
  }

  /**
   * Warn when counting array fields without expanding first.
   *
   * Common DQL mistake: summarize by:{array_field}, count = count()
   * without expanding the array first gives wrong results.
   */
  private fixArrayCountWithoutExpand(dql: string): string {
    const arrayFields = [
      'affected_entity_ids',
      'affected_entities',
      'tags',
      'management_zones',
      'entity.detected_name',
    ];

    for (const field of arrayFields) {
      if (!dql.includes(field)) continue;

      // Check if it's used in summarize/by without a prior expand
      const escapedField = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const summPattern = new RegExp(
        `summarize\\b.*\\bby:\\s*\\{[^}]*${escapedField}`,
      );
      if (summPattern.test(dql)) {
        if (!dql.includes(`expand ${field}`)) {
          if (!dql.includes(`// NOTE: expand ${field}`)) {
            dql = dql.replace(
              new RegExp(
                `(\\|\\s*summarize\\b.*\\bby:\\s*\\{[^}]*${escapedField})`,
              ),
              `// NOTE: expand ${field} before summarize for correct counts\n$1`,
            );
            this.fixes.push(`Added note: '${field}' should be expanded before summarize`);
          }
        }
      }
    }

    return dql;
  }

  /**
   * Clean up whitespace issues.
   */
  private fixWhitespace(dql: string): string {
    // Remove trailing whitespace from lines
    let lines = dql.split('\n').map((l) => l.trimEnd());

    // Remove empty lines at start/end
    while (lines.length > 0 && (lines[0] ?? '').trim() === '') {
      lines.shift();
    }
    while (lines.length > 0 && (lines[lines.length - 1] ?? '').trim() === '') {
      lines.pop();
    }

    let result = lines.join('\n');

    // Fix double pipes (| |) - often caused by joining issues
    result = result.replace(/\|\s*\|/g, '|');

    // Fix pipe at start of line following another pipe
    result = result.replace(/\|\s*\n\s*\|/g, '\n|');

    return result;
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Split a string on commas, respecting parentheses / braces / brackets depth.
 */
function splitOnCommas(input: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';

  for (const ch of input) {
    if (ch === '(' || ch === '{' || ch === '[') {
      depth++;
      current += ch;
    } else if (ch === ')' || ch === '}' || ch === ']') {
      depth--;
      current += ch;
    } else if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }

  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts;
}
