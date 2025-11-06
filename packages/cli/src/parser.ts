/**
 * JSONC configuration file parsing and environment variable expansion.
 */

import * as fs from "fs/promises";
import * as path from "path";
import { parse as parseJsonc, ParseError } from "jsonc-parser";
import { ConfigFile, JobConfigRaw, CredentialsConfig } from "./config.js";

/**
 * Load and parse a JSONC configuration file.
 * @param configPath - Path to the JSONC configuration file
 * @returns Parsed configuration object
 * @throws Error if file cannot be read or parsed
 */
export async function loadConfigFile(configPath: string): Promise<ConfigFile> {
  const fullPath = path.resolve(configPath);
  
  try {
    const content = await fs.readFile(fullPath, "utf-8");
    const errors: ParseError[] = [];
    
    // Parse JSONC (supports comments)
    const config = parseJsonc(content, errors, {
      allowTrailingComma: true,
      disallowComments: false,
    });
    
    if (errors.length > 0) {
      const errorMessages = errors.map((e) => {
        return `Error at offset ${e.offset}: ${e.error === 1 ? "Invalid symbol" : e.error === 2 ? "Invalid number format" : e.error === 3 ? "Property name expected" : e.error === 4 ? "Value expected" : e.error === 5 ? "Colon expected" : e.error === 6 ? "Comma expected" : e.error === 7 ? "Closing brace expected" : e.error === 8 ? "Closing bracket expected" : e.error === 9 ? "End of file expected" : "Unknown error"}`;
      });
      throw new Error(
        `Failed to parse JSONC file: ${errorMessages.join(", ")}`
      );
    }
    
    if (!config || typeof config !== "object") {
      throw new Error("Configuration file must contain an object");
    }
    
    // Basic validation
    validateConfig(config);
    
    return config as ConfigFile;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to load config from ${fullPath}: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Expand environment variables in a string.
 * Supports ${VAR} and ${VAR:-default} syntax.
 * @param value - String that may contain environment variable references
 * @returns Expanded string
 */
function expandEnvVar(value: string): string {
  return value.replace(/\$\{([^}:-]+)(?::-(.+))?\}/g, (match, varName, defaultValue) => {
    const envValue = process.env[varName];
    if (envValue !== undefined) {
      return envValue;
    }
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    // If variable not found and no default, keep the original reference
    // This allows for validation later if needed
    return match;
  });
}

/**
 * Recursively expand environment variables in an object.
 * @param obj - Object that may contain environment variable references
 * @returns Object with environment variables expanded
 */
function expandEnvVars<T>(obj: T): T {
  if (typeof obj === "string") {
    return expandEnvVar(obj) as T;
  }
  
  if (Array.isArray(obj)) {
    return obj.map((item) => expandEnvVars(item)) as T;
  }
  
  if (obj && typeof obj === "object") {
    const expanded: any = {};
    for (const [key, value] of Object.entries(obj)) {
      expanded[key] = expandEnvVars(value);
    }
    return expanded as T;
  }
  
  return obj;
}

/**
 * Expand environment variables in the configuration.
 * @param config - Raw configuration object
 * @returns Configuration with environment variables expanded
 */
export function expandEnvironmentVariables(config: ConfigFile): ConfigFile {
  return expandEnvVars(config);
}

/**
 * Validate the structure of the configuration object.
 * @param config - Configuration object to validate
 * @throws Error if configuration is invalid
 */
function validateConfig(config: any): void {
  if (!config.linkindex) {
    throw new Error("Configuration must include 'linkindex' section");
  }
  
  if (!config.linkindex.driver) {
    throw new Error("LinkIndex configuration must include 'driver'");
  }
  
  if (!config.linkindex.conn) {
    throw new Error("LinkIndex configuration must include 'conn'");
  }
  
  if (!Array.isArray(config.jobs)) {
    throw new Error("Configuration must include 'jobs' array");
  }
  
  for (const job of config.jobs) {
    validateJobConfig(job);
  }
}

/**
 * Validate a single job configuration.
 * @param job - Job configuration to validate
 * @throws Error if job configuration is invalid
 */
function validateJobConfig(job: any): void {
  if (!job.id || typeof job.id !== "string") {
    throw new Error("Each job must have a string 'id'");
  }
  
  if (!job.sides || typeof job.sides !== "object") {
    throw new Error(`Job '${job.id}' must have a 'sides' object`);
  }
  
  const sideNames = Object.keys(job.sides);
  if (sideNames.length !== 2) {
    throw new Error(`Job '${job.id}' must have exactly 2 sides, found ${sideNames.length}`);
  }
  
  for (const [sideName, sideConfig] of Object.entries(job.sides)) {
    validateSideConfig(job.id, sideName, sideConfig as any);
  }
  
  if (!job.mappings || typeof job.mappings !== "object") {
    throw new Error(`Job '${job.id}' must have a 'mappings' object`);
  }
  
  const mappingKeys = Object.keys(job.mappings);
  if (mappingKeys.length !== 2) {
    throw new Error(
      `Job '${job.id}' must have exactly 2 mappings (A→B and B→A), found ${mappingKeys.length}`
    );
  }
}

/**
 * Validate a side configuration.
 * @param jobId - Job ID for error messages
 * @param sideName - Side name for error messages
 * @param sideConfig - Side configuration to validate
 * @throws Error if side configuration is invalid
 */
function validateSideConfig(jobId: string, sideName: string, sideConfig: any): void {
  if (!sideConfig.adapter || typeof sideConfig.adapter !== "string") {
    throw new Error(`Job '${jobId}', side '${sideName}': must have 'adapter' string`);
  }
  
  if (!sideConfig.creds || typeof sideConfig.creds !== "object") {
    throw new Error(`Job '${jobId}', side '${sideName}': must have 'creds' object`);
  }
  
  // Throttle is optional, but if present must be valid
  if (sideConfig.throttle) {
    if (typeof sideConfig.throttle.max_reqs !== "number") {
      throw new Error(
        `Job '${jobId}', side '${sideName}': throttle.max_reqs must be a number`
      );
    }
    if (typeof sideConfig.throttle.interval_sec !== "number") {
      throw new Error(
        `Job '${jobId}', side '${sideName}': throttle.interval_sec must be a number`
      );
    }
    if (typeof sideConfig.throttle.batch_size !== "number") {
      throw new Error(
        `Job '${jobId}', side '${sideName}': throttle.batch_size must be a number`
      );
    }
  }
}

