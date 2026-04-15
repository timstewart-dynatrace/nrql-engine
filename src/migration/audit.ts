/**
 * Post-migration drift detector (P15-02).
 *
 * TS port of the Python `migration/audit.py`. Compares a snapshot of
 * transformed outputs (what the engine emitted) against a snapshot of
 * what's actually in the DT tenant after the migration run, and
 * classifies each entity into one of four drift kinds:
 *
 *   - **RENAMED** — matched by some stable id but `displayName`
 *     (or equivalent) differs
 *   - **DELETED** — present in the transformed set, absent from DT
 *   - **MODIFIED** — present on both sides but normalised payload
 *     differs
 *   - **EXTRA** — present on DT, absent from transformed set, but
 *     `looksMigrated()` returns true (so operators see rogue entities
 *     that our run did not emit)
 *
 * Pure data in / pure data out. No HTTP. Callers resolve the DT
 * snapshot however they like (usually the DT client's `backupAll` or
 * per-schema list endpoints).
 */

import { looksMigrated } from '../utils/provenance.js';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface AuditEntity {
  /** Stable identifier — customDeviceId, objectId, id, or a normalized slug. */
  readonly id: string;
  readonly displayName?: string;
  readonly schemaId?: string;
  /** Full payload — used for MODIFIED comparison after normalization. */
  readonly payload: Record<string, unknown>;
}

export interface AuditInput {
  /** What the engine produced in this migration run. */
  readonly transformed: AuditEntity[];
  /** Snapshot of the DT tenant at audit time. */
  readonly dtSnapshot: AuditEntity[];
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export type DriftKind = 'RENAMED' | 'DELETED' | 'MODIFIED' | 'EXTRA';

export interface DriftRecord {
  readonly kind: DriftKind;
  readonly id: string;
  readonly schemaId?: string;
  readonly transformedName?: string;
  readonly dtName?: string;
  readonly diffSummary?: string;
}

export interface AuditReport {
  readonly totalTransformed: number;
  readonly totalInDt: number;
  readonly drift: DriftRecord[];
  readonly summary: Record<DriftKind, number>;
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/**
 * Strip server-populated fields so `MODIFIED` comparisons don't
 * fire just because DT added `modificationInfo` / `version` /
 * `objectId` on write.
 */
const SERVER_FIELDS: ReadonlySet<string> = new Set([
  'modificationInfo',
  'version',
  'objectId',
  'id',
  'metadata',
  'createdAt',
  'lastModified',
  'lastModifiedBy',
  'owner',
]);

function normalize(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (SERVER_FIELDS.has(k)) continue;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = normalize(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function stableStringify(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const entries = Object.entries(v as Record<string, unknown>).sort(
    ([a], [b]) => a.localeCompare(b),
  );
  return `{${entries.map(([k, val]) => `${JSON.stringify(k)}:${stableStringify(val)}`).join(',')}}`;
}

function diffSummary(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): string {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const changed: string[] = [];
  for (const k of keys) {
    const va = stableStringify(a[k]);
    const vb = stableStringify(b[k]);
    if (va !== vb) changed.push(k);
  }
  return changed.length === 0 ? 'deep-equal (normalized)' : `differs on: ${changed.join(', ')}`;
}

// ---------------------------------------------------------------------------
// runAudit
// ---------------------------------------------------------------------------

export function runAudit(input: AuditInput): AuditReport {
  const transformedById = new Map(input.transformed.map((e) => [e.id, e]));
  const dtById = new Map(input.dtSnapshot.map((e) => [e.id, e]));

  const drift: DriftRecord[] = [];

  // RENAMED / MODIFIED / DELETED
  for (const [id, t] of transformedById) {
    const dt = dtById.get(id);
    if (!dt) {
      drift.push({
        kind: 'DELETED',
        id,
        schemaId: t.schemaId,
        transformedName: t.displayName,
      });
      continue;
    }
    const nameChanged =
      t.displayName !== undefined &&
      dt.displayName !== undefined &&
      t.displayName !== dt.displayName;
    const normT = normalize(t.payload);
    const normD = normalize(dt.payload);
    const payloadChanged = stableStringify(normT) !== stableStringify(normD);
    if (nameChanged && !payloadChanged) {
      drift.push({
        kind: 'RENAMED',
        id,
        schemaId: t.schemaId,
        transformedName: t.displayName,
        dtName: dt.displayName,
      });
    } else if (payloadChanged) {
      drift.push({
        kind: 'MODIFIED',
        id,
        schemaId: t.schemaId,
        transformedName: t.displayName,
        dtName: dt.displayName,
        diffSummary: diffSummary(normT, normD),
      });
    }
  }

  // EXTRA — present on DT, not in transformed set, and looks migrated
  for (const [id, dt] of dtById) {
    if (transformedById.has(id)) continue;
    if (looksMigrated(dt.payload)) {
      drift.push({
        kind: 'EXTRA',
        id,
        schemaId: dt.schemaId,
        dtName: dt.displayName,
      });
    }
  }

  const summary: Record<DriftKind, number> = {
    RENAMED: 0,
    DELETED: 0,
    MODIFIED: 0,
    EXTRA: 0,
  };
  for (const d of drift) summary[d.kind]++;

  return {
    totalTransformed: input.transformed.length,
    totalInDt: input.dtSnapshot.length,
    drift,
    summary,
  };
}

/**
 * Bucket drift records by kind — convenience for triage UIs.
 */
export function driftByKind(report: AuditReport): Record<DriftKind, DriftRecord[]> {
  const out: Record<DriftKind, DriftRecord[]> = {
    RENAMED: [],
    DELETED: [],
    MODIFIED: [],
    EXTRA: [],
  };
  for (const d of report.drift) out[d.kind].push(d);
  return out;
}
