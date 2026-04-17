/**
 * NRQL-to-DQL Compiler — Compiler orchestrator.
 *
 * Orchestrates: Lexer -> Parser -> DQLEmitter
 * Handles errors gracefully and provides diagnostic info.
 */

import type { Query } from './ast-nodes.js';
import { DEFAULT_METRIC_MAP } from './default-metric-map.js';
import { EXTENDED_METRIC_MAP } from './extended-metric-map.js';
import { DQLEmitter, type MetricResolver, type MetricTransform } from './emitter.js';
import { LexError, NRQLLexer } from './lexer.js';
import { NRQLParser, ParseError } from './parser.js';

export interface TranslationNotes {
  readonly dataSourceMapping: string[];
  readonly fieldExtraction: string[];
  readonly keyDifferences: string[];
  readonly performanceConsiderations: string[];
  readonly dataModelRequirements: string[];
  readonly testingRecommendations: string[];
}

export interface CompileResult {
  readonly success: boolean;
  readonly dql: string;
  readonly confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  readonly confidenceScore: number;
  readonly warnings: string[];
  readonly fixes: string[];
  readonly notes: TranslationNotes;
  readonly error: string;
  readonly ast: Query | undefined;
  readonly originalNrql: string;
}

export class NRQLCompiler {
  private readonly fieldMap: Record<string, string>;
  private readonly metricMap: Record<string, string>;
  private readonly metricTransforms: Record<string, MetricTransform>;
  private readonly metricResolver: MetricResolver | undefined;

  constructor(options?: {
    fieldMap?: Record<string, string>;
    metricMap?: Record<string, string>;
    metricTransforms?: Record<string, MetricTransform>;
    metricResolver?: MetricResolver;
  }) {
    this.fieldMap = options?.fieldMap ?? {};
    // Map merge order: EXTENDED < DEFAULT < caller overrides. EXTENDED is the
    // broader 232-entry back-port from the Python CLI reference table;
    // DEFAULT contains the explicitly-curated infra metrics we ship; caller
    // overrides always win.
    this.metricMap = {
      ...EXTENDED_METRIC_MAP,
      ...DEFAULT_METRIC_MAP,
      ...(options?.metricMap ?? {}),
    };
    this.metricTransforms = options?.metricTransforms ?? {};
    this.metricResolver = options?.metricResolver;
  }

  compile(nrql: string, _title = ''): CompileResult {
    const result: {
      success: boolean;
      dql: string;
      confidence: 'HIGH' | 'MEDIUM' | 'LOW';
      confidenceScore: number;
      warnings: string[];
      fixes: string[];
      notes: TranslationNotes;
      error: string;
      ast: Query | undefined;
      originalNrql: string;
    } = {
      success: false,
      dql: '',
      confidence: 'HIGH',
      confidenceScore: 100,
      warnings: [],
      fixes: [],
      notes: emptyNotes(),
      error: '',
      ast: undefined,
      originalNrql: nrql,
    };

    // Phase 0: Expand NR shorthand metrics before lexing
    nrql = NRQLCompiler.expandNrShorthands(nrql);

    // Phase 1: Lex
    let tokens;
    try {
      const lexer = new NRQLLexer(nrql);
      tokens = lexer.tokenize();
    } catch (e) {
      if (e instanceof LexError) {
        result.error = `Lexer error: ${e.message}`;
        return result;
      }
      throw e;
    }

    // Phase 2: Parse
    let ast: Query;
    try {
      const parser = new NRQLParser(tokens);
      ast = parser.parse();
      result.ast = ast;
    } catch (e) {
      if (e instanceof ParseError) {
        result.error = `Parse error: ${e.message}`;
        return result;
      }
      throw e;
    }

    // Phase 3: Emit DQL
    try {
      const emitter = new DQLEmitter(
        this.fieldMap,
        this.metricMap,
        this.metricTransforms,
        this.metricResolver,
      );
      let dql = emitter.emit(ast);
      // Collapse NRQL to single line so the comment never leaks raw code
      const nrqlOneline = nrql.split(/\s+/).join(' ').trim();
      result.dql = `// Original NRQL: ${nrqlOneline}\n${dql}`;
      result.warnings = emitter.warnings;
      result.success = true;
      result.confidence = 'HIGH';

      // Downgrade confidence if there are warnings
      if (result.warnings.some(w => w.includes('not directly supported'))) {
        result.confidence = 'MEDIUM';
      }
    } catch (e) {
      result.error = `Emitter error: ${e instanceof Error ? e.message : String(e)}`;
      return result;
    }

    // Phase 4: DQL Syntax Validation
    const [validatedDql, validationFixes] = this.validateDql(result.dql);
    result.dql = validatedDql;
    if (validationFixes.length > 0) {
      result.fixes = [...result.fixes, ...validationFixes];
    }

    // Phase 5: Compute TranslationNotes and confidence score
    result.notes = buildNotes(result.warnings, result.dql, ast);
    const { confidence, score } = computeConfidence(result.warnings, result.fixes);
    result.confidence = confidence;
    result.confidenceScore = score;

    // Phase 19: Positive-signal confidence uplift.
    // When the emitter successfully produced known rewrites for apdex /
    // COMPARE WITH / rate() / percentage(), a LOW/MEDIUM score is
    // usually wrong because the output is valid DQL. Raise (never
    // lower) the band to reflect that the signal was carried.
    applyPhase19Uplift(result, nrql);

    return result;
  }

