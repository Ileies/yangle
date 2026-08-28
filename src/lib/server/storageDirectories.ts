import path from 'node:path';
import { mkdir } from 'node:fs/promises';

const STORAGE_SUBDIRECTORIES = ['originals', 'previews', 'thumbnails', 'zips'] as const;

export async function ensureStorageDirectories(storageDir: string): Promise<void> {
	await Promise.all(
		STORAGE_SUBDIRECTORIES.map((directory) =>
			mkdir(path.join(storageDir, directory), { recursive: true })
		)
	);
}
