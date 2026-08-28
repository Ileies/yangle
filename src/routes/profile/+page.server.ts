import { fail, redirect } from '@sveltejs/kit';
import { destroyAllSessions, updateDisplayName } from '$lib/server/auth';
import { SESSION_COOKIE } from '$lib/constants';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(303, '/login');
	return { user: locals.user };
};

export const actions: Actions = {
	updateName: async ({ request, locals }) => {
		if (!locals.user) redirect(303, '/login');

		const data = await request.formData();
		const displayName = String(data.get('displayName') ?? '').trim();
		if (!displayName) return fail(400, { error: 'Display name cannot be empty.' });

		await updateDisplayName(locals.user.email, displayName);
		return { updated: true };
	},

	logoutEverywhere: async ({ cookies, locals }) => {
		if (!locals.user) redirect(303, '/login');

		await destroyAllSessions(locals.user.email);
		cookies.delete(SESSION_COOKIE, { path: '/' });
		redirect(303, '/login');
	}
};