  static expandNrShorthands(nrql: string): string {
    const shorthands: [RegExp, string][] = [
      [/\baverage[Dd]uration\b/g, 'average(duration)'],
      [/\baverage[Rr]esponse[Tt]ime\b/g, 'average(duration)'],
      [/\bmax[Dd]uration\b/g, 'max(duration)'],
      [/\bmin[Dd]uration\b/g, 'min(duration)'],
      [/\bmedian[Dd]uration\b/g, 'median(duration)'],
      [/\bapdex[Ss]core\b/g, 'apdex(duration)'],
      [/\bapdex[Pp]erf[Zz]one\b/g, 'apdex(duration)'],
      [/\berror[Rr]ate\b/g, 'percentage(count(*), WHERE error IS TRUE)'],
      [/\bthroughput\b/g, 'rate(count(*), 1 minute)'],
    ];

    for (const [pattern, replacement] of shorthands) {
      nrql = nrql.replace(pattern, replacement);
    }

    return nrql;
  }

  static msToDurationLiteral(ms: number): string {
    if (ms <= 0) return '0s';
    if (ms >= 86_400_000 && ms % 86_400_000 === 0) return `${ms / 86_400_000}d`;
    if (ms >= 3_600_000 && ms % 3_600_000 === 0) return `${ms / 3_600_000}h`;
    if (ms >= 60_000 && ms % 60_000 === 0) return `${ms / 60_000}m`;
    if (ms >= 1000 && ms % 1000 === 0) return `${ms / 1000}s`;
    if (ms === Math.floor(ms)) return `${ms}ms`;
    const us = ms * 1000;
    if (us === Math.floor(us)) return `${us}us`;
    return `${ms}ms`;
  }

