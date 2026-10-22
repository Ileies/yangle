import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { mkdirSync } from 'node:fs';
import { getStoragePaths } from '../src/lib/server/storageConfig';

const storage = getStoragePaths(process.env.DATA_DIR);
mkdirSync(storage.directory, { recursive: true });
const sqlite = new Database(storage.database);
try {
	sqlite.exec('PRAGMA foreign_keys = ON');
	migrate(drizzle(sqlite), { migrationsFolder: `${import.meta.dir}/drizzle` });
} finally {
	sqlite.close();
}
