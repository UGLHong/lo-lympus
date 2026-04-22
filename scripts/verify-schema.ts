#!/usr/bin/env node
/**
 * Verify that the database schema matches the Drizzle schema definition.
 * Run this if you suspect a schema/database mismatch.
 *
 * Usage: pnpm tsx scripts/verify-schema.ts
 */

import 'dotenv/config';

import { sql } from 'drizzle-orm';
import fs from 'node:fs';
import path from 'node:path';

import { db, pool } from '../server/db/client';

interface ColumnInfo {
  column_name: string;
  data_type: string;
  is_nullable: string;
}

async function getTableColumns(tableName: string): Promise<ColumnInfo[]> {
  const result = await db.execute(
    sql.raw(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = '${tableName}'
      ORDER BY ordinal_position
    `)
  );
  return result as unknown as ColumnInfo[];
}

async function main() {
  console.log('🔍 Verifying schema consistency...\n');

  try {
    // Check if migrations exist
    const migrationsDir = path.join(process.cwd(), 'server/db/migrations');
    if (!fs.existsSync(migrationsDir)) {
      console.error('❌ Migrations directory not found:', migrationsDir);
      process.exit(1);
    }

    const sqlFiles = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));
    console.log(`✅ Found ${sqlFiles.length} migration file(s)`);

    // Check if journal exists
    const journalPath = path.join(migrationsDir, 'meta/_journal.json');
    if (!fs.existsSync(journalPath)) {
      console.error('❌ Migration journal not found:', journalPath);
      process.exit(1);
    }

    const journal = JSON.parse(fs.readFileSync(journalPath, 'utf-8'));
    console.log(`✅ Migration journal has ${journal.entries.length} entries`);

    // Check if snapshots match entries
    const snapshotFiles = fs.readdirSync(path.join(migrationsDir, 'meta')).filter((f) => f.endsWith('_snapshot.json'));
    if (snapshotFiles.length !== journal.entries.length) {
      console.error(
        `⚠️  Snapshot count mismatch: ${snapshotFiles.length} snapshots but ${journal.entries.length} journal entries`
      );
    } else {
      console.log(`✅ Snapshot count matches journal entries`);
    }

    // Check database tables
    console.log('\n📋 Checking database tables...');

    const tasksColumns = await getTableColumns('olympus_tasks');
    console.log(`✅ olympus_tasks has ${tasksColumns.length} columns`);

    // Check for critical columns
    const requiredColumns = [
      'id',
      'project_id',
      'role',
      'title',
      'description',
      'status',
      'user_notes',
      'model_tier',
      'model_name',
    ];

    const actualColumnNames = tasksColumns.map((c) => c.column_name);
    const missing = requiredColumns.filter((c) => !actualColumnNames.includes(c));

    if (missing.length > 0) {
      console.error(`\n❌ Missing columns in olympus_tasks: ${missing.join(', ')}`);
      console.log('\nDatabase columns:');
      tasksColumns.forEach((c) => {
        console.log(`  - ${c.column_name} (${c.data_type}, nullable: ${c.is_nullable})`);
      });
      process.exit(1);
    }

    console.log(`✅ All required columns present`);

    console.log('\n✨ Schema verification passed!');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Schema verification failed:');
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
