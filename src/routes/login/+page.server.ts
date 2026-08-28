import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { createMagicLink } from '$lib/server/auth';
import { sendMagicLinkEmail } from '$lib/server/mail';
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
	default: async ({ request }) => {
		const data = await request.formData();
		const email = String(data.get('email') ?? '')
			.trim()
			.toLowerCase();
		const redirectTo = safeRedirectTo(String(data.get('redirectTo') ?? ''));

		const result = z.email().safeParse(email);
		if (!result.success) {
			return fail(400, { error: 'Enter a valid email address.', email });
		}

		const token = await createMagicLink(email, redirectTo);
		if (!token) {
			return fail(429, { error: 'Please wait a minute before requesting another link.', email });
		}
		await sendMagicLinkEmail(email, token);

		return { sent: true, email };
	}
};
