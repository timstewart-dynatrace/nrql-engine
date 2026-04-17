/**
 * ConversionReport — JSON + HTML artifact emission (P15-05).
 *
 * Pure-string return values; consumers decide where to write. The
 * JSON shape is stable and suitable for programmatic triage UIs; the
 * HTML shape is a single self-contained document with inline CSS
 * (no external assets) ready to hand to stakeholders.
 *
 * Back-ported from the Python project's `migration/report.py`
 * with feature-parity on `warnings_by_code()`, `average_confidence_score()`,
 * `needs_review`, and confidence-band badges.
 */

import { WarningCode, WARNING_LABELS } from '../utils/warning-codes.js';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface ConversionQueryRecord {
  readonly originalNrql: string;
  readonly emittedDql: string;
  readonly confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  readonly confidenceScore: number;
  readonly warnings: string[];
  readonly warningCodes?: WarningCode[];
  readonly fixes?: string[];
  readonly runbookUrl?: string;
  readonly title?: string;
}

export interface ConversionReportSummary {
  readonly totalQueries: number;
  readonly successful: number;
  readonly averageConfidenceScore: number;
  readonly confidenceCounts: Record<'HIGH' | 'MEDIUM' | 'LOW', number>;
  readonly warningsByCode: Record<string, number>;
  readonly needsReview: number;
}

export interface ConversionReportOptions {
  readonly title?: string;
  readonly generatedAt?: string;
  readonly needsReviewThreshold?: number;
}

// ---------------------------------------------------------------------------
// ConversionReport
// ---------------------------------------------------------------------------

export class ConversionReport {
  private readonly queries: ConversionQueryRecord[] = [];
  private readonly title: string;
  private readonly generatedAt: string;
  private readonly needsReviewThreshold: number;

  constructor(options?: ConversionReportOptions) {
    this.title = options?.title ?? 'NR → DT Conversion Report';
    this.generatedAt = options?.generatedAt ?? new Date().toISOString();
    this.needsReviewThreshold = options?.needsReviewThreshold ?? 80;
  }

  addQuery(record: ConversionQueryRecord): void {
    this.queries.push(record);
  }

  addQueries(records: ConversionQueryRecord[]): void {
    for (const r of records) this.addQuery(r);
  }

  size(): number {
    return this.queries.length;
  }

  summary(): ConversionReportSummary {
    const totalQueries = this.queries.length;
    const successful = this.queries.filter((q) => q.emittedDql.length > 0).length;
    const averageConfidenceScore =
      totalQueries === 0
        ? 0
        : this.queries.reduce((acc, q) => acc + q.confidenceScore, 0) / totalQueries;
    const confidenceCounts: Record<'HIGH' | 'MEDIUM' | 'LOW', number> = {
      HIGH: 0,
      MEDIUM: 0,
      LOW: 0,
    };
    const warningsByCode: Record<string, number> = {};
    for (const q of this.queries) {
      confidenceCounts[q.confidence]++;
      for (const c of q.warningCodes ?? []) {
        warningsByCode[c] = (warningsByCode[c] ?? 0) + 1;
      }
    }
    const needsReview = this.queries.filter(
      (q) => q.confidenceScore < this.needsReviewThreshold,
    ).length;
    return {
      totalQueries,
      successful,
      averageConfidenceScore,
      confidenceCounts,
      warningsByCode,
      needsReview,
    };
  }

  /**
   * Return the queries that need manual review — any below the score
   * threshold, or any carrying one of the explicit review-required
   * warning codes.
   */
  needsReview(): ConversionQueryRecord[] {
    const explicit = new Set<string>([
      WarningCode.CONFIDENCE_LOW,
      WarningCode.MANUAL_STEP_REQUIRED,
      WarningCode.MANUAL_REVIEW_RECOMMENDED,
      WarningCode.TODO_DQL_COMPILE_THROUGH,
      WarningCode.UNKNOWN_METRIC,
      WarningCode.METRIC_UNMAPPED,
    ]);
    return this.queries.filter((q) => {
      if (q.confidenceScore < this.needsReviewThreshold) return true;
      for (const c of q.warningCodes ?? []) {
        if (explicit.has(c)) return true;
      }
      return false;
    });
  }

  toJson(pretty = true): string {
    const payload = {
      title: this.title,
      generatedAt: this.generatedAt,
      summary: this.summary(),
      queries: this.queries,
    };
    return JSON.stringify(payload, null, pretty ? 2 : 0);
  }

