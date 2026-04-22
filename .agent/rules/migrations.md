# Database Migrations — Sustainable Workflow

This document ensures future schema changes follow a sustainable, error-free process.

## The Problem We Solved

Previously, the project had:
- **Fragmented migrations** across 6 files with inconsistent patterns
- **No validation** at startup to catch schema/database mismatches
- **Manual intervention** required to fix broken migrations
- **No enforcement** to prevent developers from skipping migration generation

This led to runtime errors like `column "user_notes" does not exist` that required manual recovery.

## The Solution: Three Layers

### 1. Pre-Commit Hook (Prevents Mistakes)

**File**: `.git/hooks/pre-commit`

This hook prevents committing schema changes without generating migrations:

```bash
# Running when you git commit:
if schema.ts was modified → error if migrations not staged
```

**What it catches**:
- ❌ Modifying schema without running `pnpm db:generate`
- ❌ Running `pnpm db:generate` but not staging the migration files

### 2. Migration Generation & Application (Enforces Correctness)

**Files**:
- `server/db/schema.ts` — TypeScript schema definition (source of truth)
- `server/db/migrations/` — Generated SQL files + journal
- `server/db/migrate.ts` — Automatic migration runner on app startup

**Workflow**:

1. **Developer** edits `server/db/schema.ts`
2. **Run** `pnpm db:generate`
   - Drizzle diffs the schema against the latest snapshot
   - Generates a new `.sql` migration file
   - Updates the snapshot and journal
3. **Verify** the `.sql` file looks correct
4. **Commit** all migration files to git
5. **App startup** automatically:
   - Reads the migration journal
   - Checks the `__drizzle_migrations` table
   - Applies any pending migrations
   - Fails loudly if a migration fails (fail-fast)

### 3. Verification Tools (Detects Mismatches)

**Commands**:

```bash
pnpm db:verify
```

This script checks:
- ✅ Migrations exist in `server/db/migrations/`
- ✅ Migration journal is intact
- ✅ Snapshots match journal entries
- ✅ Database has all required columns (`olympus_tasks`, etc.)
- ✅ Column types match the schema

**Use when**:
- Diagnosing "column X does not exist" errors
- After pulling fresh code with new migrations
- After manual database changes
- To confirm schema sync before deploying

## The Workflow

### Adding a Column

```bash
# 1. Edit the schema
nano server/db/schema.ts
# Add: newField: text('new_field'),

# 2. Generate the migration
pnpm db:generate

# 3. Verify the migration looks good
cat server/db/migrations/000X_*.sql

# 4. Stage and commit
git add server/db/
git commit -m "feat: add newField to tasks"

# 5. Restart dev server (migrations run automatically)
pnpm dev
```

The pre-commit hook will prevent step 4 if you forget step 2.

### Detecting Schema Mismatches

```bash
# If you see "column X does not exist" errors:
pnpm db:verify

# It will show exactly what's missing and why
# Fix options:
# a) Restart dev server to apply pending migrations
# b) Check if new migrations are staged but not committed
# c) Confirm DATABASE_URL is correct
```

## Rules (Enforced & Recommended)

### Never (Rule Violations)

- ❌ Write `.sql` migration files by hand
- ❌ Edit migration files after committing them
- ❌ Run `pnpm db:push` (use migrations instead)
- ❌ Modify `_journal.json` manually
- ❌ Commit schema changes without migration files
- ❌ Skip `pnpm db:generate` after schema changes
- ❌ Run `drizzle-kit migrate` or `drizzle-kit push` manually

### Always (Best Practices)

- ✅ Run `pnpm db:generate` immediately after schema changes
- ✅ Review generated `.sql` before committing
- ✅ Commit all migration files from `server/db/migrations/`
- ✅ Restart dev server to apply migrations
- ✅ Run `pnpm db:verify` if you suspect schema/database mismatch
- ✅ Keep migrations small and focused (one logical change per migration)

## Directory Structure

```
server/db/
├── schema.ts                    # Source of truth (TypeScript)
├── queries.ts                   # Database functions
├── client.ts                    # Connection setup
├── migrate.ts                   # Auto-runs on app startup
└── migrations/
    ├── 0000_initial_schema.sql  # Generated: CREATE TABLE
    ├── 0001_add_column.sql      # Generated: ALTER TABLE
    └── meta/
        ├── _journal.json        # Generated: migration history
        ├── 0000_snapshot.json   # Generated: schema state
        └── 0001_snapshot.json   # Generated: schema state
```

## Common Scenarios

### Scenario: "Column X already exists" error

**Cause**: Migration was partially applied; the app thinks it hasn't been applied.

**Fix**:
1. Check the database directly (if you have access)
2. Check the `__drizzle_migrations` table
3. If the migration is in the journal but DB says it's not applied, there's a mismatch
4. **Never** manually delete from `__drizzle_migrations`; instead:
   - Ask for help or consult Drizzle documentation
   - Worst case: restore from backup, don't fabricate migration state

### Scenario: Pulling code with new migrations

```bash
git pull
pnpm install
pnpm dev
# Migrations automatically apply on startup
```

### Scenario: Multiple developers modifying schema

If two developers both modify `schema.ts` and generate migrations:

1. **Pull latest migrations first**
2. **Your migration is in `0002_`, theirs in `0003_`**
3. **Drizzle applies them in order** — this is fine as long as they don't conflict
4. **If they conflict** (both modify the same column):
   - One developer needs to rebase
   - Delete their migration file
   - Re-run `pnpm db:generate` after pulling the other person's migration
   - Git will have the final migration in the right order

## Implementation Details

### How Pre-Commit Hook Works

The hook in `.git/hooks/pre-commit`:

```bash
if git diff --cached --name-only | grep -q "server/db/schema.ts"; then
  # Schema was modified
  if ! git diff --cached --name-only | grep -q "server/db/migrations"; then
    # But no migrations are staged
    echo "Error: run 'pnpm db:generate'"
    exit 1
  fi
fi
```

**To skip the hook** (not recommended):
```bash
git commit --no-verify
```

### How Auto-Migration on Startup Works

In `server/db/migrate.ts`, called from React Router startup:

1. Import `runMigrations` in the app's startup code
2. Call `await runMigrations()` before binding the server port
3. If migrations fail, the app exits with code 1 (fail-fast)
4. If migrations succeed, the app continues and logs `[migrations] all migrations applied successfully`

This is checked in the `.agent/rules/local-verification.md` to ensure migrations passed before the app is considered "started".

## Documentation

- **End-user guide**: `MIGRATIONS.md` (for developers using the system)
- **This file**: `.agent/rules/migrations.md` (agent reference)
- **AGENTS.md**: Quick reference in the boot sequence
- **README.md**: Quick setup instructions

## References

- [Drizzle ORM Migrations](https://orm.drizzle.team/docs/migrations)
- [Drizzle Kit Documentation](https://orm.drizzle.team/kit-docs/overview)
- Project config: `drizzle.config.ts`
- Schema definition: `server/db/schema.ts`
