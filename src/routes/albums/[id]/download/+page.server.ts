import { error, redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { albums } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { getAlbumRole } from '$lib/server/albums';
import { listDownloadableFor } from '$lib/server/downloads';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!locals.user) redirect(303, '/login');

	const albumId = Number(params.id);
	if (!Number.isInteger(albumId)) error(404, 'Album not found');

	const [album, role] = await Promise.all([
		db.query.albums.findFirst({ where: eq(albums.id, albumId) }),
		getAlbumRole(albumId, locals.user.email)
	]);
	if (!album || !role) error(404, 'Album not found');

	const entries = await listDownloadableFor(albumId, locals.user.email);
	return { album, entries };
};
