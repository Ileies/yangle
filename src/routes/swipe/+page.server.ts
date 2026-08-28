import { redirect } from '@sveltejs/kit';
import { listAlbumsFor } from '$lib/server/albums';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(303, '/login');
	return listAlbumsFor(locals.user.email);
};
