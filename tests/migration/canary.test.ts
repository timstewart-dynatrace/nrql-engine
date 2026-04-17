import { describe, it, expect } from 'vitest';
import {
  CanaryPlan,
  autoApproveGate,
  autoRejectGate,
} from '../../src/migration/canary.js';

describe('CanaryPlan', () => {
  it('splits 10% by default', () => {
    const plan = new CanaryPlan<number>();
    const bucket = Array.from({ length: 100 }, (_, i) => i);
    const { canary, rest } = plan.split(bucket);
    expect(canary).toHaveLength(10);
    expect(rest).toHaveLength(90);
  });

  it('enforces minCanarySize floor', () => {
    const plan = new CanaryPlan<number>({ canaryPercent: 10, minCanarySize: 3 });
    const { canary } = plan.split([1, 2, 3, 4, 5]);
    expect(canary.length).toBeGreaterThanOrEqual(3);
  });

  it('enforces maxCanarySize ceiling', () => {
    const plan = new CanaryPlan<number>({
      canaryPercent: 100,
      maxCanarySize: 5,
    });
    const { canary, rest } = plan.split(Array.from({ length: 100 }, (_, i) => i));
    expect(canary).toHaveLength(5);
    expect(rest).toHaveLength(95);
  });

  it('returns empty split for an empty bucket', () => {
    const plan = new CanaryPlan<number>();
    const { canary, rest } = plan.split([]);
    expect(canary).toEqual([]);
    expect(rest).toEqual([]);
  });

  it('caps canary at bucket length when pct=100', () => {
    const plan = new CanaryPlan<number>({ canaryPercent: 100 });
    const { canary, rest } = plan.split([1, 2, 3]);
    expect(canary).toHaveLength(3);
    expect(rest).toHaveLength(0);
  });

  it('rejects invalid canaryPercent', () => {
    expect(() => new CanaryPlan<number>({ canaryPercent: -5 })).toThrow();
    expect(() => new CanaryPlan<number>({ canaryPercent: 150 })).toThrow();
  });

  it('rollout runs canary then rest when gate approves', async () => {
    const plan = new CanaryPlan<number>({ canaryPercent: 20 });
    const bucket = Array.from({ length: 10 }, (_, i) => i);
    const waves: Array<{ label: string; size: number }> = [];
    const runWave = async (wave: number[], label: 'canary' | 'rest'): Promise<void> => {
      waves.push({ label, size: wave.length });
    };
    const outcome = await plan.rollout(bucket, runWave, autoApproveGate);
    expect(outcome).toBe('approved');
    expect(waves).toHaveLength(2);
    expect(waves[0]!.label).toBe('canary');
    expect(waves[1]!.label).toBe('rest');
    expect(waves[0]!.size + waves[1]!.size).toBe(10);
  });

  it('rollout stops after canary when gate rejects', async () => {
    const plan = new CanaryPlan<number>({ canaryPercent: 20 });
    const bucket = [1, 2, 3, 4, 5];
    const waves: string[] = [];
    const runWave = async (_wave: number[], label: 'canary' | 'rest'): Promise<void> => {
      waves.push(label);
    };
    const outcome = await plan.rollout(bucket, runWave, autoRejectGate);
    expect(outcome).toBe('rejected');
    expect(waves).toEqual(['canary']);
  });

  it('rollout on empty bucket returns empty', async () => {
    const plan = new CanaryPlan<number>();
    const outcome = await plan.rollout([], async () => {}, autoApproveGate);
    expect(outcome).toBe('empty');
  });

  it('approvalGate receives the canary wave', async () => {
    const plan = new CanaryPlan<number>({ canaryPercent: 30 });
    const received: number[][] = [];
    const gate = async (canary: number[]): Promise<boolean> => {
      received.push([...canary]);
      return true;
    };
    await plan.rollout([10, 20, 30, 40, 50], async () => {}, gate);
    expect(received[0]!.length).toBeGreaterThan(0);
  });
});
