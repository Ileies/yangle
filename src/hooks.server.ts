import type { Handle } from '@sveltejs/kit';
import { getSessionUser } from '$lib/server/auth';
import { SESSION_COOKIE } from '$lib/constants';

export const handle: Handle = async ({ event, resolve }) => {
	const token = event.cookies.get(SESSION_COOKIE);
	event.locals.user = token ? await getSessionUser(token) : null;

	return resolve(event);
};
