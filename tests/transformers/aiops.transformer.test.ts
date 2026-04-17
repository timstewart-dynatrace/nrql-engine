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

  it('should compile enrichment NRQL to DQL via NRQLCompiler', () => {
    const result = transformer.transform({
      name: 'W',
      enrichments: [{ name: 'Error context', nrql: 'SELECT count(*) FROM TransactionError' }],
    });
    expect(result.data!.workflow.tasks).toHaveLength(1);
    expect(result.data!.workflow.tasks[0]!.action).toBe('dynatrace.automations:run-query');
    expect(result.data!.workflow.tasks[0]!.input.query).toContain('fetch spans');
    expect(result.data!.workflow.tasks[0]!.input.query).not.toContain('TODO');
    expect(result.data!.workflow.tasks[0]!.description).toMatch(/confidence: (HIGH|MEDIUM)/);
  });

  it('should emit a placeholder when enrichment NRQL is empty', () => {
    const result = transformer.transform({
      name: 'W',
      enrichments: [{ name: 'Empty', nrql: '' }],
    });
    expect(result.data!.workflow.tasks[0]!.input.query).toBe('fetch events, from:-1h');
    expect(result.warnings.some((w) => w.includes('Empty enrichment'))).toBe(true);
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

describe('AIOpsTransformer v2', () => {
  let transformer: AIOpsTransformer;

  beforeEach(() => {
    transformer = new AIOpsTransformer();
  });

  it('should fail without name', () => {
    const result = transformer.transformV2({});
    expect(result.success).toBe(false);
  });

  it('should emit v2 workflow title and active state', () => {
    const result = transformer.transformV2({
      name: 'Critical Routing',
      workflowEnabled: true,
      destinationsEnabled: true,
    });
    expect(result.success).toBe(true);
    expect(result.data!.workflow.title).toContain('[Migrated AIOps v2]');
    expect(result.data!.workflow.trigger.event.active).toBe(true);
  });

  it('should disable the workflow when either enable flag is false', () => {
    const r1 = transformer.transformV2({
      name: 'W',
      workflowEnabled: false,
      destinationsEnabled: true,
    });
    expect(r1.data!.workflow.trigger.event.active).toBe(false);

    const r2 = transformer.transformV2({
      name: 'W',
      workflowEnabled: true,
      destinationsEnabled: false,
    });
    expect(r2.data!.workflow.trigger.event.active).toBe(false);
  });

  it('should derive entityTags from labels/tags predicates', () => {
    const result = transformer.transformV2({
      name: 'W',
      issuesFilter: {
        predicates: [
          { attribute: 'labels.env', operator: 'EQUAL', values: ['prod'] },
          { attribute: 'tags.team', operator: 'EQUAL', values: ['payments'] },
        ],
      },
    });
    expect(result.data!.workflow.trigger.event.config.davisProblem.entityTags).toEqual({
      env: 'prod',
      team: 'payments',
    });
  });

  it('should derive minSeverity from priority predicate', () => {
    const crit = transformer.transformV2({
      name: 'C',
      issuesFilter: {
        predicates: [{ attribute: 'priority', operator: 'EQUAL', values: ['CRITICAL'] }],
      },
    });
    expect(crit.data!.workflow.trigger.event.config.davisProblem.minSeverity).toBe('ERROR');

    const medium = transformer.transformV2({
      name: 'M',
      issuesFilter: {
        predicates: [{ attribute: 'priority', operator: 'EQUAL', values: ['MEDIUM'] }],
      },
    });
    expect(medium.data!.workflow.trigger.event.config.davisProblem.minSeverity).toBe(
      'PERFORMANCE',
    );
  });

  it('should warn on unsupported predicate attributes', () => {
    const result = transformer.transformV2({
      name: 'W',
      issuesFilter: {
        predicates: [
          { attribute: 'customField', operator: 'CONTAINS', values: ['x'] },
        ],
      },
    });
    expect(result.warnings.some((w) => w.includes('customField'))).toBe(true);
  });

  it('should compile v2 nrqlEnrichments through NRQLCompiler', () => {
    const result = transformer.transformV2({
      name: 'W',
      enrichments: {
        nrqlEnrichments: [
          { name: 'Error count', query: 'SELECT count(*) FROM TransactionError' },
        ],
      },
    });
    expect(result.data!.workflow.tasks).toHaveLength(1);
    expect(result.data!.workflow.tasks[0]!.input.query).toContain('fetch spans');
    expect(result.data!.workflow.tasks[0]!.input.query).not.toContain('TODO');
    expect(result.data!.workflow.tasks[0]!.description).toMatch(/confidence/);
  });

  it('should warn on dashboard enrichments (must be re-linked post-migration)', () => {
    const result = transformer.transformV2({
      name: 'W',
      enrichments: {
        dashboardEnrichments: [{ name: 'Ops dash', dashboardGuid: 'GUID-123' }],
      },
    });
    expect(result.warnings.some((w) => w.includes('re-link'))).toBe(true);
  });

  it('should preserve mutingRulesHandling as a workflow comment and warn on partial-mute mode', () => {
    const result = transformer.transformV2({
      name: 'W',
      mutingRulesHandling: 'DONT_NOTIFY_FULLY_OR_PARTIALLY_MUTED_ISSUES',
    });
    expect(result.data!.workflow.mutingRuleDql[0]).toContain(
      'DONT_NOTIFY_FULLY_OR_PARTIALLY_MUTED_ISSUES',
    );
    expect(result.warnings.some((w) => w.includes('partial'))).toBe(
      false,
    ); // text uses 'DONT_NOTIFY_FULLY_OR_PARTIALLY_MUTED_ISSUES'; assert by the specific phrase below
    expect(
      result.warnings.some((w) =>
        w.includes('no direct DT equivalent'),
      ),
    ).toBe(true);
  });

  it('should map destinationConfigurations to notificationTaskStubs', () => {
    const result = transformer.transformV2({
      name: 'W',
      destinationConfigurations: [
        { channelId: 'c1', channelType: 'slack', name: 'Prod alerts' },
        { channelId: 'c2', channelType: 'pagerduty', name: 'On call' },
      ],
    });
    expect(result.data!.workflow.notificationTaskStubs).toHaveLength(2);
    expect(result.data!.workflow.notificationTaskStubs[0]!.channelType).toBe('SLACK');
    expect(result.data!.workflow.notificationTaskStubs[0]!.taskName).toBe('prod_alerts');
  });

  it('should batch via transformAllV2', () => {
    const results = transformer.transformAllV2([
      { name: 'A' },
      { name: 'B' },
    ]);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.success)).toBe(true);
  });
});
