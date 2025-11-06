/**
 * Type definitions for JSONC configuration file format.
 * These types represent the raw configuration as it appears in the JSONC file.
 */

/**
 * LinkIndex driver configuration.
 */
export interface LinkIndexConfig {
  driver: "sqlite" | "postgres" | "in-memory";
  conn: string; // DSN or path
}

/**
 * Throttle configuration for a side (as it appears in JSONC).
 * Uses snake_case to match JSONC format.
 */
export interface ThrottleConfigRaw {
  max_reqs: number;
  interval_sec: number;
  batch_size: number;
}

/**
 * Credentials for an adapter (as it appears in JSONC).
 * Environment variables are resolved after parsing.
 */
export interface CredentialsConfig {
  [key: string]: string | number | boolean;
}

/**
 * Side configuration for a sync job (as it appears in JSONC).
 */
export interface SideConfigRaw {
  adapter: string; // e.g., "airtable", "webflow"
  table?: string;
  collection?: string;
  creds: CredentialsConfig;
  throttle?: ThrottleConfigRaw;
}

/**
 * Retry configuration (as it appears in JSONC).
 * Uses snake_case to match JSONC format.
 */
export interface RetryConfigRaw {
  max_attempts: number;
  backoff_sec: number;
  disable_job_after: number;
}

/**
 * Mappings configuration (as it appears in JSONC).
 * Keys are in format "source→destination" (e.g., "airtable→webflow").
 */
export interface MappingsConfig {
  [mappingKey: string]: string; // Path to mapper file
}

/**
 * Conflict resolution policy.
 */
export type ConflictPolicy = "last_writer_wins" | "manual";

/**
 * Individual job configuration (as it appears in JSONC).
 */
export interface JobConfigRaw {
  id: string;
  schedule?: string; // Cron expression; omit for manual/CLI-only
  sides: {
    [sideName: string]: SideConfigRaw;
  };
  mappings: MappingsConfig;
  retries?: RetryConfigRaw;
  conflict_policy?: ConflictPolicy;
}

/**
 * Complete configuration file structure (as it appears in JSONC).
 */
export interface ConfigFile {
  linkindex: LinkIndexConfig;
  jobs: JobConfigRaw[];
}

