/**
 * Legacy Error-Inbox Transformer (Gen2-only fallback).
 *
 * NR Errors Inbox exposes per-occurrence state that has no direct Gen3
 * equivalent — status (resolved / ignored / work-in-progress),
 * threaded comments, and assignees. Classic Dynatrace Problems DO
 * expose comments + acknowledgement endpoints, so this transformer
 * maps each NR error-group record into a set of API calls against
 * `/api/v2/problems/{problemId}/comments` + the problem-closure /
 * acknowledgement endpoints.
 *
 * Output is a list of API *actions* (not a single payload) — consumer
 * CLIs can batch-POST them in order. The transformer never performs
 * the HTTP itself.
 *
 * This is a **Gen2-only fallback**. Consumers who prefer to leave
 * error-inbox state behind should skip this transformer entirely.
 */

import type { TransformResult } from './types.js';
import { success, failure } from './types.js';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export type NRErrorStatus =
  | 'UNRESOLVED'
  | 'RESOLVED'
  | 'IGNORED'
  | 'WORK_IN_PROGRESS';

export interface NRErrorComment {
  readonly author: string;
  readonly createdAt?: string;
  readonly body: string;
}

export interface NRErrorInboxRecord {
  /** NR error group id (fingerprint). */
  readonly errorGroupId: string;
  /** Human-readable summary, e.g. `NullPointerException at CheckoutService.submit`. */
  readonly title: string;
  readonly status?: NRErrorStatus;
  readonly assignee?: string;
  readonly comments?: NRErrorComment[];
  /**
   * Classic-DT problem id(s) we should attach to. Consumers resolve
   * NR errorGroupId → DT problemId ahead of time; if no mapping is
   * supplied, the transformer emits a placeholder action the operator
   * must resolve manually.
   */
  readonly dtProblemIds?: string[];
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export type LegacyProblemAction =
  | {
      readonly kind: 'POST_COMMENT';
      readonly method: 'POST';
      readonly path: string; // /api/v2/problems/{id}/comments
      readonly body: { context: string; comment: string };
    }
  | {
      readonly kind: 'POST_COMMENT_UNBOUND';
      readonly note: string;
    }
  | {
      readonly kind: 'ACKNOWLEDGE';
      readonly method: 'POST';
      readonly path: string; // /api/v2/problems/{id}/close  (classic "acknowledge+close")
      readonly body: { message: string };
    };

export interface LegacyErrorInboxTransformData {
  readonly actions: LegacyProblemAction[];
  readonly manualSteps: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LEGACY_WARNING =
  'Emitting Gen2 classic Problem API actions (legacy). Gen3 Dynatrace Problems do not accept per-occurrence resolution/comment state from external systems — this transformer exists solely for tenants still on the classic problem-comments path.';

const STATUS_TO_CLOSE: ReadonlySet<NRErrorStatus> = new Set([
  'RESOLVED',
  'IGNORED',
]);

function buildCommentBody(
  record: NRErrorInboxRecord,
  comment: NRErrorComment,
): { context: string; comment: string } {
  const prefix = comment.createdAt ? `[${comment.createdAt}] ` : '';
  return {
    context: `nr-migrated:${record.errorGroupId}`,
    comment: `${prefix}${comment.author}: ${comment.body}`,
  };
}

// ---------------------------------------------------------------------------
// LegacyErrorInboxTransformer
// ---------------------------------------------------------------------------

export class LegacyErrorInboxTransformer {
  transform(
    record: NRErrorInboxRecord,
  ): TransformResult<LegacyErrorInboxTransformData> {
    try {
      if (!record.errorGroupId) {
        return failure(['errorGroupId is required']);
      }
      const warnings: string[] = [LEGACY_WARNING];
      const actions: LegacyProblemAction[] = [];

      const problemIds = record.dtProblemIds ?? [];
      if (problemIds.length === 0) {
        warnings.push(
          `No DT problem id(s) supplied for NR errorGroup '${record.errorGroupId}' — emitting POST_COMMENT_UNBOUND placeholders. Resolve problemIds and re-run, or skip this record.`,
        );
      }

      // Comments
      for (const c of record.comments ?? []) {
        if (problemIds.length === 0) {
          actions.push({
            kind: 'POST_COMMENT_UNBOUND',
            note: `# TODO: resolve DT problem id for NR errorGroup '${record.errorGroupId}' and POST ${JSON.stringify(buildCommentBody(record, c))}`,
          });
        } else {
          for (const pid of problemIds) {
            actions.push({
              kind: 'POST_COMMENT',
              method: 'POST',
              path: `/api/v2/problems/${pid}/comments`,
              body: buildCommentBody(record, c),
            });
          }
        }
      }

      // Assignment — DT problem comments don't have an assignee field,
      // but we can record it as a comment so the audit trail exists.
      if (record.assignee) {
        const assignComment = {
          context: `nr-migrated:${record.errorGroupId}:assignee`,
          comment: `Assigned to ${record.assignee} (migrated from NR Errors Inbox).`,
        };
        if (problemIds.length === 0) {
          actions.push({
            kind: 'POST_COMMENT_UNBOUND',
            note: `# TODO: resolve DT problem id and POST ${JSON.stringify(assignComment)}`,
          });
        } else {
          for (const pid of problemIds) {
            actions.push({
              kind: 'POST_COMMENT',
              method: 'POST',
              path: `/api/v2/problems/${pid}/comments`,
              body: assignComment,
            });
          }
        }
        warnings.push(
          'Assignment converted to a comment — classic DT Problems have no assignee field. Use a dedicated tag convention (e.g. owner:<email>) if you need queryable assignment state.',
        );
      }

      // Status
      const status = record.status ?? 'UNRESOLVED';
      if (STATUS_TO_CLOSE.has(status)) {
        const closeMessage =
          status === 'RESOLVED'
            ? `Resolved via NR migration of errorGroup '${record.errorGroupId}'.`
            : `Ignored via NR migration of errorGroup '${record.errorGroupId}'.`;
        if (problemIds.length === 0) {
          actions.push({
            kind: 'POST_COMMENT_UNBOUND',
            note: `# TODO: resolve DT problem id and POST /api/v2/problems/{id}/close body=${JSON.stringify({ message: closeMessage })}`,
          });
        } else {
          for (const pid of problemIds) {
            actions.push({
              kind: 'ACKNOWLEDGE',
              method: 'POST',
              path: `/api/v2/problems/${pid}/close`,
              body: { message: closeMessage },
            });
          }
        }
      } else if (status === 'WORK_IN_PROGRESS') {
        // No close — emit a progress comment so the state isn't lost.
        const progressComment = {
          context: `nr-migrated:${record.errorGroupId}:status`,
          comment: `Status: WORK_IN_PROGRESS (NR Errors Inbox). Problem intentionally left open on DT.`,
        };
        if (problemIds.length === 0) {
          actions.push({
            kind: 'POST_COMMENT_UNBOUND',
            note: `# TODO: resolve DT problem id and POST ${JSON.stringify(progressComment)}`,
          });
        } else {
          for (const pid of problemIds) {
            actions.push({
              kind: 'POST_COMMENT',
              method: 'POST',
              path: `/api/v2/problems/${pid}/comments`,
              body: progressComment,
            });
          }
        }
      }

      const manualSteps = [
        'Resolve NR errorGroupId → DT problemId mappings before running these actions (use the classic Problems API `problemFilter` with the migrated tag as an anchor).',
        'Rate-limit: batch the POSTs at ≤10 req/s to avoid the classic Problems API throttle (HTTP 429).',
        'Acknowledgement semantics: classic DT `/api/v2/problems/{id}/close` flips the problem to RESOLVED and is irreversible. IGNORED in NR maps to the same call; reflect that in your audit trail.',
      ];

      return success({ actions, manualSteps }, [...warnings, ...manualSteps]);
    } catch (err) {
      return failure([`Transformation error: ${String(err)}`]);
    }
  }

  transformAll(
    records: NRErrorInboxRecord[],
  ): TransformResult<LegacyErrorInboxTransformData>[] {
    return records.map((r) => this.transform(r));
  }
}
