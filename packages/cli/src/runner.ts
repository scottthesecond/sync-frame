/**
 * Wire everything together: parse config, load adapters/mappers, create engines, run syncs.
 */

import * as path from "path";
import type {
  SourceAdapter,
  Mapper,
  LinkIndex,
  SideKey,
} from "@syncframe/core";
import { SyncEngine, type JobConfig, type SideConfig, type ThrottleConfig, type RetryConfig } from "@syncframe/core";
import type { ConfigFile, JobConfigRaw, SideConfigRaw, ThrottleConfigRaw, RetryConfigRaw } from "./config.js";
import { loadAdapter, loadMapper, loadLinkIndex } from "./loaders.js";

/**
 * Convert raw throttle config (snake_case) to engine config (camelCase).
 */
function convertThrottleConfig(raw: ThrottleConfigRaw): ThrottleConfig {
  return {
    maxReqs: raw.max_reqs,
    intervalSec: raw.interval_sec,
    batchSize: raw.batch_size,
  };
}

/**
 * Convert raw retry config (snake_case) to engine config (camelCase).
 */
function convertRetryConfig(raw: RetryConfigRaw): RetryConfig {
  return {
    maxAttempts: raw.max_attempts,
    backoffSec: raw.backoff_sec,
    disableJobAfter: raw.disable_job_after,
  };
}

/**
 * Create a SyncEngine instance from a job configuration.
 * @param configFile - The full config file (for resolving mapper paths)
 * @param jobConfig - Raw job configuration from JSONC
 * @param linkIndex - The LinkIndex instance to use
 * @param configFilePath - Path to the config file (for resolving relative mapper paths)
 * @returns Configured SyncEngine instance
 */
export async function createEngineForJob(
  configFile: ConfigFile,
  jobConfig: JobConfigRaw,
  linkIndex: LinkIndex,
  configFilePath: string
): Promise<SyncEngine> {
  // Get the two side names
  const sideNames = Object.keys(jobConfig.sides);
  if (sideNames.length !== 2) {
    throw new Error(`Job '${jobConfig.id}' must have exactly 2 sides`);
  }
  
  const [sideAName, sideBName] = sideNames;
  const sideAConfig = jobConfig.sides[sideAName];
  const sideBConfig = jobConfig.sides[sideBName];
  
  // Load adapters for both sides
  const adapterA = await loadAdapter(sideAConfig.adapter, sideAConfig);
  const adapterB = await loadAdapter(sideBConfig.adapter, sideBConfig);
  
  // Parse mappings to determine which mapper files to load
  const mappingKeys = Object.keys(jobConfig.mappings);
  const mappingAtoB = mappingKeys.find((key) => key.includes(`${sideAName}→${sideBName}`) || key.includes(`${sideAName}->${sideBName}`));
  const mappingBtoA = mappingKeys.find((key) => key.includes(`${sideBName}→${sideAName}`) || key.includes(`${sideBName}->${sideAName}`));
  
  if (!mappingAtoB || !mappingBtoA) {
    throw new Error(
      `Job '${jobConfig.id}': mappings must include both '${sideAName}→${sideBName}' and '${sideBName}→${sideAName}'`
    );
  }
  
  // Load mapper functions
  const mapperAtoB = await loadMapper(jobConfig.mappings[mappingAtoB], configFilePath);
  const mapperBtoA = await loadMapper(jobConfig.mappings[mappingBtoA], configFilePath);
  
  // Convert side configs to engine format
  const sideA: SideConfig = {
    adapter: adapterA,
    sideKey: sideAName,
    throttle: sideAConfig.throttle ? convertThrottleConfig(sideAConfig.throttle) : undefined,
  };
  
  const sideB: SideConfig = {
    adapter: adapterB,
    sideKey: sideBName,
    throttle: sideBConfig.throttle ? convertThrottleConfig(sideBConfig.throttle) : undefined,
  };
  
  // Convert retry config if present
  const retries: RetryConfig | undefined = jobConfig.retries
    ? convertRetryConfig(jobConfig.retries)
    : undefined;
  
  // Create engine configuration
  const engineConfig: JobConfig = {
    jobId: jobConfig.id,
    sideA,
    sideB,
    mapperAtoB,
    mapperBtoA,
    linkIndex,
    retries,
    conflictPolicy: jobConfig.conflict_policy,
  };
  
  return new SyncEngine(engineConfig);
}

/**
 * Run all jobs from a configuration file.
 * @param configFilePath - Path to the JSONC configuration file
 * @param jobIds - Optional array of job IDs to run (if not provided, runs all jobs)
 * @returns Array of run summaries
 */
export async function runJobs(
  configFilePath: string,
  jobIds?: string[]
): Promise<any[]> {
  // Load and parse config
  const { loadConfigFile, expandEnvironmentVariables } = await import("./parser.js");
  const rawConfig = await loadConfigFile(configFilePath);
  const config = expandEnvironmentVariables(rawConfig);
  
  // Load LinkIndex (shared across all jobs)
  const linkIndex = await loadLinkIndex(config.linkindex);
  
  // Create engines for each job
  const engines: Map<string, SyncEngine> = new Map();
  
  for (const jobConfig of config.jobs) {
    // Skip if jobIds filter is provided and this job is not in the list
    if (jobIds && jobIds.length > 0 && !jobIds.includes(jobConfig.id)) {
      continue;
    }
    
    try {
      const engine = await createEngineForJob(config, jobConfig, linkIndex, configFilePath);
      engines.set(jobConfig.id, engine);
    } catch (error) {
      console.error(`Failed to create engine for job '${jobConfig.id}':`, error);
      throw error;
    }
  }
  
  // Run all engines
  const results: any[] = [];
  
  for (const [jobId, engine] of engines) {
    try {
      console.log(`Running job: ${jobId}`);
      const summary = await engine.run();
      results.push(summary);
      
      // Persist run summary to LinkIndex
      await linkIndex.insertRun(summary);
      
      console.log(`Job '${jobId}' completed: ${summary.status}`);
      if (summary.summaryJson?.errors?.length > 0) {
        console.error(`Job '${jobId}' had errors:`, summary.summaryJson.errors);
      }
    } catch (error) {
      console.error(`Job '${jobId}' failed:`, error);
      throw error;
    }
  }
  
  return results;
}

