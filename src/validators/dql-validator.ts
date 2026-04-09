/**
 * DQL Syntax Validator.
 *
 * Validates DQL syntax based on Dynatrace's DQL grammar rules.
 * Catches common NRQL->DQL conversion errors BEFORE upload.
 */

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface DQLValidationError {
  readonly line: number;
  readonly column: number;
  readonly message: string;
  readonly severity: 'ERROR' | 'WARNING';
}

export interface DQLValidationResult {
  readonly valid: boolean;
  readonly errors: readonly DQLValidationError[];
  readonly query: string;
}

// ---------------------------------------------------------------------------
// Pattern tuples
// ---------------------------------------------------------------------------

type PatternEntry = readonly [pattern: string, message: string];

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

export class DQLSyntaxValidator {
  /**
   * Case-INSENSITIVE patterns (things that are wrong regardless of case).
   */
  private static readonly INVALID_PATTERNS_ICASE: readonly PatternEntry[] = [
    // Single = for comparison (should be ==)
    [String.raw`(?<![=!<>])\s*=\s*(?![=])"`, "Single '=' used for comparison -- use '==' instead"],
    [String.raw`(?<![=!<>])\s*=\s*(?![=])\d`, "Single '=' used for comparison -- use '==' instead"],
    [String.raw`(?<![=!<>])\s*=\s*(?![=])\$`, "Single '=' used for comparison -- use '==' instead"],

    // !== is not valid DQL (should be !=)
    [String.raw`!==`, "'!==' is not valid in DQL -- use '!=' instead"],

    // Single quotes for strings (should be double quotes)
    [String.raw`==\s*'[^']*'`, "Single quotes used for string -- use double quotes in DQL"],

    // LIKE keyword
    [String.raw`\bLIKE\b`, "'LIKE' is not valid in DQL -- use contains(), startsWith(), or endsWith()"],

    // <> for not equal
    [String.raw`<>`, "'<>' should be '!=' in DQL"],

    // Double pipes
    [String.raw`\|\|`, "'||' is not valid in DQL -- use 'or' for logical OR"],

    // Semicolons
    [String.raw`;(?!\s*$)`, "Semicolons are not used in DQL"],

    // NR-specific functions
    [String.raw`\bpercentage\s*\(`, "'percentage()' is not a valid DQL function -- use countIf()/count()"],
    [String.raw`countIf\s*\([^)]*countIf\s*\(`, "Nested aggregation: countIf() inside countIf() -- DQL error NO_NESTED_AGGREGATIONS"],
    [String.raw`countIf\s*\([^)]*\bcount\s*\(`, "Nested aggregation: count() inside countIf() -- DQL error NO_NESTED_AGGREGATIONS"],
    [String.raw`\bsum\s*\([^)]*\bavg\s*\(`, "Nested aggregation: avg() inside sum() -- DQL error NO_NESTED_AGGREGATIONS"],
    [String.raw`\bmax\s*\([^)]*\bcount\s*\(`, "Nested aggregation: count() inside max() -- DQL error NO_NESTED_AGGREGATIONS"],
    [String.raw`\buniqueCount\s*\(`, "'uniqueCount()' should be 'countDistinct()' in DQL"],
    [String.raw`\bfunnel\s*\(`, "'funnel()' is not available in DQL"],

    // Malformed contains/startsWith/endsWith
    [String.raw`\bnot\s+contains\s*\(`, "'not contains()' is invalid -- use 'not(contains(field, value))'"],
    [String.raw`\bcontains\s*\(\s*not\s*,`, "'contains(not, ...)' is invalid -- use 'not(contains(field, value))'"],
    [String.raw`\bnot\s+startsWith\s*\(`, "'not startsWith()' is invalid -- use 'not(startsWith(field, value))'"],
    [String.raw`\bnot\s+endsWith\s*\(`, "'not endsWith()' is invalid -- use 'not(endsWith(field, value))'"],

    // takeLast/takeFirst in timeseries/makeTimeseries (only valid in summarize)
    [String.raw`(?:make)?[Tt]imeseries\s+.*\btakeLast\s*\(`, "'takeLast()' is not valid in timeseries/makeTimeseries -- use avg(), max(), or sum()"],
    [String.raw`(?:make)?[Tt]imeseries\s+.*\btakeFirst\s*\(`, "'takeFirst()' is not valid in timeseries/makeTimeseries -- use avg(), max(), or sum()"],
    [String.raw`(?:make)?[Tt]imeseries\s+.*\btakeAny\s*\(`, "'takeAny()' is not valid in timeseries/makeTimeseries -- use avg(), max(), or sum()"],
  ];

