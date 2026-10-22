import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { resolve } from 'node:path';

const database = process.argv[2];
if (!database) throw new Error('Usage: bun scripts/migrate.ts DATABASE');
const sqlite = new Database(database);
try {
	sqlite.exec('PRAGMA foreign_keys = ON');
	migrate(drizzle(sqlite), { migrationsFolder: resolve(import.meta.dir, '../drizzle') });
	const integrity = sqlite.query('PRAGMA integrity_check').values();
	if (integrity.length !== 1 || integrity[0][0] !== 'ok') {
		throw new Error(`Database integrity check failed: ${JSON.stringify(integrity)}`);
	}
	if (sqlite.query('PRAGMA foreign_key_check').all().length) {
		throw new Error('Database foreign key check failed');
	}
	const checkpoint = sqlite.query('PRAGMA wal_checkpoint(TRUNCATE)').get() as { busy: number };
	if (checkpoint.busy) throw new Error('Could not checkpoint migrated database');
} finally {
	sqlite.close();
}
