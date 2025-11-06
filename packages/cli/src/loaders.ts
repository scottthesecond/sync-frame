/**
 * Dynamic loading of adapters, mappers, and link indexes.
 */

import * as path from "path";
import * as url from "url";
import type { SourceAdapter, Mapper, LinkIndex } from "@syncframe/core";
import type { SideConfigRaw, CredentialsConfig, LinkIndexConfig } from "./config.js";

/**
 * Load an adapter instance based on the adapter name and configuration.
 * @param adapterName - Name of the adapter (e.g., "airtable", "webflow", "in-memory")
 * @param sideConfig - Side configuration containing credentials and options
 * @returns Instantiated adapter
 * @throws Error if adapter cannot be loaded or instantiated
 */
export async function loadAdapter(
  adapterName: string,
  sideConfig: SideConfigRaw
): Promise<SourceAdapter> {
  try {
    // Try to load from @syncframe/adapter-<name> package
    const packageName = `@syncframe/adapter-${adapterName}`;
    
    // Use dynamic import to load the adapter module
    const adapterModule = await import(packageName);
    
    // Look for exported adapter class or factory function
    // Common patterns:
    // 1. Default export (e.g., export default class AirtableAdapter)
    // 2. Named export matching adapter name (e.g., export class AirtableAdapter)
    // 3. Named export with "Adapter" suffix (e.g., export class AirtableAdapter)
    // 4. Factory function
    
    let AdapterClass: any = null;
    
    // Try default export
    if (adapterModule.default) {
      AdapterClass = adapterModule.default;
    }
    // Try named export matching adapter name (capitalized)
    else if (adapterModule[capitalize(adapterName)]) {
      AdapterClass = adapterModule[capitalize(adapterName)];
    }
    // Try named export with "Adapter" suffix
    else if (adapterModule[capitalize(adapterName) + "Adapter"]) {
      AdapterClass = adapterModule[capitalize(adapterName) + "Adapter"];
    }
    // Try common export names
    else if (adapterModule.Adapter) {
      AdapterClass = adapterModule.Adapter;
    }
    // Try InMemoryAdapter (special case with hyphen)
    else if (adapterName === "in-memory" && adapterModule.InMemoryAdapter) {
      AdapterClass = adapterModule.InMemoryAdapter;
    }
    
    if (!AdapterClass) {
      const exports = Object.keys(adapterModule).join(", ");
      throw new Error(
        `Could not find adapter class in ${packageName}. ` +
        `Available exports: ${exports || "none"}`
      );
    }
    
    // Determine constructor arguments based on adapter requirements
    // Most adapters will need credentials and possibly table/collection info
    const adapterOptions: any = {
      ...sideConfig.creds,
    };
    
    // Add table/collection if specified
    if (sideConfig.table) {
      adapterOptions.table = sideConfig.table;
    }
    if (sideConfig.collection) {
      adapterOptions.collection = sideConfig.collection;
    }
    
    // Instantiate the adapter
    // Check if it's a class or a factory function
    if (typeof AdapterClass === "function") {
      if (AdapterClass.prototype && AdapterClass.prototype.constructor) {
        // It's a class, use new
        return new AdapterClass(adapterOptions);
      } else {
        // It's a factory function, call it
        return AdapterClass(adapterOptions);
      }
    } else {
      throw new Error(`Adapter from ${packageName} is not a class or factory function`);
    }
  } catch (error) {
    if (error instanceof Error) {
      // Check if it's a module not found error
      const nodeError = error as Error & { code?: string };
      if (error.message.includes("Cannot find module") || nodeError.code === "MODULE_NOT_FOUND") {
        throw new Error(
          `Adapter package '@syncframe/adapter-${adapterName}' not found. ` +
          `Install it with: npm install @syncframe/adapter-${adapterName}`
        );
      }
      throw new Error(`Failed to load adapter '${adapterName}': ${error.message}`);
    }
    throw error;
  }
}

/**
 * Load a mapper function from a file path.
 * @param mapperPath - Path to the mapper file (relative to config file or absolute)
 * @param configFilePath - Path to the config file (for resolving relative paths)
 * @returns Mapper object
 * @throws Error if mapper cannot be loaded
 */