  private validateDql(dql: string): [string, string[]] {
    const fixes: string[] = [];
    const lines = dql.split('\n');
    const newLines: string[] = [];

    const fullDql = lines.join('\n');
    const isSpanQuery = fullDql.includes('fetch spans');

    for (let line of lines) {
      const stripped = line.trim();

      // Skip comments
      if (stripped.startsWith('//')) {
        newLines.push(line);
        continue;
      }

      // Check 1: shift: on makeTimeseries (invalid)
      if (line.includes('| makeTimeseries') && line.includes('shift:')) {
        const fixed = line.replace(/,\s*shift:[^\s,]+/, '');
        if (fixed !== line) {
          fixes.push('Removed invalid shift: from makeTimeseries (only timeseries command supports shift:)');
          line = fixed;
        }
      }

      // Check 2: Bare fields in summarize/makeTimeseries
      const m = line.match(/^(\s*\|\s*(?:summarize|makeTimeseries)\s+)(.*)/);
      if (m) {
        const aggPart = m[2]!;
        if (aggPart && !/[a-zA-Z_]\w*\s*\(/.test(aggPart)) {
          const fields = aggPart.split(',');
          const fieldNames: string[] = [];
          for (const f of fields) {
            const trimmed = f.trim();
            if (!trimmed.startsWith('by:')) {
              fieldNames.push(trimmed);
            }
          }
          if (fieldNames.length > 0) {
            line = `| fields ${fieldNames.join(', ')}`;
            fixes.push(`Corrected bare fields in summarize -> | fields ('${fieldNames.join(', ')}' are not aggregations)`);
          }
        }
      }

      // Check 3: Duration unit conversion (NR ms -> DT duration literals)
      if (isSpanQuery) {
        line = line.replace(
          /(?<![.\w])duration\s*(>=|<=|>|<|==|!=)\s*(\d+(?:\.\d+)?)/g,
          (_match, op: string, valStr: string) => {
            const ms = parseFloat(valStr);
            const lit = NRQLCompiler.msToDurationLiteral(ms);
            fixes.push(`Duration: ${valStr}ms -> ${lit}`);
            return `duration ${op} ${lit}`;
          },
        );

        line = line.replace(
          /bin\(\s*duration\s*,\s*(\d+(?:\.\d+)?)\s*\)/g,
          (_match, valStr: string) => {
            const ms = parseFloat(valStr);
            const lit = NRQLCompiler.msToDurationLiteral(ms);
            fixes.push(`Duration bin: ${ms}ms -> ${lit}`);
            return `bin(duration, ${lit})`;
          },
        );
      }

      newLines.push(line);
    }

    return [newLines.join('\n'), fixes];
  }

  parseOnly(nrql: string): [Query | undefined, string] {
    try {
      const tokens = new NRQLLexer(nrql).tokenize();
      const ast = new NRQLParser(tokens).parse();
      return [ast, ''];
    } catch (e) {
      if (e instanceof LexError || e instanceof ParseError) {
        return [undefined, e.message];
      }
      throw e;
    }
  }
}

// -- Helper functions for TranslationNotes and confidence scoring --

function emptyNotes(): TranslationNotes {
  return {
    dataSourceMapping: [],
    fieldExtraction: [],
    keyDifferences: [],
    performanceConsiderations: [],
    dataModelRequirements: [],
    testingRecommendations: [],
  };
}

function buildNotes(warnings: string[], dql: string, ast: Query): TranslationNotes {
  const notes = emptyNotes();
  const mutableNotes = notes as {
    dataSourceMapping: string[];
    fieldExtraction: string[];
    keyDifferences: string[];
    performanceConsiderations: string[];
    dataModelRequirements: string[];
    testingRecommendations: string[];
  };

  // Data source mapping
  if (dql.includes('fetch spans')) {
    mutableNotes.dataSourceMapping.push('NR Transaction/Span -> DT Grail spans (distributed traces)');
  } else if (dql.includes('fetch logs')) {
    mutableNotes.dataSourceMapping.push('NR Log/LogEvent -> DT Grail logs');
  } else if (dql.includes('fetch bizevents')) {
    mutableNotes.dataSourceMapping.push('NR PageView/BrowserInteraction -> DT business events');
  } else if (dql.includes('fetch events')) {
    mutableNotes.dataSourceMapping.push('NR InfrastructureEvent -> DT events');
  } else if (dql.includes('timeseries')) {
    mutableNotes.dataSourceMapping.push('NR Metric/SystemSample -> DT metric timeseries');
  }

  // Key differences from warnings
  for (const w of warnings) {
    if (w.includes('rate()') || w.includes('not directly supported')) {
      mutableNotes.keyDifferences.push(w);
    } else if (w.includes('EXTRAPOLATE') || w.includes('full fidelity')) {
      mutableNotes.keyDifferences.push('DT stores full-fidelity data — no sampling/extrapolation needed');
    } else if (w.includes('COMPARE WITH')) {
      mutableNotes.keyDifferences.push(w);
    } else if (w.includes('apdex') || w.includes('decomposed')) {
      mutableNotes.keyDifferences.push(w);
    } else if (w.includes('Unknown metric') || w.includes('no METRIC_MAP')) {
      mutableNotes.dataModelRequirements.push(w);
    } else if (w.includes('NESTED AGGREGATION')) {
      mutableNotes.performanceConsiderations.push(w);
    }
  }

  // Testing recommendations based on query complexity
  if (ast.joinClause) {
    mutableNotes.testingRecommendations.push('Verify lookup join returns expected matches — DQL lookup semantics differ from SQL JOIN');
  }
  if (ast.timeseries) {
    mutableNotes.testingRecommendations.push('Compare timeseries chart shape with original NR dashboard');
  }
  if (ast.facetItems && ast.facetItems.length > 0) {
    mutableNotes.testingRecommendations.push('Verify FACET grouping produces same cardinality as NR');
  }

  return notes;
}

/**
 * Phase 19 uplift — raise a LOW/MEDIUM result to a higher band when the
 * emitter successfully carried a known rewrite into the DQL. Only
 * increases confidence, never decreases it. Appends a fix string
 * prefixed with `phase19:` so operators can audit which signals fired.
 */
export function applyPhase19Uplift(
  result: {
    success: boolean;
    dql: string;
    confidence: 'HIGH' | 'MEDIUM' | 'LOW';
    confidenceScore: number;
    fixes: string[];
  },
  originalNrql: string,
): void {
  if (!result.success) return;

  const nrql = originalNrql.toLowerCase();
  const dql = result.dql;
  const signals: string[] = [];

  // apdex(t) → countIf bucket decomposition (satisfied/tolerable/frustrated)
  if (/\bapdex\s*\(/.test(nrql) && /countif\s*\(/i.test(dql)) {
    signals.push('apdex → countIf buckets');
  }

  // COMPARE WITH → DQL shift: or from:now()-
  if (/\bcompare\s+with\b/.test(nrql) && (dql.includes('shift:') || /from\s*:\s*now\(\)\s*-/.test(dql))) {
    signals.push('COMPARE WITH → shift:/from:now()-');
  }

  // rate(count(*), N) → per-second expression in makeTimeseries / arithmetic
  if (/\brate\s*\(\s*count/.test(nrql) && /\/\s*\d+/.test(dql)) {
    signals.push('rate(count,N) → per-second expression');
  }

  // percentage(count, WHERE) → countIf / count * 100
  // DQL may emit either `100.0 * countIf(...) / count()` or
  // `countIf(...) / count() * 100`; accept either ordering.
  if (
    /\bpercentage\s*\(/.test(nrql) &&
    /countif\s*\(/i.test(dql) &&
    /\/\s*count\s*\(/i.test(dql) &&
    /100(?:\.0+)?\s*\*|\*\s*100(?:\.0+)?/.test(dql)
  ) {
    signals.push('percentage → countIf/count*100');
  }

  if (signals.length === 0) return;

  // Always record the audit trail so operators can see which rewrites
  // were detected, even when the score was already at the ceiling.
  for (const s of signals) {
    result.fixes = [...result.fixes, `phase19: ${s} rewrite carried — uplifted confidence`];
  }

  // Raise floor by 15 points per signal; cap at 100 and never lower.
  const bonus = Math.min(60, signals.length * 15);
  const raised = Math.min(100, Math.max(result.confidenceScore, result.confidenceScore + bonus));
  if (raised <= result.confidenceScore) return;

  result.confidenceScore = raised;
  if (raised >= 80) result.confidence = 'HIGH';
  else if (raised >= 50 && result.confidence === 'LOW') result.confidence = 'MEDIUM';
}

function computeConfidence(
  warnings: string[],
  fixes: string[],
): { confidence: 'HIGH' | 'MEDIUM' | 'LOW'; score: number } {
  let score = 100;

  // Each warning costs points
  for (const w of warnings) {
    if (w.includes('not directly supported') || w.includes('no DQL equivalent')) {
      score -= 15;
    } else if (w.includes('NESTED AGGREGATION')) {
      score -= 20;
    } else if (w.includes('Unknown metric') || w.includes('no METRIC_MAP')) {
      score -= 10;
    } else if (w.includes('manual')) {
      score -= 10;
    } else {
      score -= 5;
    }
  }

  // Fixes applied are minor deductions (auto-corrected)
  score -= fixes.length * 2;

  // Clamp
  score = Math.max(0, Math.min(100, score));

  let confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  if (score >= 80) {
    confidence = 'HIGH';
  } else if (score >= 50) {
    confidence = 'MEDIUM';
  } else {
    confidence = 'LOW';
  }

  return { confidence, score };
}
