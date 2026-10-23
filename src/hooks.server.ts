import type { Handle } from '@sveltejs/kit/hooks';
import { DATA_DIR } from '$app/env/private';
import { getSessionUser } from '#lib/server/auth.js';
import { ensureStorageDirectories } from '#lib/server/storageDirectories.js';
import { SESSION_COOKIE } from '#lib/constants.js';
import { getStoragePaths } from '#lib/server/storageConfig.js';

const storageDirectoriesReady = ensureStorageDirectories(getStoragePaths(DATA_DIR).directory);

export const handle: Handle = async ({ event, resolve }) => {
	await storageDirectoriesReady;

	const token = event.cookies.get(SESSION_COOKIE);
	event.locals.user = token ? await getSessionUser(token) : null;

	return resolve(event);
};
