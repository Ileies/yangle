import { fail, redirect } from '@sveltejs/kit';
import { createAlbum } from '$lib/server/albums';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(303, '/login');
};

export const actions: Actions = {
	default: async ({ request, locals }) => {
		if (!locals.user) redirect(303, '/login');

		const data = await request.formData();
		const name = String(data.get('name') ?? '').trim();
		if (!name) return fail(400, { error: 'Give the album a name.' });

		const album = await createAlbum(locals.user.email, name);
		redirect(303, `/albums/${album.id}`);
	}
};