  toHtml(): string {
    const summary = this.summary();
    const rows = this.queries
      .map((q, i) => this.renderQueryRow(q, i))
      .join('\n');
    const codeRows = Object.entries(summary.warningsByCode)
      .sort(([, a], [, b]) => b - a)
      .map(
        ([code, count]) =>
          `<tr><td><code>${escapeHtml(code)}</code></td><td>${count}</td><td>${escapeHtml(
            WARNING_LABELS[code as WarningCode] ?? '',
          )}</td></tr>`,
      )
      .join('\n');

    return [
      '<!doctype html>',
      '<html lang="en">',
      '<head>',
      '<meta charset="utf-8">',
      `<title>${escapeHtml(this.title)}</title>`,
      '<style>',
      INLINE_CSS,
      '</style>',
      '</head>',
      '<body>',
      `<header><h1>${escapeHtml(this.title)}</h1><p class="gen">Generated ${escapeHtml(this.generatedAt)}</p></header>`,
      '<section class="summary"><h2>Summary</h2>',
      `<p>Total queries: <strong>${summary.totalQueries}</strong> · Successful: <strong>${summary.successful}</strong> · Average confidence: <strong>${summary.averageConfidenceScore.toFixed(1)}</strong> · Needs review: <strong>${summary.needsReview}</strong></p>`,
      this.renderConfidenceBadges(summary.confidenceCounts),
      summary.totalQueries === 0
        ? ''
        : `<h3>Warnings by code</h3><table class="codes"><thead><tr><th>Code</th><th>Count</th><th>Label</th></tr></thead><tbody>${codeRows}</tbody></table>`,
      '</section>',
      '<section class="queries"><h2>Queries</h2>',
      '<table class="q"><thead><tr><th>#</th><th>Confidence</th><th>Original NRQL</th><th>Emitted DQL</th><th>Warnings</th></tr></thead><tbody>',
      rows,
      '</tbody></table>',
      '</section>',
      '</body>',
      '</html>',
    ].join('\n');
  }

  private renderConfidenceBadges(
    counts: Record<'HIGH' | 'MEDIUM' | 'LOW', number>,
  ): string {
    return (
      `<p class="badges">` +
      `<span class="badge high">HIGH × ${counts.HIGH}</span>` +
      `<span class="badge medium">MEDIUM × ${counts.MEDIUM}</span>` +
      `<span class="badge low">LOW × ${counts.LOW}</span>` +
      `</p>`
    );
  }

  private renderQueryRow(q: ConversionQueryRecord, i: number): string {
    const warnings = [...q.warnings, ...(q.warningCodes ?? []).map((c) => `[${c}]`)]
      .map((w) => `<li>${escapeHtml(w)}</li>`)
      .join('');
    return [
      `<tr class="row-${q.confidence.toLowerCase()}">`,
      `<td>${i + 1}</td>`,
      `<td><span class="badge ${q.confidence.toLowerCase()}">${q.confidence} · ${q.confidenceScore}</span></td>`,
      `<td><pre>${escapeHtml(q.originalNrql)}</pre></td>`,
      `<td><pre>${escapeHtml(q.emittedDql)}</pre></td>`,
      `<td><ul>${warnings}</ul></td>`,
      `</tr>`,
    ].join('');
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const INLINE_CSS = `
body { font: 14px/1.5 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 2rem; color: #111; }
h1 { margin-top: 0; }
.gen { color: #666; }
.badges .badge { display: inline-block; padding: 2px 8px; margin-right: 4px; border-radius: 8px; font-size: 12px; }
.badge.high { background: #065f46; color: #ecfdf5; }
.badge.medium { background: #7c2d12; color: #fff7ed; }
.badge.low { background: #991b1b; color: #fef2f2; }
table { border-collapse: collapse; width: 100%; margin-top: 0.5rem; }
th, td { border: 1px solid #e5e7eb; padding: 6px 8px; vertical-align: top; text-align: left; }
th { background: #f9fafb; }
pre { margin: 0; padding: 4px 6px; background: #f3f4f6; font: 12px/1.4 ui-monospace, SFMono-Regular, monospace; white-space: pre-wrap; word-break: break-word; max-width: 420px; }
.row-low { background: #fef2f2; }
.row-medium { background: #fff7ed; }
table.codes td:first-child { font-family: ui-monospace, SFMono-Regular, monospace; }
ul { padding-left: 1rem; margin: 0; }
`;