export async function loadMapper(
  mapperPath: string,
  configFilePath: string
): Promise<Mapper> {
  try {
    // Resolve the mapper path relative to the config file
    const resolvedPath = path.isAbsolute(mapperPath)
      ? mapperPath
      : path.resolve(path.dirname(configFilePath), mapperPath);
    
    // Convert to file:// URL for ES module import
    const fileUrl = url.pathToFileURL(resolvedPath).href;
    
    // Dynamic import the mapper module
    const mapperModule = await import(fileUrl);
    
    // Look for mapper export
    // Common patterns:
    // 1. Default export (export default { toDest, toSource })
    // 2. Named export (export const mapper = { toDest, toSource })
    // 3. Individual function exports (export function toDest, export function toSource)
    
    let mapper: Mapper | null = null;
    
    // Try default export
    if (mapperModule.default) {
      const defaultExport = mapperModule.default;
      if (
        typeof defaultExport.toDest === "function" &&
        typeof defaultExport.toSource === "function"
      ) {
        mapper = defaultExport;
      }
    }
    
    // Try named export "mapper"
    if (!mapper && mapperModule.mapper) {
      const mapperExport = mapperModule.mapper;
      if (
        typeof mapperExport.toDest === "function" &&
        typeof mapperExport.toSource === "function"
      ) {
        mapper = mapperExport;
      }
    }
    
    // Try individual function exports
    if (!mapper && mapperModule.toDest && mapperModule.toSource) {
      if (
        typeof mapperModule.toDest === "function" &&
        typeof mapperModule.toSource === "function"
      ) {
        mapper = {
          toDest: mapperModule.toDest,
          toSource: mapperModule.toSource,
        };
      }
    }
    
    if (!mapper) {
      const exports = Object.keys(mapperModule).join(", ");
      throw new Error(
        `Mapper file '${mapperPath}' does not export a valid mapper. ` +
        `Expected an object with 'toDest' and 'toSource' functions, or individual exports. ` +
        `Available exports: ${exports || "none"}`
      );
    }
    
    return mapper;
  } catch (error) {
    if (error instanceof Error) {
      const nodeError = error as Error & { code?: string };
      if (error.message.includes("Cannot find module") || nodeError.code === "MODULE_NOT_FOUND") {
        throw new Error(`Mapper file not found: ${mapperPath}`);
      }
      throw new Error(`Failed to load mapper from '${mapperPath}': ${error.message}`);
    }
    throw error;
  }
}

/**
 * Load a LinkIndex instance based on the configuration.
 * @param linkIndexConfig - LinkIndex configuration
 * @returns Instantiated LinkIndex
 * @throws Error if LinkIndex cannot be loaded or instantiated
 */
export async function loadLinkIndex(
  linkIndexConfig: LinkIndexConfig
): Promise<LinkIndex> {
  try {
    const driver = linkIndexConfig.driver;
    const packageName = `@syncframe/linkindex-${driver}`;
    
    // Use dynamic import to load the linkindex module
    const linkIndexModule = await import(packageName);
    
    // Look for exported LinkIndex class
    let LinkIndexClass: any = null;
    
    // Try default export
    if (linkIndexModule.default) {
      LinkIndexClass = linkIndexModule.default;
    }
    // Try named export matching driver name (capitalized)
    else if (linkIndexModule[capitalize(driver.replace("-", ""))]) {
      LinkIndexClass = linkIndexModule[capitalize(driver.replace("-", ""))];
    }
    // Try named export with "LinkIndex" suffix
    else if (linkIndexModule[capitalize(driver.replace("-", "")) + "LinkIndex"]) {
      LinkIndexClass = linkIndexModule[capitalize(driver.replace("-", "")) + "LinkIndex"];
    }
    // Try InMemoryLinkIndex (special case)
    else if (driver === "in-memory" && linkIndexModule.InMemoryLinkIndex) {
      LinkIndexClass = linkIndexModule.InMemoryLinkIndex;
    }
    // Try common export names
    else if (linkIndexModule.LinkIndex) {
      LinkIndexClass = linkIndexModule.LinkIndex;
    }
    
    if (!LinkIndexClass) {
      const exports = Object.keys(linkIndexModule).join(", ");
      throw new Error(
        `Could not find LinkIndex class in ${packageName}. ` +
        `Available exports: ${exports || "none"}`
      );
    }
    
    // Determine constructor arguments
    // Most LinkIndex implementations will need a connection string/path
    const linkIndexOptions: any = {
      conn: linkIndexConfig.conn,
    };
    
    // Instantiate the LinkIndex
    if (typeof LinkIndexClass === "function") {
      if (LinkIndexClass.prototype && LinkIndexClass.prototype.constructor) {
        // It's a class, use new
        return new LinkIndexClass(linkIndexOptions);
      } else {
        // It's a factory function, call it
        return LinkIndexClass(linkIndexOptions);
      }
    } else {
      throw new Error(`LinkIndex from ${packageName} is not a class or factory function`);
    }
  } catch (error) {
    if (error instanceof Error) {
      const nodeError = error as Error & { code?: string };
      if (error.message.includes("Cannot find module") || nodeError.code === "MODULE_NOT_FOUND") {
        throw new Error(
          `LinkIndex package '@syncframe/linkindex-${linkIndexConfig.driver}' not found. ` +
          `Install it with: npm install @syncframe/linkindex-${linkIndexConfig.driver}`
        );
      }
      throw new Error(
        `Failed to load LinkIndex '${linkIndexConfig.driver}': ${error.message}`
      );
    }
    throw error;
  }
}

/**
 * Capitalize the first letter of a string.
 */
function capitalize(str: string): string {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

