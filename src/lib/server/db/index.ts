import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import * as schema from './schema';
import { DATABASE_URL } from '$env/static/private';

// bun:sqlite doesn't enforce FKs by default - without this, every `onDelete: cascade` in
// schema.ts (photos/shares/decisions cleanup on album delete, sessions on user delete, etc.)
// would silently be a no-op and orphan rows instead of cascading.
const sqlite = new Database(DATABASE_URL);
sqlite.exec('PRAGMA foreign_keys = ON');

export const db = drizzle(sqlite, { schema });
