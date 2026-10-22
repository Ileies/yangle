import { Database } from 'bun:sqlite';
import { chmodSync, chownSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Executed through bun --eval on the target. Keep imports limited to built-in modules.
export function deployDatabase(action: 'snapshot' | 'install', token: string): void {
	if (!/^[a-f0-9-]+$/.test(token)) throw new Error('Invalid deployment token');
	const directory = resolve(process.env.DATA_DIR || 'storage');
	const database = join(directory, 'local.db');
	const staging = join(directory, `.deploy-${token}`);
	mkdirSync(directory, { recursive: true });
	if (action === 'snapshot') {
		mkdirSync(staging, { mode: 0o700 });
		const sqlite = new Database(database);
		try {
			// SQLite includes committed WAL data in this standalone backup.
			sqlite.query('VACUUM INTO ?').run(join(staging, 'original.db'));
		} finally {
			sqlite.close();
		}
		console.log(JSON.stringify(staging));
	} else {
		const candidate = join(staging, 'migrated.db');
		const sqlite = new Database(candidate, { readonly: true, create: false });
		try {
			const integrity = sqlite.query('PRAGMA integrity_check').values();
			if (integrity.length !== 1 || integrity[0][0] !== 'ok') {
				throw new Error('Uploaded database failed integrity check');
			}
			if (sqlite.query('PRAGMA foreign_key_check').all().length) {
				throw new Error('Uploaded database failed foreign key check');
			}
		} finally {
			sqlite.close();
		}
		// Clear the old database's WAL before replacing its main file.
		const original = new Database(database, { readwrite: true, create: false });
		try {
			const checkpoint = original.query('PRAGMA wal_checkpoint(TRUNCATE)').get() as {
				busy: number;
			};
			if (checkpoint.busy) throw new Error('Production database is still in use');
		} finally {
			original.close();
		}
		if (['-wal', '-shm', '-journal'].some((suffix) => existsSync(database + suffix))) {
			throw new Error('Production SQLite sidecars remain; stop all database connections');
		}
		const attributes = statSync(database);
		chownSync(candidate, attributes.uid, attributes.gid);
		chmodSync(candidate, attributes.mode & 0o777);
		renameSync(candidate, database);
		console.log(`Previous database retained at ${join(staging, 'original.db')}`);
	}
}
