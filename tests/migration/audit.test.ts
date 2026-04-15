import { describe, it, expect } from 'vitest';
import { runAudit, driftByKind } from '../../src/migration/audit.js';

describe('runAudit', () => {
  it('returns no drift when transformed == dtSnapshot', () => {
    const entity = {
      id: 'e1',
      displayName: '[Migrated] Prod',
      payload: { foo: 'bar' },
    };
    const report = runAudit({ transformed: [entity], dtSnapshot: [entity] });
    expect(report.drift).toEqual([]);
    expect(report.summary.RENAMED).toBe(0);
    expect(report.summary.DELETED).toBe(0);
    expect(report.summary.MODIFIED).toBe(0);
    expect(report.summary.EXTRA).toBe(0);
  });

  it('detects RENAMED when displayName differs but payload matches', () => {
    const report = runAudit({
      transformed: [
        { id: 'e1', displayName: '[Migrated] New name', payload: { foo: 'bar' } },
      ],
      dtSnapshot: [
        { id: 'e1', displayName: '[Migrated] Old name', payload: { foo: 'bar' } },
      ],
    });
    expect(report.drift[0]!.kind).toBe('RENAMED');
    expect(report.drift[0]!.transformedName).toBe('[Migrated] New name');
    expect(report.drift[0]!.dtName).toBe('[Migrated] Old name');
  });

  it('detects DELETED when transformed entity missing from DT', () => {
    const report = runAudit({
      transformed: [
        { id: 'gone', displayName: '[Migrated] Ghost', payload: {} },
      ],
      dtSnapshot: [],
    });
    expect(report.drift[0]!.kind).toBe('DELETED');
  });

  it('detects MODIFIED when payload differs after normalization', () => {
    const report = runAudit({
      transformed: [{ id: 'e1', payload: { foo: 'bar', value: 1 } }],
      dtSnapshot: [{ id: 'e1', payload: { foo: 'bar', value: 2 } }],
    });
    expect(report.drift[0]!.kind).toBe('MODIFIED');
    expect(report.drift[0]!.diffSummary).toContain('value');
  });

  it('ignores server-populated fields during MODIFIED comparison', () => {
    const report = runAudit({
      transformed: [{ id: 'e1', payload: { foo: 'bar' } }],
      dtSnapshot: [
        {
          id: 'e1',
          payload: {
            foo: 'bar',
            modificationInfo: { when: '2026-01-01' },
            version: 'abc',
            objectId: 'OBJ-1',
          },
        },
      ],
    });
    expect(report.drift).toEqual([]);
  });

  it('detects EXTRA when DT has a migrated-looking entity not in transformed', () => {
    const report = runAudit({
      transformed: [],
      dtSnapshot: [
        {
          id: 'extra-1',
          displayName: '[Migrated] Leftover',
          payload: { name: '[Migrated] Leftover' },
        },
      ],
    });
    expect(report.drift[0]!.kind).toBe('EXTRA');
  });

  it('does NOT flag EXTRA for organic (non-migrated) DT entities', () => {
    const report = runAudit({
      transformed: [],
      dtSnapshot: [
        {
          id: 'organic',
          displayName: 'Prod alerts',
          payload: { name: 'Prod alerts' },
        },
      ],
    });
    expect(report.drift).toEqual([]);
  });

  it('summary counts match drift records', () => {
    const report = runAudit({
      transformed: [
        { id: 'a', displayName: '[Migrated] A', payload: { x: 1 } },
        { id: 'b', displayName: '[Migrated] B', payload: { x: 1 } },
        { id: 'gone', displayName: '[Migrated] Gone', payload: {} },
      ],
      dtSnapshot: [
        { id: 'a', displayName: '[Migrated] A', payload: { x: 2 } }, // MODIFIED
        { id: 'b', displayName: '[Migrated] Renamed B', payload: { x: 1 } }, // RENAMED
        {
          id: 'extra',
          displayName: '[Migrated] Leftover',
          payload: { name: '[Migrated] Leftover' },
        }, // EXTRA
      ],
    });
    expect(report.summary.MODIFIED).toBe(1);
    expect(report.summary.RENAMED).toBe(1);
    expect(report.summary.DELETED).toBe(1);
    expect(report.summary.EXTRA).toBe(1);
  });

  it('driftByKind groups records', () => {
    const report = runAudit({
      transformed: [{ id: 'gone', payload: {} }],
      dtSnapshot: [],
    });
    const buckets = driftByKind(report);
    expect(buckets.DELETED).toHaveLength(1);
    expect(buckets.MODIFIED).toHaveLength(0);
    expect(buckets.RENAMED).toHaveLength(0);
    expect(buckets.EXTRA).toHaveLength(0);
  });
});
