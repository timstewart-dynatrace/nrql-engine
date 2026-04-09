/**
 * Notification Transformer - Converts New Relic notification channels
 * to Dynatrace problem notification integrations.
 *
 * Supports: Email, Slack, PagerDuty, Webhook.
 * Unsupported channel types produce a failed result with guidance.
 */

import type { TransformResult } from './types.js';
import { success, failure } from './types.js';

// ---------------------------------------------------------------------------
// Input / output interfaces
// ---------------------------------------------------------------------------

export interface NRNotificationChannelInput {
  readonly name?: string;
  readonly type?: string;
  readonly active?: boolean;
  readonly properties?: Array<{ key: string; value: string }>;
}

export interface NotificationTransformData {
  integrationType: string;
  config: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// NotificationTransformer
// ---------------------------------------------------------------------------

export class NotificationTransformer {
  transform(nrChannel: NRNotificationChannelInput): TransformResult<NotificationTransformData> {
    const channelType = (nrChannel.type ?? '').toUpperCase();
    const channelName = nrChannel.name ?? 'Unknown Channel';
    const properties: Record<string, string> = {};

    for (const prop of nrChannel.properties ?? []) {
      properties[prop.key] = prop.value;
    }

    switch (channelType) {
      case 'EMAIL':
        return this.transformEmail(nrChannel, properties);
      case 'SLACK':
        return this.transformSlack(nrChannel, properties);
      case 'PAGERDUTY':
        return this.transformPagerduty(nrChannel, properties);
      case 'WEBHOOK':
        return this.transformWebhook(nrChannel, properties);
      default:
        return failure([
          `Notification type '${channelType}' for '${channelName}' ` +
            'is not yet supported for automatic migration',
        ]);
    }
  }

  transformAll(
    channels: NRNotificationChannelInput[],
  ): TransformResult<NotificationTransformData>[] {
    return channels.map((c) => this.transform(c));
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private transformEmail(
    channel: NRNotificationChannelInput,
    properties: Record<string, string>,
  ): TransformResult<NotificationTransformData> {
    return success({
      integrationType: 'email',
      config: {
        name: `[Migrated] ${channel.name ?? 'Email'}`,
        recipients: (properties['recipients'] ?? '').split(','),
        subject: '[Dynatrace] {ProblemTitle}',
        body: '{ProblemDetailsText}',
        active: channel.active ?? true,
      },
    });
  }

  private transformSlack(
    channel: NRNotificationChannelInput,
    properties: Record<string, string>,
  ): TransformResult<NotificationTransformData> {
    return {
      success: true,
      data: {
        integrationType: 'slack',
        config: {
          name: `[Migrated] ${channel.name ?? 'Slack'}`,
          url: properties['url'] ?? '',
          channel: properties['channel'] ?? '',
          active: channel.active ?? true,
        },
      },
      warnings: ['Slack webhook URL may need to be updated for Dynatrace'],
      errors: [],
    };
  }

  private transformPagerduty(
    channel: NRNotificationChannelInput,
    properties: Record<string, string>,
  ): TransformResult<NotificationTransformData> {
    return {
      success: true,
      data: {
        integrationType: 'pagerduty',
        config: {
          name: `[Migrated] ${channel.name ?? 'PagerDuty'}`,
          serviceKey: properties['service_key'] ?? '',
          active: channel.active ?? true,
        },
      },
      warnings: ['PagerDuty integration key may need to be regenerated for Dynatrace'],
      errors: [],
    };
  }

  private transformWebhook(
    channel: NRNotificationChannelInput,
    properties: Record<string, string>,
  ): TransformResult<NotificationTransformData> {
    return {
      success: true,
      data: {
        integrationType: 'webhook',
        config: {
          name: `[Migrated] ${channel.name ?? 'Webhook'}`,
          url: properties['base_url'] ?? '',
          acceptAnyCertificate: false,
          active: channel.active ?? true,
          headers: [],
          payload: '{ProblemDetailsJSON}',
        },
      },
      warnings: ['Webhook payload format will need adjustment for Dynatrace problem format'],
      errors: [],
    };
  }
}
