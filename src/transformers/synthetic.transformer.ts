/**
 * Synthetic Monitor Transformer - Converts New Relic synthetics to Dynatrace format.
 *
 * Mapping:
 * - New Relic Ping Monitor -> Dynatrace HTTP Monitor
 * - New Relic Simple Browser -> Dynatrace Browser Monitor (single URL)
 * - New Relic Scripted Browser -> Dynatrace Browser Monitor (scripted)
 * - New Relic Scripted API -> Dynatrace HTTP Monitor (multi-step)
 */

import {
  MONITOR_PERIOD_MAP,
  SYNTHETIC_MONITOR_TYPE_MAP,
} from './mapping-rules.js';
import type { TransformResult } from './types.js';
import { success, failure } from './types.js';

// ---------------------------------------------------------------------------
// Input / output interfaces
// ---------------------------------------------------------------------------

export interface NRSyntheticMonitorInput {
  readonly name?: string;
  readonly monitorType?: string;
  readonly monitoredUrl?: string;
  readonly period?: string;
  readonly status?: string;
  readonly script?: string;
}

export interface SyntheticTransformData {
  monitor: Record<string, unknown>;
  monitorType: string; // "HTTP" | "BROWSER"
}

// ---------------------------------------------------------------------------
// Script analysis result
// ---------------------------------------------------------------------------

export interface ScriptAnalysis {
  complexity: 'simple' | 'moderate' | 'complex';
  hasNavigation: boolean;
  hasClicks: boolean;
  hasFormInput: boolean;
  hasAssertions: boolean;
  hasCustomLogic: boolean;
  estimatedEffort: 'low' | 'medium' | 'high';
  recommendations: string[];
}

// ---------------------------------------------------------------------------
// SyntheticTransformer
// ---------------------------------------------------------------------------

export class SyntheticTransformer {
  private static readonly DEFAULT_LOCATIONS = [
    'GEOLOCATION-9999453BE4BDB3CD', // AWS US East (N. Virginia)
  ];

  private readonly availableLocations: string[];

  constructor(availableLocations?: string[]) {
    this.availableLocations = availableLocations ?? SyntheticTransformer.DEFAULT_LOCATIONS;
  }

  transform(nrMonitor: NRSyntheticMonitorInput): TransformResult<SyntheticTransformData> {
    const warnings: string[] = [];

    try {
      const monitorType = nrMonitor.monitorType ?? 'SIMPLE';
      const dtMonitorType = SYNTHETIC_MONITOR_TYPE_MAP[monitorType] ?? 'HTTP';

      let monitor: Record<string, unknown>;

      if (dtMonitorType === 'HTTP') {
        monitor = this.transformToHttpMonitor(nrMonitor, warnings);
      } else if (dtMonitorType === 'BROWSER') {
        monitor = this.transformToBrowserMonitor(nrMonitor, warnings);
      } else {
        return failure([`Unknown monitor type: ${monitorType}`]);
      }

      return success({ monitor, monitorType: dtMonitorType }, warnings);
    } catch (err) {
      return failure([`Transformation error: ${String(err)}`]);
    }
  }

