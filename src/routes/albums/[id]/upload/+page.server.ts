import { error, redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { albums } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { canContribute, getAlbumRole } from '$lib/server/albums';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!locals.user) redirect(303, '/login');

	const albumId = Number(params.id);
	if (!Number.isInteger(albumId)) error(404, 'Album not found');

	const [album, role] = await Promise.all([
		db.query.albums.findFirst({ where: eq(albums.id, albumId) }),
		getAlbumRole(albumId, locals.user.email)
	]);
	if (!album) error(404, 'Album not found');
	if (!canContribute(role)) error(403, 'No upload access to this album');

	return { album };
};
