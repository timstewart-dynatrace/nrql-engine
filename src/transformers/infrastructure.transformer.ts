/**
 * Infrastructure Transformer - Converts New Relic Infrastructure conditions
 * to Dynatrace metric events.
 *
 * New Relic Infrastructure conditions:
 * - host_not_reporting: Host availability check
 * - process_not_running: Process monitoring
 * - infra_metric: Generic metric threshold (CPU, memory, disk, etc.)
 *
 * Dynatrace equivalents:
 * - Metric events with builtin metric keys
 * - Custom thresholds and monitoring strategies
 */

import { INFRA_METRIC_MAP, INFRA_OPERATOR_MAP } from './mapping-rules.js';
import type { TransformResult } from './types.js';
import { success, failure } from './types.js';

// ---------------------------------------------------------------------------
// Input / output interfaces
// ---------------------------------------------------------------------------

export interface NRInfraConditionInput {
  readonly name?: string;
  readonly type?: string;
  readonly enabled?: boolean;
  readonly criticalThreshold?: {
    durationMinutes?: number;
    value?: number;
  };
  readonly processWhereClause?: string;
  readonly event_type?: string;
  readonly select_value?: string;
  readonly comparison?: string;
}

export interface DTInfraMetricEvent {
  name: string;
  description: string;
  metricId: string;
  enabled: boolean;
  alertCondition: string;
  alertConditionValue: number;
  samples: number;
  violatingSamples: number;
  dealertingSamples: number;
}

// ---------------------------------------------------------------------------
// InfrastructureTransformer
// ---------------------------------------------------------------------------

export class InfrastructureTransformer {
  transform(nrCondition: NRInfraConditionInput): TransformResult<DTInfraMetricEvent[]> {
    const warnings: string[] = [];

    try {
      const conditionType = nrCondition.type ?? 'unknown';
      const conditionName = nrCondition.name ?? 'Unnamed Condition';

      let metricEvent: DTInfraMetricEvent;

      if (conditionType === 'host_not_reporting') {
        metricEvent = this.transformHostNotReporting(nrCondition, warnings);
      } else if (conditionType === 'process_not_running') {
        metricEvent = this.transformProcessNotRunning(nrCondition, warnings);
      } else if (conditionType === 'infra_metric') {
        metricEvent = this.transformInfraMetric(nrCondition, warnings);
      } else {
        warnings.push(
          `Unknown infrastructure condition type '${conditionType}' ` +
            `for '${conditionName}'. Creating placeholder.`,
        );
        metricEvent = this.createPlaceholder(nrCondition);
      }

      return success([metricEvent], warnings);
    } catch (err) {
      return failure([`Transformation error: ${String(err)}`]);
    }
  }

  transformAll(
    conditions: NRInfraConditionInput[],
  ): TransformResult<DTInfraMetricEvent[]>[] {
    return conditions.map((c) => this.transform(c));
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private transformHostNotReporting(
    condition: NRInfraConditionInput,
    _warnings: string[],
  ): DTInfraMetricEvent {
    const name = condition.name ?? 'Host Not Reporting';
    const duration = condition.criticalThreshold?.durationMinutes ?? 5;

    return {
      name: `[Migrated] ${name}`,
      description: `Migrated from NR infra condition: ${name}`,
      metricId: INFRA_METRIC_MAP.host_not_reporting as string,
      enabled: condition.enabled ?? true,
      alertCondition: 'BELOW',
      alertConditionValue: 1,
      samples: duration,
      violatingSamples: duration,
      dealertingSamples: duration * 2,
    };
  }

  private transformProcessNotRunning(
    condition: NRInfraConditionInput,
    warnings: string[],
  ): DTInfraMetricEvent {
    const name = condition.name ?? 'Process Not Running';
    const processFilter = condition.processWhereClause ?? '';

    if (processFilter) {
      warnings.push(
        `Process filter '${processFilter}' requires manual configuration ` +
          'in Dynatrace process group detection.',
      );
    }

    return {
      name: `[Migrated] ${name}`,
      description: `Migrated from NR infra condition: ${name}`,
      metricId: INFRA_METRIC_MAP.process_not_running as string,
      enabled: condition.enabled ?? true,
      alertCondition: 'BELOW',
      alertConditionValue: 1,
      samples: 3,
      violatingSamples: 3,
      dealertingSamples: 6,
    };
  }

  private transformInfraMetric(
    condition: NRInfraConditionInput,
    warnings: string[],
  ): DTInfraMetricEvent {
    const name = condition.name ?? 'Infra Metric';
    const eventType = condition.event_type ?? 'SystemSample';
    const selectValue = condition.select_value ?? '';
    const comparison = condition.comparison ?? 'above';

    const metricMap = INFRA_METRIC_MAP.infra_metric as Record<string, string>;
    let metricId = metricMap[selectValue];

    if (!metricId) {
      warnings.push(
        `Metric '${selectValue}' from '${eventType}' has no direct mapping. ` +
          'Using placeholder metric key.',
      );
      metricId = `builtin:host.${selectValue}`;
    }

    const critical = condition.criticalThreshold ?? {};
    const thresholdValue = critical.value ?? 0;
    const duration = critical.durationMinutes ?? 5;

    return {
      name: `[Migrated] ${name}`,
      description: `Migrated from NR infra condition: ${name}`,
      metricId,
      enabled: condition.enabled ?? true,
      alertCondition: INFRA_OPERATOR_MAP[comparison] ?? 'ABOVE',
      alertConditionValue: thresholdValue,
      samples: duration,
      violatingSamples: duration,
      dealertingSamples: duration * 2,
    };
  }

  private createPlaceholder(condition: NRInfraConditionInput): DTInfraMetricEvent {
    const name = condition.name ?? 'Unknown Condition';
    return {
      name: `[Migrated] ${name}`,
      description: `Migrated from NR infra condition (unknown type): ${name}`,
      metricId: 'builtin:host.cpu.usage',
      enabled: false,
      alertCondition: 'ABOVE',
      alertConditionValue: 0,
      samples: 5,
      violatingSamples: 5,
      dealertingSamples: 10,
    };
  }
}
