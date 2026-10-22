import path from 'node:path';

export function getStoragePaths(storageDir?: string) {
	const directory = path.resolve(storageDir || 'storage/');
	return { directory, database: path.join(directory, 'local.db') };
}
