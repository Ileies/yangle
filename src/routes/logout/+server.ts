import { redirect } from '@sveltejs/kit';
import { destroySession } from '#lib/server/auth.js';
import { SESSION_COOKIE } from '#lib/constants.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ cookies }) => {
	const token = cookies.get(SESSION_COOKIE);
	if (token) await destroySession(token);
	cookies.delete(SESSION_COOKIE, { path: '/' });

	redirect(303, '/login');
};