  /**
   * Case-SENSITIVE patterns (where case matters).
   */
  private static readonly INVALID_PATTERNS_CASE: readonly PatternEntry[] = [
    // WHERE keyword (uppercase only)
    [String.raw`\bWHERE\b`, "'WHERE' is not valid in DQL -- use 'filter' instead"],

    // AND/OR uppercase (lowercase is correct)
    [String.raw`\bAND\b`, "'AND' should be lowercase 'and' in DQL"],
    [String.raw`\bOR\b`, "'OR' should be lowercase 'or' in DQL"],
    [String.raw`\bNOT\b`, "'NOT' should be lowercase 'not' in DQL"],

    // IS NULL uppercase
    [String.raw`\bIS\s+NULL\b`, "'IS NULL' should be 'isNull(field)' in DQL"],
    [String.raw`\bIS\s+NOT\s+NULL\b`, "'IS NOT NULL' should be 'isNotNull(field)' in DQL"],

    // FACET keyword
    [String.raw`\bFACET\b`, "'FACET' is not valid in DQL -- use 'by: {field}' instead"],

    // SELECT keyword
    [String.raw`\bSELECT\b`, "'SELECT' is not valid in DQL"],

    // FROM keyword (uppercase)
    [String.raw`\bFROM\b`, "'FROM' is not valid in DQL -- use 'fetch <type>'"],

    // SINCE/UNTIL keywords
    [String.raw`\bSINCE\b`, "'SINCE' is not valid in DQL -- use from: parameter"],
    [String.raw`\bUNTIL\b`, "'UNTIL' is not valid in DQL -- use to: parameter"],
  ];

  /**
   * Validate a DQL query and return detailed results.
   */
  validate(dql: string): DQLValidationResult {
    const errors: DQLValidationError[] = [];

    // Skip validation for comment-only or empty queries
    const lines = dql.trim().split('\n');
    const nonCommentLines = lines.filter(
      (l) => l.trim() !== '' && !l.trim().startsWith('//'),
    );

    if (nonCommentLines.length === 0) {
      return { valid: true, errors: [], query: dql };
    }

    const dqlOnly = nonCommentLines.join('\n');

    // Check case-insensitive patterns
    for (const [pattern, message] of DQLSyntaxValidator.INVALID_PATTERNS_ICASE) {
      try {
        const re = new RegExp(pattern, 'gi');
        let match: RegExpExecArray | null;
        while ((match = re.exec(dqlOnly)) !== null) {
          const [lineNum, col] = this.getPosition(dqlOnly, match.index);
          errors.push({ line: lineNum, column: col, message, severity: 'ERROR' });
        }
      } catch {
        // Invalid regex — skip
        continue;
      }
    }

    // Check case-sensitive patterns (NO 'i' flag)
    for (const [pattern, message] of DQLSyntaxValidator.INVALID_PATTERNS_CASE) {
      try {
        const re = new RegExp(pattern, 'g');
        let match: RegExpExecArray | null;
        while ((match = re.exec(dqlOnly)) !== null) {
          const [lineNum, col] = this.getPosition(dqlOnly, match.index);
          errors.push({ line: lineNum, column: col, message, severity: 'ERROR' });
        }
      } catch {
        continue;
      }
    }

    // Check balanced parentheses
    const parenError = this.checkBalancedParens(dqlOnly);
    if (parenError) {
      errors.push(parenError);
    }

    // Check balanced braces
    const braceError = this.checkBalancedBraces(dqlOnly);
    if (braceError) {
      errors.push(braceError);
    }

    // Check first command
    const firstCmdError = this.checkFirstCommand(dqlOnly);
    if (firstCmdError) {
      errors.push(firstCmdError);
    }

    // Check performance anti-patterns (warnings, not errors)
    const antiPatternWarnings = this.checkAntiPatterns(dqlOnly);
    errors.push(...antiPatternWarnings);

    return {
      valid: errors.filter((e) => e.severity === 'ERROR').length === 0,
      errors,
      query: dql,
    };
  }

  /**
   * Get line number and column from character index.
   */
  private getPosition(text: string, index: number): [line: number, column: number] {
    const before = text.slice(0, index).split('\n');
    const lineNum = before.length;
    const col = (before[before.length - 1]?.length ?? 0) + 1;
    return [lineNum, col];
  }

