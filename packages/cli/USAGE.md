# SyncFrame CLI Usage Guide

This guide explains how to use the SyncFrame CLI to configure and run bidirectional sync jobs.

## Table of Contents

1. [Installation](#installation)
2. [Quick Start](#quick-start)
3. [Configuration File](#configuration-file)
4. [Commands](#commands)
5. [Testing Outside the Repo](#testing-outside-the-repo)
6. [Environment Variables](#environment-variables)
7. [Creating Mappers](#creating-mappers)
8. [Troubleshooting](#troubleshooting)

## Installation

### From the Monorepo (Development)

When working within the SyncFrame monorepo, the CLI is already linked:

```bash
# Build all packages
npm run build

# Use the CLI directly
npx syncframe --help
```

### As a Published Package (Future)

```bash
npm install -g @syncframe/cli
# or
npm install @syncframe/cli
```

## Quick Start

1. **Create a configuration file** (`syncframe.jsonc`):

```jsonc
{
  "linkindex": {
    "driver": "in-memory",
    "conn": "./syncframe.db"
  },
  "jobs": [
    {
      "id": "my-first-sync",
      "sides": {
        "source": {
          "adapter": "in-memory",
          "table": "source_data",
          "creds": {}
        },
        "dest": {
          "adapter": "in-memory",
          "table": "dest_data",
          "creds": {}
        }
      },
      "mappings": {
        "source→dest": "./maps/source_to_dest.js",
        "dest→source": "./maps/dest_to_source.js"
      }
    }
  ]
}
```

2. **Create mapper files** (see [Creating Mappers](#creating-mappers))

3. **Validate your config**:

```bash
syncframe validate -c syncframe.jsonc
```

4. **Run the sync**:

```bash
syncframe run -c syncframe.jsonc
```

## Configuration File

The configuration file uses **JSONC** (JSON with Comments) format, allowing comments and trailing commas.

### Basic Structure

```jsonc
{
  "linkindex": {
    "driver": "in-memory",  // or "sqlite", "postgres"
    "conn": "./syncframe.db"  // Connection string or path
  },
  "jobs": [
    {
      "id": "unique-job-id",
      "schedule": "*/5 * * * *",  // Optional: cron expression
      "sides": { /* ... */ },
      "mappings": { /* ... */ },
      "retries": { /* ... */ },  // Optional
      "conflict_policy": "last_writer_wins"  // Optional
    }
  ]
}
```

### LinkIndex Configuration

The `linkindex` section configures where to store sync state (links, cursors, run logs).

**Supported drivers:**
- `in-memory` - For testing (no persistence)
- `sqlite` - SQLite database (requires `@syncframe/linkindex-sqlite`)
- `postgres` - PostgreSQL database (requires `@syncframe/linkindex-postgres`)

```jsonc
{
  "linkindex": {
    "driver": "sqlite",
    "conn": "./data/syncframe.db"  // Path to SQLite file
  }
}
```

### Job Configuration

Each job defines a bidirectional sync between two data sources.

#### Required Fields

- `id` - Unique identifier for the job
- `sides` - Object with exactly 2 sides (source and destination)
- `mappings` - Object with 2 mapper file paths (`"sideA→sideB"` and `"sideB→sideA"`)

#### Optional Fields

- `schedule` - Cron expression for scheduled runs (omit for manual-only)
- `retries` - Retry configuration
- `conflict_policy` - How to handle conflicts (`"last_writer_wins"` or `"manual"`)

#### Side Configuration

Each side defines an adapter and its configuration:

```jsonc
{
  "sides": {
    "airtable": {
      "adapter": "airtable",  // Adapter package name
      "table": "Videos",  // Table/collection name (adapter-specific)
      "creds": {
        "apiKey": "${AIRTABLE_API_KEY}",
        "baseId": "app123"
      },
      "throttle": {  // Optional: rate limiting
        "max_reqs": 50,
        "interval_sec": 60,
        "batch_size": 10
      }
    },
    "webflow": {
      "adapter": "webflow",
      "collection": "videos",
      "creds": {
        "token": "${WEBFLOW_TOKEN}"
      }
    }
  }
}
```

**Throttle Configuration** (optional):
- `max_reqs` - Maximum requests per interval
- `interval_sec` - Time window in seconds
- `batch_size` - Number of records to process per batch

**Retry Configuration** (optional):
```jsonc
{
  "retries": {
    "max_attempts": 5,  // Maximum retry attempts
    "backoff_sec": 30,  // Initial backoff in seconds
    "disable_job_after": 20  // Disable job after N failures
  }
}
```

## Commands

### `syncframe run`

Run sync jobs once (manual execution).

```bash
# Run all jobs
syncframe run -c syncframe.jsonc

# Run specific jobs
syncframe run -c syncframe.jsonc --jobs job1 job2

# Use default config file name (syncframe.jsonc)
syncframe run
```

**Options:**
- `-c, --config <path>` - Path to configuration file (default: `syncframe.jsonc`)
- `-j, --jobs <ids...>` - Specific job IDs to run (default: all jobs)

### `syncframe schedule`

Run jobs on their configured schedules (daemon mode).

```bash
syncframe schedule -c syncframe.jsonc
```

This command:
- Loads all jobs with `schedule` fields
- Starts a cron scheduler for each job
- Runs continuously until interrupted (Ctrl+C)

**Note:** Only jobs with a `schedule` field will be scheduled. Jobs without schedules are manual-only.

### `syncframe validate`

Validate a configuration file without running jobs.

```bash
syncframe validate -c syncframe.jsonc
```

This command:
- Parses the JSONC file
- Validates structure and required fields
- Expands environment variables
- Reports any errors without executing syncs

## Testing Outside the Repo

To test the CLI with your own configurations without committing test files to the repo:

### Method 1: Local Test Directory

1. **Create a test directory** outside the repo:

```bash
mkdir ~/syncframe-tests
cd ~/syncframe-tests
```

2. **Link to the monorepo packages** (if testing locally):

```bash
# From your test directory, create a package.json
npm init -y

# Link the CLI and dependencies from the monorepo
cd /path/to/sync-frame
npm link

cd ~/syncframe-tests
npm link @syncframe/cli @syncframe/core @syncframe/adapter-in-memory @syncframe/linkindex-in-memory
```

3. **Create your test config** (`syncframe.jsonc`):

```jsonc
{
  "linkindex": {
    "driver": "in-memory",
    "conn": "./test.db"
  },
  "jobs": [
    {
      "id": "test-sync",
      "sides": {
        "source": {
          "adapter": "in-memory",
          "table": "test_source",
          "creds": {}
        },
        "dest": {
          "adapter": "in-memory",
          "table": "test_dest",
          "creds": {}
        }
      },
      "mappings": {
        "source→dest": "./maps/source_to_dest.js",
        "dest→source": "./maps/dest_to_source.js"
      }
    }
  ]
}
```

4. **Create mapper files** in a `maps/` directory

5. **Run your tests**:

```bash
syncframe validate -c syncframe.jsonc
syncframe run -c syncframe.jsonc
```

### Method 2: Using npm link (Development)

If you're developing the CLI and want to test it:

1. **From the monorepo root**:

```bash
cd packages/cli
npm link
```

2. **From your test directory**:

```bash
npm link @syncframe/cli
```

3. **Install dependencies** in your test directory:

```bash
npm install @syncframe/core @syncframe/adapter-in-memory @syncframe/linkindex-in-memory
```

4. **Create your test config and run** as shown above

### Method 3: Using npx with Local Path

You can run the CLI directly from the monorepo build:

```bash
# From your test directory
npx /path/to/sync-frame/packages/cli/dist/cli.js run -c syncframe.jsonc
```

Or add an alias:

```bash
alias syncframe-test="npx /path/to/sync-frame/packages/cli/dist/cli.js"
syncframe-test run -c syncframe.jsonc
```

### Recommended Test Directory Structure

```
~/syncframe-tests/
├── syncframe.jsonc          # Your test config
├── .env                      # Environment variables (gitignored)
├── maps/
│   ├── source_to_dest.js    # Mapper functions
│   └── dest_to_source.js
└── .gitignore               # Ignore test files if you version control
```

**.gitignore example:**
```
.env
*.db
*.db-journal
node_modules/
```

## Environment Variables

Environment variables can be referenced in the config using `${VAR_NAME}` syntax.

### Loading Environment Variables

The CLI automatically loads variables from a `.env` file (if present) in the current directory.

### Syntax

```jsonc
{
  "creds": {
    "apiKey": "${API_KEY}",  // Required variable
    "baseId": "${BASE_ID:-default123}"  // With default value
  }
}
```

### Example `.env` file

```bash
AIRTABLE_API_KEY=key123abc
WEBFLOW_TOKEN=token456def
BASE_ID=app789ghi
```

**Note:** `.env` files should be gitignored and never committed to version control.

## Creating Mappers

Mappers transform records between source and destination formats. Each mapper file must export a `Mapper` object or functions.

### Option 1: Default Export Object

```javascript
// maps/source_to_dest.js
export default {
  toDest(srcRec) {
    return {
      id: srcRec.id,
      title: srcRec.name,
      description: srcRec.desc,
      // ... transform fields
    };
  },
  
  toSource(destRec) {
    return {
      id: destRec.id,
      name: destRec.title,
      desc: destRec.description,
      // ... transform fields back
    };
  }
};
```

### Option 2: Named Export

```javascript
// maps/source_to_dest.js
export const mapper = {
  toDest(srcRec) { /* ... */ },
  toSource(destRec) { /* ... */ }
};
```

### Option 3: Individual Function Exports

```javascript
// maps/source_to_dest.js
export function toDest(srcRec) {
  // Transform source → destination
  return { /* ... */ };
}

export function toSource(destRec) {
  // Transform destination → source
  return { /* ... */ };
}
```

### Mapper Best Practices

- **Idempotent**: Mappers should produce the same output for the same input
- **Bidirectional**: `toDest` and `toSource` should be inverse operations when possible
- **Handle missing fields**: Use default values or ignore missing fields gracefully
- **Type safety**: Consider using TypeScript for mapper files

## Troubleshooting

### "Adapter package not found"

**Error:** `Adapter package '@syncframe/adapter-<name>' not found`

**Solution:** Install the required adapter package:
```bash
npm install @syncframe/adapter-<name>
```

### "Mapper file not found"

**Error:** `Mapper file not found: ./maps/source_to_dest.js`

**Solution:** 
- Check that the mapper file path is correct (relative to config file)
- Verify the file exists
- Ensure the file extension is `.js` or `.mjs`

### "Configuration must include 'jobs' array"

**Error:** Configuration validation failed

**Solution:**
- Ensure your JSONC file has a valid `jobs` array
- Check for JSON syntax errors (missing commas, brackets, etc.)
- Use `syncframe validate` to see detailed error messages

### "Job must have exactly 2 sides"

**Error:** Job configuration validation failed

**Solution:**
- Each job must have exactly 2 sides (source and destination)
- Check that the `sides` object has exactly 2 keys

### "Mappings must include both A→B and B→A"

**Error:** Mapper configuration validation failed

**Solution:**
- Ensure you have mappings for both directions
- Use the format `"sideA→sideB"` or `"sideA->sideB"`
- Both side names must match the keys in the `sides` object

### Environment variables not expanding

**Solution:**
- Ensure variable names match exactly (case-sensitive)
- Check that `.env` file is in the same directory as where you run the CLI
- Use `${VAR:-default}` syntax if you want defaults
- Verify the variable is set: `echo $VAR_NAME`

### Module import errors

**Error:** `Cannot find module` or `ERR_MODULE_NOT_FOUND`

**Solution:**
- Ensure all required packages are installed
- For ES modules, use `.js` extension in imports (even for TypeScript files)
- Check that the package is properly built (`npm run build`)

## Additional Resources

- See `examples/` directory for example configurations
- Check the master plan (`masterplan.md`) for architecture details
- Review adapter package documentation for adapter-specific options

