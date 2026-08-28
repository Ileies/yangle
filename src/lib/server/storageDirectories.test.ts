import { expect, test } from 'bun:test';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { ensureStorageDirectories } from './storageDirectories';

test('creates every storage directory and is safe to run again', async () => {
	const storageDir = await mkdtemp(path.join(os.tmpdir(), 'yangle-storage-'));

	try {
		await ensureStorageDirectories(storageDir);
		await ensureStorageDirectories(storageDir);

		expect((await readdir(storageDir)).sort()).toEqual([
			'originals',
			'previews',
			'thumbnails',
			'zips'
		]);
	} finally {
		await rm(storageDir, { recursive: true });
	}
});
