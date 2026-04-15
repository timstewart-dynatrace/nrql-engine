/**
 * CanaryPlan — two-wave rollout split with an approval gate (P15-04).
 *
 * TS port of the Python `migration/canary.py`. Given a bucket of
 * entities (a list keyed by some stable id) and a `canaryPercent` +
 * `minCanarySize`, produces a `(canary, rest)` partition. Consumers
 * then run the canary wave, call an injected `approvalGate`, and —
 * on approval — run the rest.
 *
 * The transformer never runs the migration. It only slices the batch
 * and invokes the caller-supplied gate. Gate signature:
 * `(canary: T[]) => Promise<boolean>`. Return `false` to abort.
 */

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface CanaryPlanOptions {
  /** Percentage of the bucket to include in the canary wave (0-100). Default 10. */
  readonly canaryPercent?: number;
  /** Floor on canary size so tiny batches still get a meaningful probe. Default 1. */
  readonly minCanarySize?: number;
  /** Upper bound on canary size. Default Infinity (uncapped). */
  readonly maxCanarySize?: number;
}

export type ApprovalGate<T> = (canary: T[]) => Promise<boolean> | boolean;

export interface CanarySplit<T> {
  readonly canary: T[];
  readonly rest: T[];
}

// ---------------------------------------------------------------------------
// CanaryPlan
// ---------------------------------------------------------------------------

export class CanaryPlan<T> {
  private readonly canaryPercent: number;
  private readonly minCanarySize: number;
  private readonly maxCanarySize: number;

  constructor(options?: CanaryPlanOptions) {
    const pct = options?.canaryPercent ?? 10;
    if (pct < 0 || pct > 100) {
      throw new Error(
        `canaryPercent must be between 0 and 100 (got ${pct})`,
      );
    }
    this.canaryPercent = pct;
    this.minCanarySize = Math.max(1, options?.minCanarySize ?? 1);
    this.maxCanarySize = options?.maxCanarySize ?? Infinity;
  }

  /**
   * Split a bucket into canary + rest. Empty buckets return
   * `{ canary: [], rest: [] }`.
   */
  split(bucket: readonly T[]): CanarySplit<T> {
    if (bucket.length === 0) return { canary: [], rest: [] };

    const proportional = Math.ceil((bucket.length * this.canaryPercent) / 100);
    const canarySize = Math.min(
      bucket.length,
      Math.max(this.minCanarySize, Math.min(this.maxCanarySize, proportional)),
    );

    return {
      canary: bucket.slice(0, canarySize),
      rest: bucket.slice(canarySize),
    };
  }

  /**
   * Run a canary wave, await approval, then return the rest so the
   * caller can proceed. The caller does the actual migration work
   * inside `runWave`. Returns `undefined` when the gate rejects.
   */
  async rollout(
    bucket: readonly T[],
    runWave: (wave: T[], label: 'canary' | 'rest') => Promise<void>,
    approvalGate: ApprovalGate<T>,
  ): Promise<'approved' | 'rejected' | 'empty'> {
    if (bucket.length === 0) return 'empty';
    const { canary, rest } = this.split(bucket);
    await runWave(canary, 'canary');
    const ok = await approvalGate(canary);
    if (!ok) return 'rejected';
    if (rest.length > 0) await runWave(rest, 'rest');
    return 'approved';
  }
}

/**
 * Auto-approve gate — convenience for tests / unattended runs.
 */
export const autoApproveGate: ApprovalGate<unknown> = () => true;

/**
 * Auto-reject gate — convenience for dry-run validation of the
 * canary wave without proceeding to the rest.
 */
export const autoRejectGate: ApprovalGate<unknown> = () => false;
