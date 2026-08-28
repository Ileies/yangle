import { redirect } from '@sveltejs/kit';
import { requireAlbumAccess } from '$lib/server/albums';
import { listDownloadableFor } from '$lib/server/downloads';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!locals.user) redirect(303, '/login');

	const albumId = Number(params.id);
	const { album } = await requireAlbumAccess(albumId, locals.user.email);

	const entries = await listDownloadableFor(albumId, locals.user.email);
	return { album, entries };
};
