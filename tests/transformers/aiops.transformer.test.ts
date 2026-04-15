import { describe, it, expect, beforeEach } from 'vitest';
import { AIOpsTransformer } from '../../src/transformers/index.js';

describe('AIOpsTransformer', () => {
  let transformer: AIOpsTransformer;

  beforeEach(() => {
    transformer = new AIOpsTransformer();
  });

  it('should fail when name is missing', () => {
    const result = transformer.transform({});
    expect(result.success).toBe(false);
  });

  it('should emit workflow with davis_problem trigger', () => {
    const result = transformer.transform({ name: 'Critical Routing', enabled: true });
    expect(result.success).toBe(true);
    expect(result.data!.workflow.title).toContain('[Migrated AIOps]');
    expect(result.data!.workflow.trigger.event.active).toBe(true);
    expect(result.data!.workflow.trigger.event.config.davisProblem.minSeverity).toBe('ALL');
  });

  it('should map priority to minSeverity', () => {
    const critical = transformer.transform({
      name: 'C',
      issuesFilter: { priority: 'CRITICAL' },
    });
    expect(critical.data!.workflow.trigger.event.config.davisProblem.minSeverity).toBe('ERROR');

    const medium = transformer.transform({
      name: 'M',
      issuesFilter: { priority: 'MEDIUM' },
    });
    expect(medium.data!.workflow.trigger.event.config.davisProblem.minSeverity).toBe(
      'PERFORMANCE',
    );
  });

  it('should pass entity tag filters through to the trigger', () => {
    const result = transformer.transform({
      name: 'W',
      issuesFilter: { entityTags: { env: 'prod', team: 'platform' } },
    });
    expect(result.data!.workflow.trigger.event.config.davisProblem.entityTags).toEqual({
      env: 'prod',
      team: 'platform',
    });
  });

  it('should emit enrichment tasks with TODO DQL placeholder', () => {
    const result = transformer.transform({
      name: 'W',
      enrichments: [{ name: 'Error context', nrql: 'SELECT count(*) FROM TransactionError' }],
    });
    expect(result.data!.workflow.tasks).toHaveLength(1);
    expect(result.data!.workflow.tasks[0]!.action).toBe('dynatrace.automations:run-query');
    expect(result.data!.workflow.tasks[0]!.input.query).toContain('TODO');
    expect(result.warnings.some((w) => w.includes('Error context'))).toBe(true);
  });

  it('should emit notification task stubs per destination', () => {
    const result = transformer.transform({
      name: 'W',
      destinations: [
        { channelType: 'slack', name: 'Prod alerts' },
        { channelType: 'pagerduty', name: 'On call' },
      ],
    });
    expect(result.data!.workflow.notificationTaskStubs).toHaveLength(2);
    expect(result.data!.workflow.notificationTaskStubs[0]!.channelType).toBe('SLACK');
    expect(result.data!.workflow.notificationTaskStubs[0]!.taskName).toBe('prod_alerts');
  });

  it('should preserve muting rules as DQL comments', () => {
    const result = transformer.transform({
      name: 'W',
      mutingRules: [
        { nrql: "env = 'staging'", description: 'Silence staging noise' },
      ],
    });
    expect(result.data!.workflow.mutingRuleDql[0]).toContain('Silence staging noise');
  });
});
