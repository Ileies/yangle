import type { Handle } from '@sveltejs/kit';
import { STORAGE_DIR } from '$env/static/private';
import { getSessionUser } from '$lib/server/auth';
import { ensureStorageDirectories } from '$lib/server/storageDirectories';
import { SESSION_COOKIE } from '$lib/constants';

const storageDirectoriesReady = ensureStorageDirectories(STORAGE_DIR);

export const handle: Handle = async ({ event, resolve }) => {
	await storageDirectoriesReady;

	const token = event.cookies.get(SESSION_COOKIE);
	event.locals.user = token ? await getSessionUser(token) : null;

	return resolve(event);
};
