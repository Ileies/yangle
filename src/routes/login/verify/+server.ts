import { redirect } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { consumeMagicLink } from '$lib/server/auth';
import { SESSION_COOKIE, SESSION_TTL_MS } from '$lib/constants';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, cookies }) => {
	const token = url.searchParams.get('token');
	if (!token) redirect(303, '/login?error=missing');

	const consumed = await consumeMagicLink(token);
	if (!consumed) redirect(303, '/login?error=invalid');

	cookies.set(SESSION_COOKIE, consumed.sessionToken, {
		path: '/',
		httpOnly: true,
		secure: !dev,
		sameSite: 'lax',
		maxAge: SESSION_TTL_MS / 1000
	});

	const redirectTo = consumed.redirectTo;
	redirect(
		303,
		redirectTo && redirectTo.startsWith('/') && !redirectTo.startsWith('//') ? redirectTo : '/'
	);
};
