import { redirect } from '@sveltejs/kit';
import { destroySession } from '$lib/server/auth';
import { SESSION_COOKIE } from '$lib/constants';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ cookies }) => {
	const token = cookies.get(SESSION_COOKIE);
	if (token) await destroySession(token);
	cookies.delete(SESSION_COOKIE, { path: '/' });

	redirect(303, '/login');
};