  transformAll(monitors: NRSyntheticMonitorInput[]): TransformResult<SyntheticTransformData>[] {
    return monitors.map((m) => this.transform(m));
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private transformToHttpMonitor(
    nrMonitor: NRSyntheticMonitorInput,
    warnings: string[],
  ): Record<string, unknown> {
    const monitorName = nrMonitor.name ?? 'Unnamed Monitor';
    const monitoredUrl = nrMonitor.monitoredUrl ?? '';
    const period = nrMonitor.period ?? 'EVERY_15_MINUTES';
    const status = nrMonitor.status ?? 'ENABLED';

    const frequencyMin = MONITOR_PERIOD_MAP[period] ?? 15;

    const dtMonitor: Record<string, unknown> = {
      name: `[Migrated] ${monitorName}`,
      frequencyMin,
      enabled: status === 'ENABLED',
      type: 'HTTP',
      createdFrom: 'API',
      script: {
        version: '1.0',
        requests: [
          {
            description: 'Migrated from New Relic',
            url: monitoredUrl,
            method: 'GET',
            requestBody: '',
            validation: {
              rules: [
                {
                  type: 'httpStatusesList',
                  passIfFound: true,
                  value: '>=200, <400',
                },
              ],
              rulesChaining: 'or',
            },
            configuration: {
              acceptAnyCertificate: false,
              followRedirects: true,
            },
          },
        ],
      },
      locations: this.availableLocations,
      anomalyDetection: {
        outageHandling: {
          globalOutage: true,
          globalOutagePolicy: { consecutiveRuns: 1 },
          localOutage: true,
          localOutagePolicy: { affectedLocations: 1, consecutiveRuns: 1 },
        },
        loadingTimeThresholds: {
          enabled: true,
          thresholds: [{ type: 'TOTAL', valueMs: 10000 }],
        },
      },
      tags: [{ key: 'migrated-from', value: 'newrelic' }],
    };

    if (nrMonitor.monitorType === 'SCRIPT_API') {
      warnings.push(
        `Monitor '${monitorName}' was a scripted API monitor. ` +
          'The script logic needs manual recreation in Dynatrace.',
      );
    }

    return dtMonitor;
  }

  private transformToBrowserMonitor(
    nrMonitor: NRSyntheticMonitorInput,
    warnings: string[],
  ): Record<string, unknown> {
    const monitorName = nrMonitor.name ?? 'Unnamed Monitor';
    const monitoredUrl = nrMonitor.monitoredUrl ?? '';
    const period = nrMonitor.period ?? 'EVERY_15_MINUTES';
    const status = nrMonitor.status ?? 'ENABLED';
    const monitorType = nrMonitor.monitorType ?? 'BROWSER';

    const frequencyMin = MONITOR_PERIOD_MAP[period] ?? 15;

    return {
      name: `[Migrated] ${monitorName}`,
      frequencyMin,
      enabled: status === 'ENABLED',
      type: 'BROWSER',
      createdFrom: 'API',
      script: this.buildBrowserScript(monitoredUrl, monitorType, warnings),
      locations: this.availableLocations,
      anomalyDetection: {
        outageHandling: {
          globalOutage: true,
          globalOutagePolicy: { consecutiveRuns: 1 },
          localOutage: true,
          localOutagePolicy: { affectedLocations: 1, consecutiveRuns: 1 },
        },
        loadingTimeThresholds: {
          enabled: true,
          thresholds: [{ type: 'TOTAL', valueMs: 30000 }],
        },
      },
      keyPerformanceMetrics: {
        loadActionKpm: 'VISUALLY_COMPLETE',
        xhrActionKpm: 'VISUALLY_COMPLETE',
      },
      tags: [{ key: 'migrated-from', value: 'newrelic' }],
    };
  }

  private buildBrowserScript(
    url: string,
    monitorType: string,
    warnings: string[],
  ): Record<string, unknown> {
    if (monitorType === 'BROWSER' || monitorType === 'SIMPLE') {
      return {
        type: 'clickpath',
        version: '1.0',
        configuration: {
          device: { orientation: 'landscape', deviceName: 'Desktop' },
        },
        events: [
          {
            type: 'navigate',
            wait: { waitFor: 'page_complete' },
            url,
            description: `Navigate to ${url}`,
          },
        ],
      };
    }

    // Scripted browser monitors
    warnings.push(
      `Browser script for URL '${url}' was a scripted monitor. ` +
        'Complex interactions (clicks, form fills, etc.) need manual recreation. ' +
        'A basic navigation script has been created.',
    );

    return {
      type: 'clickpath',
      version: '1.0',
      configuration: {
        device: { orientation: 'landscape', deviceName: 'Desktop' },
      },
      events: [
        {
          type: 'navigate',
          wait: { waitFor: 'page_complete' },
          url,
          description: `Navigate to ${url}`,
        },
        {
          type: 'javascript',
          wait: { waitFor: 'validation' },
          javaScript: '// TODO: Add custom validation from New Relic script\nreturn true;',
          description: 'Custom validation (migrated)',
        },
      ],
    };
  }
}

// ---------------------------------------------------------------------------
// SyntheticScriptConverter (utility)
// ---------------------------------------------------------------------------

export class SyntheticScriptConverter {
  static readonly SELENIUM_COMMAND_MAP: Record<string, string> = {
    '$browser.get': 'navigate',
    '$browser.findElement': 'click',
    '$browser.wait': 'javascript',
    '.click()': 'click',
    '.sendKeys()': 'keystrokes',
  };

  static analyzeScript(script: string): ScriptAnalysis {
    const analysis: ScriptAnalysis = {
      complexity: 'simple',
      hasNavigation: false,
      hasClicks: false,
      hasFormInput: false,
      hasAssertions: false,
      hasCustomLogic: false,
      estimatedEffort: 'low',
      recommendations: [],
    };

    if (!script) return analysis;

    const scriptLower = script.toLowerCase();

    if (script.includes('$browser.get') || scriptLower.includes('navigate')) {
      analysis.hasNavigation = true;
    }
    if (script.includes('.click()') || scriptLower.includes('click')) {
      analysis.hasClicks = true;
    }
    if (scriptLower.includes('.sendkeys') || scriptLower.includes('input')) {
      analysis.hasFormInput = true;
    }
    if (scriptLower.includes('assert') || scriptLower.includes('expect')) {
      analysis.hasAssertions = true;
    }
    if (scriptLower.includes('function') || scriptLower.includes('async')) {
      analysis.hasCustomLogic = true;
    }

    const complexityFactors = [
      analysis.hasClicks,
      analysis.hasFormInput,
      analysis.hasAssertions,
      analysis.hasCustomLogic,
    ].filter(Boolean).length;

    if (complexityFactors === 0) {
      analysis.complexity = 'simple';
      analysis.estimatedEffort = 'low';
    } else if (complexityFactors <= 2) {
      analysis.complexity = 'moderate';
      analysis.estimatedEffort = 'medium';
    } else {
      analysis.complexity = 'complex';
      analysis.estimatedEffort = 'high';
    }

    if (analysis.hasNavigation) {
      analysis.recommendations.push(
        "Navigation can be directly converted to Dynatrace 'navigate' events",
      );
    }
    if (analysis.hasClicks) {
      analysis.recommendations.push(
        'Click actions need element selectors updated for Dynatrace clickpath format',
      );
    }
    if (analysis.hasFormInput) {
      analysis.recommendations.push(
        "Form inputs should be converted to 'keystrokes' events in Dynatrace",
      );
    }
    if (analysis.hasAssertions) {
      analysis.recommendations.push(
        'Assertions should be converted to Dynatrace validation rules or JavaScript events',
      );
    }
    if (analysis.hasCustomLogic) {
      analysis.recommendations.push(
        'Custom JavaScript logic may need significant refactoring for Dynatrace',
      );
    }

    return analysis;
  }
}
