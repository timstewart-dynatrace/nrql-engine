/**
 * Stable warning / error taxonomy — back-port of the Python project's
 * `utils/error_taxonomy.py` (`WarningCode` / `ErrorCode` enums +
 * `CodedMessage` dataclass).
 *
 * Consumers can now discriminate on a stable enum value instead of
 * regex-matching free-form strings. Every transformer `TransformResult`
 * and every compiler `CompileResult` optionally carries a parallel
 * `warningCodes` / `errorCodes` array; the existing
 * `warnings: string[]` / `error: string` surface is preserved
 * verbatim for back-compat.
 *
 * Usage pattern inside a transformer:
 *
 * ```ts
 * warnings.push(emitted(W.CONFIDENCE_LOW, 'apdex(t) rewritten to countIf — LOW confidence'));
 * // or, when only a code is needed:
 * codes.push(W.LEGACY_ONLY_PATH);
 * ```
 *
 * Usage on the consumer side:
 *
 * ```ts
 * const byCode = warningsByCode(result.warningCodes ?? []);
 * console.log(`LOW confidence count: ${byCode[W.CONFIDENCE_LOW]?.length ?? 0}`);
 * ```
 */

// ---------------------------------------------------------------------------
// WarningCode — stable enum
// ---------------------------------------------------------------------------

/**
 * Stable codes for every warning the engine can emit. Grouped by
 * concern so consumers can reason about classes of issues (auth,
 * confidence, schema, api, …) rather than individual codes.
 */
export enum WarningCode {
  // ─── Confidence / correctness ─────────────────────────────────────────
  CONFIDENCE_LOW = 'CONFIDENCE_LOW',
  CONFIDENCE_MEDIUM = 'CONFIDENCE_MEDIUM',
  METRIC_UNMAPPED = 'METRIC_UNMAPPED',
  NESTED_AGGREGATION = 'NESTED_AGGREGATION',
  UNKNOWN_METRIC = 'UNKNOWN_METRIC',
  SEMANTIC_DRIFT = 'SEMANTIC_DRIFT',

  // ─── Schema / field mismatches ────────────────────────────────────────
  SCHEMA_MISMATCH = 'SCHEMA_MISMATCH',
  UNSUPPORTED_WIDGET = 'UNSUPPORTED_WIDGET',
  UNSUPPORTED_FIELD = 'UNSUPPORTED_FIELD',
  FIELD_DROPPED = 'FIELD_DROPPED',
  FIELD_RENAMED = 'FIELD_RENAMED',
  TRUNCATED = 'TRUNCATED',

  // ─── DT capability / generation ───────────────────────────────────────
  GEN3_API_MISSING = 'GEN3_API_MISSING',
  LEGACY_ONLY_PATH = 'LEGACY_ONLY_PATH',
  DAVIS_REPLACES = 'DAVIS_REPLACES',
  PLATFORM_FEATURE_AUTOMATIC = 'PLATFORM_FEATURE_AUTOMATIC',

  // ─── Auth / secrets ───────────────────────────────────────────────────
  SECRET_NOT_TRANSFERABLE = 'SECRET_NOT_TRANSFERABLE',
  CREDENTIALS_VAULT_REPROVISION = 'CREDENTIALS_VAULT_REPROVISION',
  TOKEN_SCOPE_MISSING = 'TOKEN_SCOPE_MISSING',

  // ─── HTTP / transport ────────────────────────────────────────────────
  RATE_LIMITED = 'RATE_LIMITED',
  RETRY_EXHAUSTED = 'RETRY_EXHAUSTED',
  ENDPOINT_UNREACHABLE = 'ENDPOINT_UNREACHABLE',

  // ─── Build / host / pipeline ──────────────────────────────────────────
  REQUIRES_AGENT_DEPLOY = 'REQUIRES_AGENT_DEPLOY',
  REQUIRES_SDK_SWAP = 'REQUIRES_SDK_SWAP',
  REQUIRES_BUILD_PIPELINE_CHANGE = 'REQUIRES_BUILD_PIPELINE_CHANGE',
  REQUIRES_ACTIVE_GATE = 'REQUIRES_ACTIVE_GATE',

  // ─── Manual follow-up ────────────────────────────────────────────────
  MANUAL_STEP_REQUIRED = 'MANUAL_STEP_REQUIRED',
  MANUAL_REVIEW_RECOMMENDED = 'MANUAL_REVIEW_RECOMMENDED',
  TODO_DQL_COMPILE_THROUGH = 'TODO_DQL_COMPILE_THROUGH',

  // ─── Input validation / data quality ─────────────────────────────────
  INPUT_AMBIGUOUS = 'INPUT_AMBIGUOUS',
  INPUT_SKIPPED = 'INPUT_SKIPPED',
  DEFAULT_APPLIED = 'DEFAULT_APPLIED',

  // ─── Informational ───────────────────────────────────────────────────
  PHASE19_UPLIFT = 'PHASE19_UPLIFT',
  PROVENANCE_STAMPED = 'PROVENANCE_STAMPED',
}

// ---------------------------------------------------------------------------
// ErrorCode — stable enum for hard-fail conditions
// ---------------------------------------------------------------------------

