# Testing SyncFrame CLI Outside the Repo

This guide explains how to set up and test the SyncFrame CLI with your own configurations without committing test files to the source repository.

## Quick Start

### Option 1: Standalone Test Directory (Recommended)

1. **Create a test directory** outside the repo:

```bash
mkdir ~/syncframe-tests
cd ~/syncframe-tests
```

2. **Initialize a test project**:

```bash
npm init -y
```

3. **Link the CLI from the monorepo**:

```bash
# First, build the monorepo
cd /path/to/sync-frame
npm run build

# Link the packages
cd packages/cli
npm link

# Link dependencies
cd ../core
npm link
cd ../adapters
npm link
cd ../linkindex
npm link

# Back to your test directory
cd ~/syncframe-tests
npm link @syncframe/cli @syncframe/core @syncframe/adapter-in-memory @syncframe/linkindex-in-memory
```

4. **Create your test configuration**:

```bash
# Create syncframe.jsonc
cat > syncframe.jsonc << 'EOF'
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
EOF
```

5. **Create mapper files**:

```bash
mkdir maps

# Create source_to_dest.js
cat > maps/source_to_dest.js << 'EOF'
export default {
  toDest(srcRec) {
    return {
      id: srcRec.id,
      data: srcRec.data,
      transformed: true
    };
  },
  toSource(destRec) {
    return {
      id: destRec.id,
      data: destRec.data
    };
  }
};
EOF

# Create dest_to_source.js (inverse)
cat > maps/dest_to_source.js << 'EOF'
export default {
  toDest(destRec) {
    return {
      id: destRec.id,
      data: destRec.data
    };
  },
  toSource(srcRec) {
    return {
      id: srcRec.id,
      data: srcRec.data,
      transformed: true
    };
  }
};
EOF
```

6. **Test the configuration**:

```bash
# Validate
syncframe validate -c syncframe.jsonc

# Run
syncframe run -c syncframe.jsonc
```

### Option 2: Direct Path Execution

If you don't want to use npm link, you can run the CLI directly:

```bash
# From your test directory
npx /path/to/sync-frame/packages/cli/dist/cli.js validate -c syncframe.jsonc
npx /path/to/sync-frame/packages/cli/dist/cli.js run -c syncframe.jsonc
```

Or create an alias:

```bash
# Add to your ~/.zshrc or ~/.bashrc
alias syncframe-test="npx /path/to/sync-frame/packages/cli/dist/cli.js"

# Then use it
syncframe-test validate -c syncframe.jsonc
syncframe-test run -c syncframe.jsonc
```

### Option 3: Using npm workspaces (Advanced)

If you want to manage multiple test projects:

1. **Create a workspace root**:

```bash
mkdir ~/syncframe-workspace
cd ~/syncframe-workspace
npm init -y
```

2. **Set up workspaces** in `package.json`:

```json
{
  "name": "syncframe-workspace",
  "private": true,
  "workspaces": [
    "tests/*",
    "/path/to/sync-frame/packages/*"
  ]
}
```

3. **Create test projects**:

```bash
mkdir -p tests/my-test
cd tests/my-test
npm init -y
# Create your config and mappers here
```

## Recommended Test Directory Structure

```
~/syncframe-tests/
├── syncframe.jsonc          # Your test configuration
├── .env                      # Environment variables (gitignored)
├── maps/                     # Mapper files
│   ├── source_to_dest.js
│   └── dest_to_source.js
├── package.json              # For npm link setup
├── .gitignore               # Ignore test artifacts
└── README.md                # Your test notes
```

## .gitignore for Test Directory

Create a `.gitignore` in your test directory:

```
# Environment variables
.env
.env.local
.env.*.local

# Database files
*.db
*.db-journal
*.sqlite
*.sqlite3

# Node modules (if using npm link, you might want to keep this)
node_modules/

# Logs
*.log
npm-debug.log*

# OS files
.DS_Store
Thumbs.db
```

## Testing with Real Adapters

Once you have adapter packages (like `@syncframe/adapter-airtable`), you can test with real APIs:

1. **Create a `.env` file**:

```bash
AIRTABLE_API_KEY=your_key_here
AIRTABLE_BASE_ID=your_base_id
WEBFLOW_TOKEN=your_token_here
```

2. **Update your config**:

```jsonc
{
  "linkindex": {
    "driver": "sqlite",
    "conn": "./sync.db"
  },
  "jobs": [
    {
      "id": "airtable-webflow-sync",
      "sides": {
        "airtable": {
          "adapter": "airtable",
          "table": "Videos",
          "creds": {
            "apiKey": "${AIRTABLE_API_KEY}",
            "baseId": "${AIRTABLE_BASE_ID}"
          }
        },
        "webflow": {
          "adapter": "webflow",
          "collection": "videos",
          "creds": {
            "token": "${WEBFLOW_TOKEN}"
          }
        }
      },
      "mappings": {
        "airtable→webflow": "./maps/at_to_wf.js",
        "webflow→airtable": "./maps/wf_to_at.js"
      }
    }
  ]
}
```

3. **Install required adapters**:

```bash
npm install @syncframe/adapter-airtable @syncframe/adapter-webflow
npm install @syncframe/linkindex-sqlite
```

## Troubleshooting

### "Cannot find module '@syncframe/cli'"

**Solution:** Make sure you've run `npm link` from the CLI package directory and `npm link @syncframe/cli` from your test directory.

### "Adapter package not found"

**Solution:** 
- For in-memory adapter: `npm link @syncframe/adapter-in-memory`
- For other adapters: Install them via npm or link them from the monorepo

### "Mapper file not found"

**Solution:**
- Check that mapper paths in config are relative to the config file location
- Ensure mapper files exist and have `.js` extension
- Use absolute paths if needed: `"/absolute/path/to/mapper.js"`

### Path resolution issues

**Solution:**
- Always run the CLI from the directory containing your config file, or use absolute paths
- Check that relative paths in config are relative to the config file, not the current working directory

## Tips

1. **Start simple**: Begin with in-memory adapters before testing real API adapters
2. **Validate first**: Always run `syncframe validate` before `syncframe run`
3. **Use version control**: Keep your test directory in git (but ignore `.env` and database files)
4. **Document your tests**: Add a README.md in your test directory explaining what you're testing
5. **Test incrementally**: Add one job at a time and verify it works before adding more

## Example Test Scenarios

### Test 1: Basic In-Memory Sync

Test the simplest possible configuration with in-memory adapters.

### Test 2: Environment Variables

Test that environment variable expansion works correctly.

### Test 3: Complex Mappers

Test mapper transformations with nested objects, arrays, and field mappings.

### Test 4: Throttling

Test that rate limiting works correctly with throttle configuration.

### Test 5: Error Handling

Test retry logic and error handling with invalid configurations or network failures.

## Next Steps

Once you're comfortable testing locally:

1. Create multiple test configurations for different scenarios
2. Test with real adapter packages (when available)
3. Experiment with different LinkIndex drivers
4. Test scheduled jobs with cron expressions
5. Integrate with CI/CD pipelines (if needed)

