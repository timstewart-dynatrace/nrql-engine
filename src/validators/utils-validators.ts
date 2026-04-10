/**
 * Validation utilities for migration configurations and entity structures.
 *
 * Ported from Python: utils/validators.py
 */

type ValidationResult = [valid: boolean, errors: string[]];

/**
 * Validate New Relic configuration.
 */
export function validateNewRelicConfig(config: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];

  const apiKey = (config['api_key'] as string) ?? '';
  if (!apiKey) {
    errors.push('NEW_RELIC_API_KEY is required');
  } else if (!apiKey.startsWith('NRAK-')) {
    errors.push("NEW_RELIC_API_KEY should start with 'NRAK-'");
  }

  const accountId = (config['account_id'] as string) ?? '';
  if (!accountId) {
    errors.push('NEW_RELIC_ACCOUNT_ID is required');
  } else if (!/^\d+$/.test(accountId)) {
    errors.push('NEW_RELIC_ACCOUNT_ID should be numeric');
  }

  const region = ((config['region'] as string) ?? 'US').toUpperCase();
  if (!['US', 'EU'].includes(region)) {
    errors.push("NEW_RELIC_REGION should be 'US' or 'EU'");
  }

  return [errors.length === 0, errors];
}

/**
 * Validate Dynatrace configuration.
 */
export function validateDynatraceConfig(config: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];

  const apiToken = (config['api_token'] as string) ?? '';
  if (!apiToken) {
    errors.push('DYNATRACE_API_TOKEN is required');
  } else if (!apiToken.startsWith('dt0c01.')) {
    errors.push("DYNATRACE_API_TOKEN should start with 'dt0c01.'");
  }

  const envUrl = (config['environment_url'] as string) ?? '';
  if (!envUrl) {
    errors.push('DYNATRACE_ENVIRONMENT_URL is required');
  } else {
    const urlPattern = /^https:\/\/[a-zA-Z0-9-]+\.(live|apps)\.dynatrace\.com$/;
    if (!urlPattern.test(envUrl)) {
      errors.push(
        'DYNATRACE_ENVIRONMENT_URL should be in format: https://<environment-id>.live.dynatrace.com',
      );
    }
  }

  return [errors.length === 0, errors];
}

/**
 * Validate a Dynatrace dashboard structure.
 */
export function validateDashboard(dashboard: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];

  if (!('dashboardMetadata' in dashboard)) {
    errors.push("Dashboard missing 'dashboardMetadata'");
  } else {
    const metadata = dashboard['dashboardMetadata'] as Record<string, unknown>;
    if (!('name' in metadata)) {
      errors.push("Dashboard metadata missing 'name'");
    }
  }

  if (!('tiles' in dashboard)) {
    errors.push("Dashboard missing 'tiles'");
  }

  return [errors.length === 0, errors];
}

/**
 * Validate a Dynatrace metric event structure.
 */
export function validateMetricEvent(event: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];

  if (!('summary' in event)) {
    errors.push("Metric event missing 'summary'");
  }

  if (!('monitoringStrategy' in event)) {
    errors.push("Metric event missing 'monitoringStrategy'");
  }

  return [errors.length === 0, errors];
}

/**
 * Validate a Dynatrace synthetic monitor structure.
 */
export function validateSyntheticMonitor(monitor: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];

  if (!('name' in monitor)) {
    errors.push("Synthetic monitor missing 'name'");
  }

  if (!('type' in monitor)) {
    errors.push("Synthetic monitor missing 'type'");
  } else if (!['HTTP', 'BROWSER'].includes(monitor['type'] as string)) {
    errors.push(`Invalid monitor type: ${monitor['type'] as string}`);
  }

  if (!('frequencyMin' in monitor)) {
    errors.push("Synthetic monitor missing 'frequencyMin'");
  }

  if (!('locations' in monitor) || !(monitor['locations'] as unknown[])?.length) {
    errors.push("Synthetic monitor missing 'locations'");
  }

  return [errors.length === 0, errors];
}
