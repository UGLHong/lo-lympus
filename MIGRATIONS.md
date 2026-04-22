# Database Migrations Guide

This project uses **Drizzle ORM** for database schema management and migrations.

## Quick Reference

| Task | Command |
|------|---------|
| Modify schema | Edit `server/db/schema.ts` |
| Generate migration | `npx drizzle-kit generate` |
| View migration status | `npx drizzle-kit generate` (will show "nothing to migrate" if synced) |
| Apply migrations | Start the dev server (happens automatically on startup) |

## Workflow: Adding a New Column

### 1. Modify the Schema

Edit `server/db/schema.ts`:

```typescript
export const tasks = pgTable('olympus_tasks', {
  // ... existing columns ...
  newColumn: text('new_column').notNull().default('default-value'),
});
```

### 2. Generate the Migration

```bash
npx drizzle-kit generate
```

This will:
- Compare your schema with the latest snapshot in `server/db/migrations/meta/`
- Create a new `.sql` file with the `ALTER TABLE` statements
- Update the snapshot JSON
- Update the migration journal

**Always verify the generated SQL looks correct** before proceeding.

### 3. Commit the Migration

```bash
git add server/db/migrations/
git commit -m "feat: add new_column to tasks table"
```

The pre-commit hook will verify that:
- ✅ Schema changes have corresponding migration files
- ✅ Migration files are staged and ready to commit

### 4. Apply the Migration

Start the dev server:

```bash
pnpm dev
```

Migrations run **automatically on startup**. The app will:
1. Connect to the database
2. Check `__drizzle_migrations` table for applied migrations
3. Apply any pending migrations
4. Start the server

## Important Rules

### ❌ NEVER

1. **Write migration files by hand** - Always use `npx drizzle-kit generate`
2. **Edit `.sql` migration files** - They are generated artifacts
3. **Edit `_journal.json`** - The journal is managed by drizzle-kit
4. **Run `drizzle-kit migrate` manually** - Migrations happen on app startup
5. **Skip generating migrations** - Schema changes without migrations cause runtime errors

### ✅ ALWAYS

1. **Run `npx drizzle-kit generate`** after modifying the schema
2. **Verify the generated SQL** - Read the file and ensure it makes sense
3. **Commit migration files** - They should be in version control
4. **Restart the dev server** - This applies pending migrations

## Troubleshooting

### "Column 'X' does not exist" error on startup

**Cause**: Migrations weren't applied to the database.

**Solution**:
1. Verify the migration `.sql` file exists in `server/db/migrations/`
2. Verify the journal entry exists in `_journal.json`
3. Restart the dev server: `pnpm dev`
4. If still failing, check database connection in `.env`

### "Relation 'X' already exists" error

**Cause**: The migration was partially applied. The app thinks it hasn't been applied yet.

**Solution**: Check the `__drizzle_migrations` table in the database to see what's actually been applied.

### `generate` produces no output

**Cause**: The schema hasn't changed relative to the latest snapshot.

**Explanation**: This is normal - it means your schema matches the database.

### Port already in use / Dev server hangs

**Solution**:
```bash
lsof -ti:3100 | xargs kill -9
pnpm dev
```

## Database Structure

```
server/db/
├── schema.ts                 # TypeScript schema definition
├── queries.ts                # Database query functions
├── client.ts                 # Database connection setup
├── migrate.ts                # Migration runner (called on startup)
└── migrations/
    ├── 0000_*.sql           # Initial schema creation
    ├── 0001_*.sql           # Incremental changes
    └── meta/
        ├── _journal.json     # Migration history and metadata
        └── *_snapshot.json   # Schema snapshots at each migration
```

## How Migrations Work

1. **Schema Definition** (`schema.ts`)
   - Source of truth for the database structure
   - Written in TypeScript using Drizzle ORM

2. **Generation** (`npx drizzle-kit generate`)
   - Reads `schema.ts`
   - Compares with latest snapshot in `migrations/meta/`
   - Generates `.sql` file with `ALTER TABLE` / `CREATE TABLE` statements
   - Updates snapshot and journal

3. **Application** (App startup)
   - Reads `_journal.json` to see which migrations should be applied
   - Checks `__drizzle_migrations` table to see which have been applied
   - Runs any pending migrations in order
   - Updates `__drizzle_migrations` table with completion record

## Preventing Future Issues

This project includes:

1. **Pre-commit hook** (`.git/hooks/pre-commit`)
   - Prevents committing schema changes without generating migrations
   - Prevents committing schema changes without staging migration files

2. **Automatic migration on startup** (`server/db/migrate.ts`)
   - Migrations are applied when the dev server starts
   - No manual `drizzle-kit migrate` needed
   - Errors during migration cause the app to exit (fail-fast)

3. **Type-safe schema** (`server/db/schema.ts`)
   - Schema is TypeScript, not SQL
   - Less error-prone than raw SQL
   - Full IDE autocomplete and type checking

## References

- [Drizzle ORM Documentation](https://orm.drizzle.team/)
- [Drizzle Kit Documentation](https://orm.drizzle.team/kit-docs/overview)
- Project configuration: `drizzle.config.ts`