  /**
   * Check for balanced parentheses.
   */
  private checkBalancedParens(dql: string): DQLValidationError | undefined {
    let count = 0;
    for (let i = 0; i < dql.length; i++) {
      if (dql[i] === '(') {
        count++;
      } else if (dql[i] === ')') {
        count--;
        if (count < 0) {
          const [line, col] = this.getPosition(dql, i);
          return {
            line,
            column: col,
            message: "Unbalanced parentheses -- extra ')'",
            severity: 'ERROR',
          };
        }
      }
    }
    if (count > 0) {
      return {
        line: 1,
        column: 1,
        message: `Unbalanced parentheses -- missing ${count} closing ')'`,
        severity: 'ERROR',
      };
    }
    return undefined;
  }

  /**
   * Check for balanced braces.
   */
  private checkBalancedBraces(dql: string): DQLValidationError | undefined {
    let count = 0;
    for (let i = 0; i < dql.length; i++) {
      if (dql[i] === '{') {
        count++;
      } else if (dql[i] === '}') {
        count--;
        if (count < 0) {
          const [line, col] = this.getPosition(dql, i);
          return {
            line,
            column: col,
            message: "Unbalanced braces -- extra '}'",
            severity: 'ERROR',
          };
        }
      }
    }
    if (count > 0) {
      return {
        line: 1,
        column: 1,
        message: `Unbalanced braces -- missing ${count} closing '}'`,
        severity: 'ERROR',
      };
    }
    return undefined;
  }

  /**
   * Check that query starts with valid DQL command.
   */
  private checkFirstCommand(dql: string): DQLValidationError | undefined {
    const validStarts = new Set(['fetch', 'timeseries', 'data']);

    for (const line of dql.split('\n')) {
      const trimmed = line.trim();
      if (trimmed !== '' && !trimmed.startsWith('//')) {
        const firstWord = trimmed.split(/\s+/)[0]?.toLowerCase() ?? '';
        if (!validStarts.has(firstWord)) {
          return {
            line: 1,
            column: 1,
            message: `DQL must start with 'fetch', 'timeseries', or 'data', not '${firstWord}'`,
            severity: 'ERROR',
          };
        }
        break;
      }
    }
    return undefined;
  }

  /**
   * Check for DQL performance anti-patterns (emit warnings, not errors).
   *
   * Based on Dynatrace DQL best practices:
   * - Filter early, sort last, limit last
   * - Avoid sort before filter
   * - Avoid limit before summarize
   * - Avoid negation filters (prefer filterOut)
   */
  private checkAntiPatterns(dql: string): DQLValidationError[] {
    const warnings: DQLValidationError[] = [];
    const lines = dql.trim().split('\n');

    // Parse pipeline stages in order
    const stages: string[] = [];
    for (const line of lines) {
      const stripped = line.trim().replace(/^\|\s*/, '');
      if (stripped === '' || stripped.startsWith('//')) {
        continue;
      }
      const cmd = stripped.split(/\s+/)[0]?.toLowerCase() ?? '';
      stages.push(cmd);
    }

    // Anti-pattern: sort immediately after fetch (before filter)
    for (let i = 0; i < stages.length; i++) {
      if (stages[i] === 'sort' && i > 0) {
        const hasFilterBefore = stages
          .slice(0, i)
          .some((s) => ['filter', 'filterout', 'search'].includes(s));
        if (!hasFilterBefore && stages[0] === 'fetch') {
          warnings.push({
            line: 1,
            column: 1,
            message: "Performance: 'sort' before any filter -- filter first, sort last",
            severity: 'WARNING',
          });
        }
        break; // Only check first sort
      }
    }

    // Anti-pattern: limit before summarize
    let limitIdx: number | undefined;
    let summarizeIdx: number | undefined;
    for (let i = 0; i < stages.length; i++) {
      if (stages[i] === 'limit' && limitIdx === undefined) {
        limitIdx = i;
      }
      if (
        (stages[i] === 'summarize' || stages[i] === 'maketimeseries') &&
        summarizeIdx === undefined
      ) {
        summarizeIdx = i;
      }
    }

    if (
      limitIdx !== undefined &&
      summarizeIdx !== undefined &&
      limitIdx < summarizeIdx
    ) {
      warnings.push({
        line: 1,
        column: 1,
        message:
          "Performance: 'limit' before 'summarize' aggregates over a subset -- summarize first, limit last",
        severity: 'WARNING',
      });
    }

    return warnings;
  }
}