export enum ErrorCode {
  LEX_ERROR = 'LEX_ERROR',
  PARSE_ERROR = 'PARSE_ERROR',
  EMIT_ERROR = 'EMIT_ERROR',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  INPUT_INVALID = 'INPUT_INVALID',
  INPUT_MISSING = 'INPUT_MISSING',
  UNKNOWN_KIND = 'UNKNOWN_KIND',
  UNSUPPORTED_VERSION = 'UNSUPPORTED_VERSION',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

// ---------------------------------------------------------------------------
// CodedMessage — structured warning carrier
// ---------------------------------------------------------------------------

export interface CodedWarning {
  readonly code: WarningCode;
  readonly message: string;
  readonly context?: Record<string, string | number | boolean>;
}

export interface CodedError {
  readonly code: ErrorCode;
  readonly message: string;
  readonly context?: Record<string, string | number | boolean>;
}

/**
 * Format a coded warning for emission alongside the plain-string
 * `warnings` array. Returns the same `message` so consumers using the
 * free-form array see no change; new consumers can access the matching
 * `warningCodes` array by index.
 */
export function emitted(_code: WarningCode, message: string): string {
  return message;
}

/**
 * Bucket an array of coded warnings by their code for triage UIs.
 */
export function warningsByCode(
  codes: ReadonlyArray<WarningCode | CodedWarning>,
): Record<string, Array<WarningCode | CodedWarning>> {
  const out: Record<string, Array<WarningCode | CodedWarning>> = {};
  for (const c of codes) {
    const key = typeof c === 'string' ? c : c.code;
    if (!out[key]) out[key] = [];
    out[key]!.push(c);
  }
  return out;
}

/**
 * Human-readable label for display in reports / CLIs. Kept separate
 * from the enum value (which is the stable id for machine consumers).
 */
export const WARNING_LABELS: Record<WarningCode, string> = {
  [WarningCode.CONFIDENCE_LOW]: 'LOW confidence — manual review recommended',
  [WarningCode.CONFIDENCE_MEDIUM]: 'MEDIUM confidence — verify before production',
  [WarningCode.METRIC_UNMAPPED]: 'NR metric has no DT default mapping',
  [WarningCode.NESTED_AGGREGATION]: 'Nested aggregation not supported by DT',
  [WarningCode.UNKNOWN_METRIC]: 'Unknown metric — compiler could not resolve',
  [WarningCode.SEMANTIC_DRIFT]: 'Emitted shape differs from NR semantics',
  [WarningCode.SCHEMA_MISMATCH]: 'Input schema differs from expected',
  [WarningCode.UNSUPPORTED_WIDGET]: 'Widget type has no DT equivalent',
  [WarningCode.UNSUPPORTED_FIELD]: 'Field has no DT equivalent',
  [WarningCode.FIELD_DROPPED]: 'Field dropped — no DT equivalent',
  [WarningCode.FIELD_RENAMED]: 'Field renamed to DT convention',
  [WarningCode.TRUNCATED]: 'Output truncated',
  [WarningCode.GEN3_API_MISSING]: 'No Gen3 equivalent — Legacy path only',
  [WarningCode.LEGACY_ONLY_PATH]: 'Emitting classic Gen2 shape (legacy)',
  [WarningCode.DAVIS_REPLACES]: 'Behavior replaced by Davis (automatic)',
  [WarningCode.PLATFORM_FEATURE_AUTOMATIC]: 'DT platform feature — no migration',
  [WarningCode.SECRET_NOT_TRANSFERABLE]: 'Secret / token not transferable',
  [WarningCode.CREDENTIALS_VAULT_REPROVISION]: 'Re-provision credentials vault entry',
  [WarningCode.TOKEN_SCOPE_MISSING]: 'API token scope required',
  [WarningCode.RATE_LIMITED]: 'Rate limit hit (429)',
  [WarningCode.RETRY_EXHAUSTED]: 'Retry budget exhausted',
  [WarningCode.ENDPOINT_UNREACHABLE]: 'Endpoint unreachable',
  [WarningCode.REQUIRES_AGENT_DEPLOY]: 'Requires OneAgent / Mobile SDK deployment',
  [WarningCode.REQUIRES_SDK_SWAP]: 'Requires customer SDK swap',
  [WarningCode.REQUIRES_BUILD_PIPELINE_CHANGE]: 'Requires build-pipeline change',
  [WarningCode.REQUIRES_ACTIVE_GATE]: 'Requires ActiveGate extension deployment',
  [WarningCode.MANUAL_STEP_REQUIRED]: 'Manual step required',
  [WarningCode.MANUAL_REVIEW_RECOMMENDED]: 'Manual review recommended',
  [WarningCode.TODO_DQL_COMPILE_THROUGH]: 'TODO: run NRQL through compiler',
  [WarningCode.INPUT_AMBIGUOUS]: 'Input ambiguous — defaulted',
  [WarningCode.INPUT_SKIPPED]: 'Input skipped (invalid or empty)',
  [WarningCode.DEFAULT_APPLIED]: 'Default value applied',
  [WarningCode.PHASE19_UPLIFT]: 'Phase 19 positive-signal uplift applied',
  [WarningCode.PROVENANCE_STAMPED]: 'Output stamped with migrated.from=newrelic',
};
