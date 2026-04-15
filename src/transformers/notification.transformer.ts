/**
 * Notification Transformer — Converts New Relic notification channels
 * to Dynatrace Gen3 Workflow tasks (default) or classic Problem
 * Notification integrations (legacy opt-in).
 *
 * Gen3 Workflow tasks (default) follow the shape used by
 * dynatrace_automation_workflow resources: `{ name, action, input,
 * active, description, position }`. The `action` selector identifies
 * the task type, e.g. `dynatrace.email:email-action`.
 *
 * Supported channels (Gen3): email, slack, pagerduty, webhook,
 * opsgenie, xmatters, jira, servicenow, teams, victorops.
 *
 * Legacy (Gen2) preserves the classic problem-notification shape with
 * `{ProblemTitle}` placeholders. Channels: email, slack, pagerduty,
 * webhook (original four).
 */

import type { TransformResult } from './types.js';
import { success, failure } from './types.js';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface NRNotificationChannelInput {
  readonly name?: string;
  readonly type?: string;
  readonly active?: boolean;
  readonly properties?: Array<{ key: string; value: string }>;
}

// ---------------------------------------------------------------------------
// Gen3 output — Workflow task
// ---------------------------------------------------------------------------

/**
 * A Gen3 Dynatrace Workflow task. Bound inside a `dynatrace_automation_workflow`
 * resource (or equivalent Settings schema) as one entry in `tasks`.
 */
export interface DTWorkflowTask {
  readonly name: string;
  readonly action: string;
  readonly description: string;
  readonly active: boolean;
  readonly input: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Gen2 output — classic Problem Notification
// ---------------------------------------------------------------------------

export interface LegacyNotificationTransformData {
  integrationType: string;
  config: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function propsToMap(props?: Array<{ key: string; value: string }>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of props ?? []) {
    out[p.key] = p.value;
  }
  return out;
}

function sanitizeTaskName(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'notification_task'
  );
}

// ---------------------------------------------------------------------------
// NotificationTransformer (Gen3 default)
// ---------------------------------------------------------------------------

const SUPPORTED_CHANNELS: ReadonlySet<string> = new Set([
  'EMAIL',
  'SLACK',
  'PAGERDUTY',
  'WEBHOOK',
  'OPSGENIE',
  'XMATTERS',
  'JIRA',
  'SERVICENOW',
  'TEAMS',
  'VICTOROPS',
]);

export class NotificationTransformer {
  transform(nrChannel: NRNotificationChannelInput): TransformResult<DTWorkflowTask> {
    const type = (nrChannel.type ?? '').toUpperCase();
    const name = nrChannel.name ?? 'Unknown Channel';
    const active = nrChannel.active ?? true;
    const props = propsToMap(nrChannel.properties);
    const taskName = sanitizeTaskName(name);

    if (!SUPPORTED_CHANNELS.has(type)) {
      return failure([
        `Notification type '${type}' for '${name}' is not yet supported for Gen3 migration`,
      ]);
    }

    const warnings: string[] = [];

    switch (type) {
      case 'EMAIL':
        return success(
          {
            name: taskName,
            action: 'dynatrace.email:email-action',
            description: `[Migrated] ${name}`,
            active,
            input: {
              to: (props['recipients'] ?? '').split(',').map((s) => s.trim()).filter(Boolean),
              subject: "Dynatrace problem: {{ event()['event.name'] }}",
              body:
                "Status: {{ event()['event.status'] }}\n" +
                "Severity: {{ event()['event.category'] }}\n" +
                "Affected entity: {{ event()['affected_entity_ids'] }}",
            },
          },
          warnings,
        );

      case 'SLACK':
        warnings.push('Slack webhook URL / connection must be re-provisioned in Dynatrace.');
        return success(
          {
            name: taskName,
            action: 'dynatrace.slack:slack-action',
            description: `[Migrated] ${name}`,
            active,
            input: {
              channel: props['channel'] ?? '',
              message:
                "Dynatrace problem: {{ event()['event.name'] }} ({{ event()['event.status'] }})",
              connection: props['url'] ?? '',
            },
          },
          warnings,
        );

      case 'PAGERDUTY':
        warnings.push('PagerDuty integration key must be re-provisioned in Dynatrace.');
        return success(
          {
            name: taskName,
            action: 'dynatrace.pagerduty:pagerduty-action',
            description: `[Migrated] ${name}`,
            active,
            input: {
              integrationKey: props['service_key'] ?? '',
              severity: 'critical',
              summary: "{{ event()['event.name'] }}",
            },
          },
          warnings,
        );

      case 'WEBHOOK':
        warnings.push('Webhook payload format may need adjustment for Dynatrace event shape.');
        return success(
          {
            name: taskName,
            action: 'dynatrace.http:http-action',
            description: `[Migrated] ${name}`,
            active,
            input: {
              method: 'POST',
              url: props['base_url'] ?? '',
              headers: {},
              body:
                "{{ { problem: event()['event.name'], status: event()['event.status'] } | to_json }}",
            },
          },
          warnings,
        );

      case 'OPSGENIE':
        warnings.push('OpsGenie API key must be re-provisioned in Dynatrace.');
        return success(
          {
            name: taskName,
            action: 'dynatrace.http:http-action',
            description: `[Migrated] ${name} (OpsGenie via HTTP action)`,
            active,
            input: {
              method: 'POST',
              url: props['url'] ?? 'https://api.opsgenie.com/v2/alerts',
              headers: { Authorization: `GenieKey ${props['api_key'] ?? ''}` },
              body:
                "{{ { message: event()['event.name'], priority: 'P1' } | to_json }}",
            },
          },
          warnings,
        );

      case 'XMATTERS':
        warnings.push('xMatters webhook URL must be re-provisioned in Dynatrace.');
        return success(
          {
            name: taskName,
            action: 'dynatrace.http:http-action',
            description: `[Migrated] ${name} (xMatters via HTTP action)`,
            active,
            input: {
              method: 'POST',
              url: props['url'] ?? '',
              headers: { 'Content-Type': 'application/json' },
              body:
                "{{ { properties: { problem: event()['event.name'] } } | to_json }}",
            },
          },
          warnings,
        );

      case 'JIRA':
        warnings.push('Jira project + credentials must be re-provisioned in Dynatrace.');
        return success(
          {
            name: taskName,
            action: 'dynatrace.jira:create-issue-action',
            description: `[Migrated] ${name}`,
            active,
            input: {
              projectKey: props['project'] ?? '',
              issueType: props['issue_type'] ?? 'Incident',
              summary: "{{ event()['event.name'] }}",
              description: "Status: {{ event()['event.status'] }}",
            },
          },
          warnings,
        );

      case 'SERVICENOW':
        warnings.push('ServiceNow credentials + instance URL must be re-provisioned in Dynatrace.');
        return success(
          {
            name: taskName,
            action: 'dynatrace.servicenow:incident-action',
            description: `[Migrated] ${name}`,
            active,
            input: {
              instance: props['instance'] ?? '',
              shortDescription: "{{ event()['event.name'] }}",
              urgency: props['urgency'] ?? '2',
              impact: props['impact'] ?? '2',
            },
          },
          warnings,
        );

      case 'TEAMS':
        warnings.push('Microsoft Teams webhook URL must be re-provisioned in Dynatrace.');
        return success(
          {
            name: taskName,
            action: 'dynatrace.http:http-action',
            description: `[Migrated] ${name} (Teams webhook via HTTP action)`,
            active,
            input: {
              method: 'POST',
              url: props['url'] ?? '',
              headers: { 'Content-Type': 'application/json' },
              body:
                "{{ { text: 'Dynatrace problem: ' + event()['event.name'] } | to_json }}",
            },
          },
          warnings,
        );

      case 'VICTOROPS':
        warnings.push('VictorOps (Splunk On-Call) webhook URL must be re-provisioned.');
        return success(
          {
            name: taskName,
            action: 'dynatrace.http:http-action',
            description: `[Migrated] ${name} (VictorOps via HTTP action)`,
            active,
            input: {
              method: 'POST',
              url: props['url'] ?? '',
              headers: { 'Content-Type': 'application/json' },
              body:
                "{{ { message_type: 'CRITICAL', entity_display_name: event()['event.name'] } | to_json }}",
            },
          },
          warnings,
        );

      default:
        return failure([`Unhandled channel type '${type}'`]);
    }
  }

