import type { Handle } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getSessionUser } from '$lib/server/auth';
import { ensureStorageDirectories } from '$lib/server/storageDirectories';
import { SESSION_COOKIE } from '$lib/constants';

if (!env.STORAGE_DIR) throw new Error('STORAGE_DIR is not set');
const storageDirectoriesReady = ensureStorageDirectories(env.STORAGE_DIR);

export const handle: Handle = async ({ event, resolve }) => {
	await storageDirectoriesReady;

	const token = event.cookies.get(SESSION_COOKIE);
	event.locals.user = token ? await getSessionUser(token) : null;

	return resolve(event);
};
