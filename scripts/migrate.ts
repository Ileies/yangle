import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
const sqlite = new Database(process.env.DATABASE_URL);
try {
	sqlite.exec('PRAGMA foreign_keys = ON');
	migrate(drizzle(sqlite), { migrationsFolder: `${import.meta.dir}/drizzle` });
} finally {
	sqlite.close();
}