  transformAll(channels: NRNotificationChannelInput[]): TransformResult<DTWorkflowTask>[] {
    return channels.map((c) => this.transform(c));
  }
}

// ---------------------------------------------------------------------------
// LegacyNotificationTransformer (Gen2 opt-in)
// ---------------------------------------------------------------------------

export class LegacyNotificationTransformer {
  transform(
    nrChannel: NRNotificationChannelInput,
  ): TransformResult<LegacyNotificationTransformData> {
    const channelType = (nrChannel.type ?? '').toUpperCase();
    const channelName = nrChannel.name ?? 'Unknown Channel';
    const properties = propsToMap(nrChannel.properties);

    const legacyWarning =
      'Emitting Gen2 Problem Notification (legacy). Default output is a Gen3 Workflow task — use NotificationTransformer unless legacy parity is required.';

    switch (channelType) {
      case 'EMAIL':
        return success(
          {
            integrationType: 'email',
            config: {
              name: `[Migrated] ${nrChannel.name ?? 'Email'}`,
              recipients: (properties['recipients'] ?? '').split(','),
              subject: '[Dynatrace] {ProblemTitle}',
              body: '{ProblemDetailsText}',
              active: nrChannel.active ?? true,
            },
          },
          [legacyWarning],
        );
      case 'SLACK':
        return success(
          {
            integrationType: 'slack',
            config: {
              name: `[Migrated] ${nrChannel.name ?? 'Slack'}`,
              url: properties['url'] ?? '',
              channel: properties['channel'] ?? '',
              active: nrChannel.active ?? true,
            },
          },
          [legacyWarning, 'Slack webhook URL may need to be updated for Dynatrace'],
        );
      case 'PAGERDUTY':
        return success(
          {
            integrationType: 'pagerduty',
            config: {
              name: `[Migrated] ${nrChannel.name ?? 'PagerDuty'}`,
              serviceKey: properties['service_key'] ?? '',
              active: nrChannel.active ?? true,
            },
          },
          [legacyWarning, 'PagerDuty integration key may need to be regenerated for Dynatrace'],
        );
      case 'WEBHOOK':
        return success(
          {
            integrationType: 'webhook',
            config: {
              name: `[Migrated] ${nrChannel.name ?? 'Webhook'}`,
              url: properties['base_url'] ?? '',
              acceptAnyCertificate: false,
              active: nrChannel.active ?? true,
              headers: [],
              payload: '{ProblemDetailsJSON}',
            },
          },
          [legacyWarning, 'Webhook payload format will need adjustment for Dynatrace problem format'],
        );
      default:
        return failure([
          `Notification type '${channelType}' for '${channelName}' ` +
            'is not yet supported for automatic migration',
        ]);
    }
  }

  transformAll(
    channels: NRNotificationChannelInput[],
  ): TransformResult<LegacyNotificationTransformData>[] {
    return channels.map((c) => this.transform(c));
  }
}
