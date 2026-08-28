import { error, redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { albums } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { getAlbumRole, listShares } from '$lib/server/albums';
import { AlbumRole } from '$lib/types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!locals.user) redirect(303, '/login');

	const albumId = Number(params.id);
	if (!Number.isInteger(albumId)) error(404, 'Album not found');

	const album = await db.query.albums.findFirst({ where: eq(albums.id, albumId) });
	if (!album) error(404, 'Album not found');

	const role = await getAlbumRole(albumId, locals.user.email);
	if (role !== AlbumRole.Owner) error(403, 'Only the album owner can manage sharing');

	const shares = await listShares(albumId);
	return { album, shares };
};
