#!/usr/bin/env node
/**
 * SyncFrame CLI - Main entry point
 */

import { Command } from "commander";
import * as path from "path";
import * as fs from "fs/promises";
import { config } from "dotenv";
import { runJobs } from "./runner.js";
import * as cron from "node-cron";

// Load environment variables from .env file if it exists
config();

const program = new Command();

program
  .name("syncframe")
  .description("Bidirectional sync engine for API-based data sources")
  .version("0.1.0");

program
  .command("run")
  .description("Run sync jobs once")
  .option("-c, --config <path>", "Path to JSONC configuration file", "syncframe.jsonc")
  .option("-j, --jobs <ids...>", "Specific job IDs to run (default: all jobs)")
  .action(async (options) => {
    try {
      const configPath = path.resolve(options.config);
      
      // Check if config file exists
      try {
        await fs.access(configPath);
      } catch {
        console.error(`Error: Configuration file not found: ${configPath}`);
        process.exit(1);
      }
      
      const jobIds = options.jobs && options.jobs.length > 0 ? options.jobs : undefined;
      const results = await runJobs(configPath, jobIds);
      
      console.log(`\nCompleted ${results.length} job(s)`);
      
      // Exit with error code if any job failed
      const hasFailures = results.some((r) => r.status === "failed");
      process.exit(hasFailures ? 1 : 0);
    } catch (error) {
      console.error("Error running jobs:", error);
      process.exit(1);
    }
  });

program
  .command("schedule")
  .description("Run sync jobs on their configured schedules")
  .option("-c, --config <path>", "Path to JSONC configuration file", "syncframe.jsonc")
  .action(async (options) => {
    try {
      const configPath = path.resolve(options.config);
      
      // Check if config file exists
      try {
        await fs.access(configPath);
      } catch {
        console.error(`Error: Configuration file not found: ${configPath}`);
        process.exit(1);
      }
      
      // Load config to get schedules
      const { loadConfigFile, expandEnvironmentVariables } = await import("./parser.js");
      const rawConfig = await loadConfigFile(configPath);
      const config = expandEnvironmentVariables(rawConfig);
      
      console.log(`Starting scheduled sync jobs from ${configPath}`);
      console.log(`Found ${config.jobs.length} job(s)\n`);
      
      // Schedule each job that has a schedule
      const scheduledJobs: Map<string, cron.ScheduledTask> = new Map();
      
      for (const jobConfig of config.jobs) {
        if (jobConfig.schedule) {
          try {
            // Validate cron expression
            if (!cron.validate(jobConfig.schedule)) {
              console.error(`Invalid cron expression for job '${jobConfig.id}': ${jobConfig.schedule}`);
              continue;
            }
            
            // Schedule the job
            const task = cron.schedule(jobConfig.schedule, async () => {
              console.log(`[${new Date().toISOString()}] Running scheduled job: ${jobConfig.id}`);
              try {
                await runJobs(configPath, [jobConfig.id]);
              } catch (error) {
                console.error(`[${new Date().toISOString()}] Error running job '${jobConfig.id}':`, error);
              }
            }, {
              scheduled: true,
              timezone: "UTC",
            });
            
            scheduledJobs.set(jobConfig.id, task);
            console.log(`Scheduled job '${jobConfig.id}' with cron: ${jobConfig.schedule}`);
          } catch (error) {
            console.error(`Failed to schedule job '${jobConfig.id}':`, error);
          }
        } else {
          console.log(`Job '${jobConfig.id}' has no schedule (manual/CLI-only)`);
        }
      }
      
      if (scheduledJobs.size === 0) {
        console.log("\nNo jobs with schedules found. Use 'syncframe run' to run jobs manually.");
        process.exit(0);
      }
      
      console.log(`\n${scheduledJobs.size} job(s) scheduled. Press Ctrl+C to stop.`);
      
      // Keep the process alive
      process.on("SIGINT", () => {
        console.log("\nShutting down...");
        for (const [jobId, task] of scheduledJobs) {
          task.stop();
          console.log(`Stopped schedule for job '${jobId}'`);
        }
        process.exit(0);
      });
      
      // Keep process alive
      await new Promise(() => {}); // Never resolves
    } catch (error) {
      console.error("Error starting scheduled jobs:", error);
      process.exit(1);
    }
  });

program
  .command("validate")
  .description("Validate a configuration file without running jobs")
  .option("-c, --config <path>", "Path to JSONC configuration file", "syncframe.jsonc")
  .action(async (options) => {
    try {
      const configPath = path.resolve(options.config);
      
      // Check if config file exists
      try {
        await fs.access(configPath);
      } catch {
        console.error(`Error: Configuration file not found: ${configPath}`);
        process.exit(1);
      }
      
      const { loadConfigFile, expandEnvironmentVariables } = await import("./parser.js");
      const rawConfig = await loadConfigFile(configPath);
      const config = expandEnvironmentVariables(rawConfig);
      
      console.log(`✓ Configuration file is valid: ${configPath}`);
      console.log(`  LinkIndex: ${config.linkindex.driver} (${config.linkindex.conn})`);
      console.log(`  Jobs: ${config.jobs.length}`);
      
      for (const job of config.jobs) {
        console.log(`    - ${job.id}${job.schedule ? ` (schedule: ${job.schedule})` : " (manual)"}`);
      }
      
      process.exit(0);
    } catch (error) {
      console.error("Configuration validation failed:", error);
      process.exit(1);
    }
  });

// Parse command line arguments
program.parse();

