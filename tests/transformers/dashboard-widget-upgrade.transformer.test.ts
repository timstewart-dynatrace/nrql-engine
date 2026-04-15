import { describe, it, expect, beforeEach } from 'vitest';
import { DashboardWidgetUpgradeTransformer } from '../../src/transformers/index.js';

describe('DashboardWidgetUpgradeTransformer', () => {
  let transformer: DashboardWidgetUpgradeTransformer;

  beforeEach(() => {
    transformer = new DashboardWidgetUpgradeTransformer();
  });

  it('should fail heatmap without nrql', () => {
    const result = transformer.upgradeHeatmap({
      nrql: '',
      xAxisAttribute: 'x',
      yAxisAttribute: 'y',
    });
    expect(result.success).toBe(false);
  });

  it('should emit honeycomb tile for heatmap', () => {
    const result = transformer.upgradeHeatmap({
      title: 'Request latency heatmap',
      nrql: 'SELECT average(duration) FROM Transaction FACET appName, host',
      xAxisAttribute: 'appName',
      yAxisAttribute: 'host',
    });
    expect(result.success).toBe(true);
    const t = result.data!;
    expect(t.visualization).toBe('honeycomb');
    expect(t.honeycomb.xAxis).toBe('appName');
    expect(t.honeycomb.yAxis).toBe('host');
    expect(t.honeycomb.color).toBe('byValue');
  });

  it('should emit table tile for event-feed sorted by timestamp desc', () => {
    const result = transformer.upgradeEventFeed({
      nrql: 'SELECT * FROM Transaction',
      limit: 50,
    });
    expect(result.success).toBe(true);
    const t = result.data!;
    expect(t.visualization).toBe('table');
    expect(t.table.sortBy).toBe('timestamp');
    expect(t.table.sortDirection).toBe('desc');
    expect(t.table.rowLimit).toBe(50);
  });

  it('should default event-feed limit to 100', () => {
    const result = transformer.upgradeEventFeed({
      nrql: 'SELECT * FROM Transaction',
    });
    expect(result.data!.table.rowLimit).toBe(100);
  });

  it('should fail funnel without steps', () => {
    const result = transformer.upgradeFunnel({ steps: [] });
    expect(result.success).toBe(false);
  });

  it('should emit markdown funnel + companion DQL summarize', () => {
    const result = transformer.upgradeFunnel({
      title: 'Signup funnel',
      steps: [
        { name: 'visit landing', condition: "page == 'home'" },
        { name: 'start signup', condition: "action == 'signup_start'" },
        { name: 'complete signup', condition: "action == 'signup_complete'" },
      ],
    });
    expect(result.success).toBe(true);
    expect(result.data!.tile.type).toBe('markdown');
    expect(result.data!.tile.markdown).toContain('Funnel');
    expect(result.data!.companionDql).toContain('step1 = countIf');
    expect(result.data!.companionDql).toContain('step2 = countIf');
    expect(result.data!.companionDql).toContain('step3 = countIf');
    expect(result.data!.companionDql).toContain('total = count()');
  });

  it('should warn that DT has no native funnel tile', () => {
    const result = transformer.upgradeFunnel({
      steps: [{ name: 'a', condition: 'x == 1' }],
    });
    expect(result.warnings.some((w) => w.includes('native funnel tile'))).toBe(true);
  });

  it('should carry original NRQL as comment inside emitted DQL', () => {
    const result = transformer.upgradeEventFeed({
      nrql: "SELECT * FROM Transaction WHERE appName = 'web'",
    });
    expect(result.data!.query).toContain('NRQL source');
    expect(result.data!.query).toContain('appName');
  });
});
