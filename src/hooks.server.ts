import type { Handle } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getSessionUser } from '$lib/server/auth';
import { ensureStorageDirectories } from '$lib/server/storageDirectories';
import { SESSION_COOKIE } from '$lib/constants';
import { getStoragePaths } from '$lib/server/storageConfig';

const storageDirectoriesReady = ensureStorageDirectories(getStoragePaths(env.DATA_DIR).directory);

export const handle: Handle = async ({ event, resolve }) => {
	await storageDirectoriesReady;

	const token = event.cookies.get(SESSION_COOKIE);
	event.locals.user = token ? await getSessionUser(token) : null;

	return resolve(event);
};
