/**
 * Configuration management for the New Relic to Dynatrace Migration Tool.
 *
 * Uses zod for schema validation and dotenv for environment variable loading.
 */

import 'dotenv/config';

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Zod Schemas
// ---------------------------------------------------------------------------

const NewRelicConfigSchema = z.object({
  apiKey: z.string().min(1, 'NEW_RELIC_API_KEY is required'),
  accountId: z.string().min(1, 'NEW_RELIC_ACCOUNT_ID is required'),
  region: z.enum(['US', 'EU']).default('US'),
});

const DynatraceConfigSchema = z.object({
  apiToken: z.string().min(1, 'DYNATRACE_API_TOKEN is required'),
  environmentUrl: z
    .string()
    .min(1, 'DYNATRACE_ENVIRONMENT_URL is required')
    .transform((v) => v.replace(/\/+$/, '')),
});

const MigrationConfigSchema = z.object({
  components: z
    .array(z.string())
    .default(['dashboards', 'alerts', 'synthetics', 'slos', 'workloads']),
  outputDir: z.string().default('./output'),
  dryRun: z.boolean().default(false),
  batchSize: z.number().int().positive().default(50),
  rateLimit: z.number().positive().default(5.0),
  continueOnError: z.boolean().default(true),
  backupBeforeImport: z.boolean().default(true),
  logLevel: z.enum(['DEBUG', 'INFO', 'WARN', 'ERROR']).default('INFO'),
});

// ---------------------------------------------------------------------------
// Inferred Types
// ---------------------------------------------------------------------------

export type NewRelicConfig = z.infer<typeof NewRelicConfigSchema>;
export type DynatraceConfig = z.infer<typeof DynatraceConfigSchema>;
export type MigrationConfig = z.infer<typeof MigrationConfigSchema>;

// ---------------------------------------------------------------------------
// Derived property helpers
// ---------------------------------------------------------------------------

/** Get the NerdGraph API endpoint based on region. */
export function getGraphqlEndpoint(config: NewRelicConfig): string {
  if (config.region === 'EU') {
    return 'https://api.eu.newrelic.com/graphql';
  }
  return 'https://api.newrelic.com/graphql';
}

/** Get the REST API base URL based on region. */
export function getRestApiBase(config: NewRelicConfig): string {
  if (config.region === 'EU') {
    return 'https://api.eu.newrelic.com/v2';
  }
  return 'https://api.newrelic.com/v2';
}

/** Get the API v2 base URL. */
export function getApiV2Base(config: DynatraceConfig): string {
  return `${config.environmentUrl}/api/v2`;
}

/** Get the Configuration API base URL. */
export function getConfigApiBase(config: DynatraceConfig): string {
  return `${config.environmentUrl}/api/config/v1`;
}

/** Get the Settings 2.0 API URL. */
export function getSettingsApi(config: DynatraceConfig): string {
  return `${config.environmentUrl}/api/v2/settings`;
}

// ---------------------------------------------------------------------------
// Environment variable parsing helpers
// ---------------------------------------------------------------------------

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return value.toLowerCase() === 'true' || value === '1';
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function parseStringArray(value: string | undefined, fallback: string[]): string[] {
  if (value === undefined || value === '') return fallback;
  return value.split(',').map((s) => s.trim());
}

// ---------------------------------------------------------------------------
// Settings singleton
// ---------------------------------------------------------------------------

export interface SettingsData {
  readonly newrelic: NewRelicConfig;
  readonly dynatrace: DynatraceConfig;
  readonly migration: MigrationConfig;
}

class Settings implements SettingsData {
  private static instance: Settings | undefined;

  readonly newrelic: NewRelicConfig;
  readonly dynatrace: DynatraceConfig;
  readonly migration: MigrationConfig;

  private constructor() {
    this.newrelic = NewRelicConfigSchema.parse({
      apiKey: process.env['NEW_RELIC_API_KEY'] ?? '',
      accountId: process.env['NEW_RELIC_ACCOUNT_ID'] ?? '',
      region: (process.env['NEW_RELIC_REGION'] ?? 'US').toUpperCase(),
    });

    this.dynatrace = DynatraceConfigSchema.parse({
      apiToken: process.env['DYNATRACE_API_TOKEN'] ?? '',
      environmentUrl: process.env['DYNATRACE_ENVIRONMENT_URL'] ?? '',
    });

    this.migration = MigrationConfigSchema.parse({
      components: parseStringArray(
        process.env['MIGRATION_COMPONENTS'],
        ['dashboards', 'alerts', 'synthetics', 'slos', 'workloads'],
      ),
      outputDir: process.env['MIGRATION_OUTPUT_DIR'] ?? './output',
      dryRun: parseBoolean(process.env['MIGRATION_DRY_RUN'], false),
      batchSize: parseNumber(process.env['MIGRATION_BATCH_SIZE'], 50),
      rateLimit: parseNumber(process.env['MIGRATION_RATE_LIMIT'], 5.0),
      continueOnError: parseBoolean(process.env['MIGRATION_CONTINUE_ON_ERROR'], true),
      backupBeforeImport: parseBoolean(process.env['MIGRATION_BACKUP'], true),
      logLevel: (process.env['LOG_LEVEL'] ?? 'INFO').toUpperCase() as
        | 'DEBUG'
        | 'INFO'
        | 'WARN'
        | 'ERROR',
    });
  }

  static getInstance(): Settings {
    if (!Settings.instance) {
      Settings.instance = new Settings();
    }
    return Settings.instance;
  }

  /** Reset singleton — for testing only. */
  static reset(): void {
    Settings.instance = undefined;
  }
}

/** Get the settings singleton. */
export function getSettings(): SettingsData {
  return Settings.getInstance();
}

/** Reset the settings singleton (for testing). */
export function resetSettings(): void {
  Settings.reset();
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Available components for migration. */
export const AVAILABLE_COMPONENTS: readonly string[] = [
  'dashboards',
  'alerts',
  'synthetics',
  'slos',
  'workloads',
  'notification_channels',
  'infrastructure',
  'log_parsing',
  'tags',
  'drop_rules',
] as const;

/** Component dependencies (must be migrated in order). */
export const COMPONENT_DEPENDENCIES: Readonly<Record<string, readonly string[]>> = {
  alerts: ['notification_channels'],
  slos: ['alerts'],
} as const;

// ---------------------------------------------------------------------------
// Schema exports (useful for tests / external validation)
// ---------------------------------------------------------------------------

export { NewRelicConfigSchema, DynatraceConfigSchema, MigrationConfigSchema };
