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

  it('should emit workflow with davis-problem trigger matching every migrated detector', () => {
    const result = transformer.transform({ name: 'Critical Routing', enabled: true });
    expect(result.success).toBe(true);
    const wf = result.data!.workflow;
    expect(wf.title).toContain('[Migrated AIOps]');
    expect(wf.trigger.eventTrigger.isActive).toBe(true);
    const config = wf.trigger.eventTrigger.triggerConfiguration;
    expect(config.type).toBe('davis-problem');
    expect(config.value.customFilter).toBe('matchesValue(event.name, "[Migrated] *")');
    expect(Object.values(config.value.categories).every(Boolean)).toBe(true);
    expect(Object.keys(wf).sort()).toEqual(['description', 'isPrivate', 'tasks', 'title', 'trigger']);
  });

  it('should warn that issue priority has no trigger equivalent', () => {
    const critical = transformer.transform({
      name: 'C',
      issuesFilter: { priority: 'CRITICAL' },
    });
    expect(critical.warnings.some((w) => w.includes("priority 'CRITICAL'"))).toBe(true);
    expect(
      Object.values(critical.data!.workflow.trigger.eventTrigger.triggerConfiguration.value.categories).every(Boolean),
    ).toBe(true);
  });

  it('should pass entity tag filters through to the trigger', () => {
    const result = transformer.transform({
      name: 'W',
      issuesFilter: { entityTags: { env: 'prod', team: 'platform' } },
    });
    expect(result.data!.workflow.trigger.eventTrigger.triggerConfiguration.value.entityTags).toEqual({
      env: 'prod',
      team: 'platform',
    });
  });

  it('should compile enrichment NRQL to DQL via NRQLCompiler', () => {
    const result = transformer.transform({
      name: 'W',
      enrichments: [{ name: 'Error context', nrql: 'SELECT count(*) FROM TransactionError' }],
    });
    const tasks = Object.values(result.data!.workflow.tasks);
    expect(Array.isArray(result.data!.workflow.tasks)).toBe(false);
    expect(Object.keys(result.data!.workflow.tasks)).toEqual(['error_context']);
    expect(tasks[0]!.action).toBe('dynatrace.automations:run-query');
    expect(tasks[0]!.input.query).toContain('fetch spans');
    expect(tasks[0]!.input.query).not.toContain('TODO');
    expect(tasks[0]!.description).toMatch(/confidence: (HIGH|MEDIUM)/);
  });

  it('should emit a placeholder when enrichment NRQL is empty', () => {
    const result = transformer.transform({
      name: 'W',
      enrichments: [{ name: 'Empty', nrql: '' }],
    });
    expect(Object.values(result.data!.workflow.tasks)[0]!.input.query).toBe('// TODO: add enrichment DQL');
    expect(result.warnings.some((w) => w.includes('Empty enrichment'))).toBe(true);
  });

  it('should never embed raw NRQL in an enrichment task (D15)', () => {
    const nrql = 'SELECT FROM WHERE ((( nonsense';
    const result = transformer.transform({ name: 'W', enrichments: [{ name: 'Bad', nrql }] });
    expect(Object.values(result.data!.workflow.tasks)[0]!.input.query).toBe(
      `// UNCONVERTED NRQL: ${nrql}\n// TODO: rewrite as DQL`,
    );
    expect(
      result.warnings.some((w) => w.includes('AIOps enrichment NRQL could not be converted to DQL: ')),
    ).toBe(true);
  });

  it('should emit notification task stubs per destination', () => {
    const result = transformer.transform({
      name: 'W',
      destinations: [
        { channelType: 'slack', name: 'Prod alerts' },
        { channelType: 'pagerduty', name: 'On call' },
      ],
    });
    expect(result.data!.notificationTaskStubs).toHaveLength(2);
    expect(result.data!.notificationTaskStubs[0]!.channelType).toBe('SLACK');
    expect(result.data!.notificationTaskStubs[0]!.taskName).toBe('prod_alerts');
    expect(result.data!.workflow).not.toHaveProperty('notificationTaskStubs');
  });

  it('should preserve muting rules as DQL comments', () => {
    const result = transformer.transform({
      name: 'W',
      mutingRules: [
        { nrql: "env = 'staging'", description: 'Silence staging noise' },
      ],
    });
    expect(result.data!.mutingRuleDql[0]).toContain('Silence staging noise');
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
    expect(result.data!.workflow.trigger.eventTrigger.isActive).toBe(true);
  });

  it('should disable the workflow when either enable flag is false', () => {
    const r1 = transformer.transformV2({
      name: 'W',
      workflowEnabled: false,
      destinationsEnabled: true,
    });
    expect(r1.data!.workflow.trigger.eventTrigger.isActive).toBe(false);

    const r2 = transformer.transformV2({
      name: 'W',
      workflowEnabled: true,
      destinationsEnabled: false,
    });
    expect(r2.data!.workflow.trigger.eventTrigger.isActive).toBe(false);
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
    expect(result.data!.workflow.trigger.eventTrigger.triggerConfiguration.value.entityTags).toEqual({
      env: 'prod',
      team: 'payments',
    });
  });

  it('should warn that a priority predicate has no trigger equivalent', () => {
    const crit = transformer.transformV2({
      name: 'C',
      issuesFilter: {
        predicates: [{ attribute: 'priority', operator: 'EQUAL', values: ['CRITICAL'] }],
      },
    });
    expect(crit.warnings.some((w) => w.includes("priority 'CRITICAL'"))).toBe(true);
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
    const tasks = Object.values(result.data!.workflow.tasks);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.input.query).toContain('fetch spans');
    expect(tasks[0]!.input.query).not.toContain('TODO');
    expect(tasks[0]!.description).toMatch(/confidence/);
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
    expect(result.data!.mutingRuleDql[0]).toContain(
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
    expect(result.data!.notificationTaskStubs).toHaveLength(2);
    expect(result.data!.notificationTaskStubs[0]!.channelType).toBe('SLACK');
    expect(result.data!.notificationTaskStubs[0]!.taskName).toBe('prod_alerts');
    expect(result.data!.workflow).not.toHaveProperty('notificationTaskStubs');
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
