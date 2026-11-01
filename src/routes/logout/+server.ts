import { redirect } from '@sveltejs/kit';
import { destroySession } from '#lib/server/auth.js';
import { SESSION_COOKIE } from '#lib/constants.js';
import type { RequestHandler } from './$types';

// Logging out must stay POST-only (a state-changing GET is CSRF-able), so a plain
// visit just sends the user to the page that has the logout button.
export const GET: RequestHandler = () => {
	redirect(303, '/profile');
};

export const POST: RequestHandler = async ({ cookies }) => {
	const token = cookies.get(SESSION_COOKIE);
	if (token) await destroySession(token);
	cookies.delete(SESSION_COOKIE, { path: '/' });

	redirect(303, '/login');
};
