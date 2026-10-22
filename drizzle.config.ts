import { defineConfig } from 'drizzle-kit';
import { mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { getStoragePaths } from './src/lib/server/storageConfig';

const storage = getStoragePaths(process.env.STORAGE_DIR);
mkdirSync(storage.directory, { recursive: true });

export default defineConfig({
	schema: './src/lib/server/db/schema.ts',
	out: './drizzle',
	dialect: 'sqlite',
	dbCredentials: { url: pathToFileURL(storage.database).href },
	verbose: true,
	strict: true
});
