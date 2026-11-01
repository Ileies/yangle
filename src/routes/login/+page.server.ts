import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { dev } from '$app/env';
import { createMagicLink, consumeLoginCode } from '#lib/server/auth.js';
import { sendMagicLinkEmail } from '#lib/server/mail.js';
import { LOGIN_CODE_LENGTH, SESSION_COOKIE, SESSION_TTL_MS } from '#lib/constants.js';
import type { Actions, PageServerLoad } from './$types';

const ERROR_MESSAGES: Record<string, string> = {
	missing: 'Missing login link. Request a new one below.',
	invalid: 'That link is invalid or has expired. Request a new one below.'
};

// Only ever a same-origin, single-leading-slash path (e.g. an invite link) - never an absolute
// URL, which would make this an open redirect.
function safeRedirectTo(value: string | null): string | null {
	if (!value || !value.startsWith('/') || value.startsWith('//')) return null;
	return value;
}

export const load: PageServerLoad = async ({ locals, url }) => {
	const redirectTo = safeRedirectTo(url.searchParams.get('redirectTo'));
	if (locals.user) redirect(303, redirectTo ?? '/');

	const error = url.searchParams.get('error');
	return { error: error ? (ERROR_MESSAGES[error] ?? null) : null, redirectTo };
};

export const actions: Actions = {
	send: async ({ request }) => {
		const data = await request.formData();
		const email = String(data.get('email') ?? '')
			.trim()
			.toLowerCase();
		const redirectTo = safeRedirectTo(String(data.get('redirectTo') ?? ''));

		const result = z.email().safeParse(email);
		if (!result.success) {
			return fail(400, { error: 'Enter a valid email address.', email });
		}

		const link = await createMagicLink(email, redirectTo);
		if (!link) {
			return fail(429, { error: 'Please wait a minute before requesting another link.', email });
		}
		await sendMagicLinkEmail(email, link.token, link.code);

		return { sent: true, email };
	},

	code: async ({ request, cookies }) => {
		const data = await request.formData();
		const email = String(data.get('email') ?? '')
			.trim()
			.toLowerCase();
		const code = String(data.get('code') ?? '').replace(/\s/g, '');

		if (!new RegExp(`^\\d{${LOGIN_CODE_LENGTH}}$`).test(code)) {
			return fail(400, {
				sent: true,
				email,
				codeError: `Enter the ${LOGIN_CODE_LENGTH}-digit code from the email.`
			});
		}

		const consumed = await consumeLoginCode(email, code);
		if (!consumed) {
			return fail(400, {
				sent: true,
				email,
				codeError: 'That code is wrong or has expired. Request a new login link to try again.'
			});
		}

		cookies.set(SESSION_COOKIE, consumed.sessionToken, {
			path: '/',
			httpOnly: true,
			secure: !dev,
			sameSite: 'lax',
			maxAge: SESSION_TTL_MS / 1000
		});
		redirect(303, safeRedirectTo(consumed.redirectTo) ?? '/');
	}
};
