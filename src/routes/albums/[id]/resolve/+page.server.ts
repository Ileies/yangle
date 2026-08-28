import { error, redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { albums } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { getAlbumRole } from '$lib/server/albums';
import { listConflicts } from '$lib/server/conflicts';
import { DecisionMode } from '$lib/types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!locals.user) redirect(303, '/login');

	const albumId = Number(params.id);
	if (!Number.isInteger(albumId)) error(404, 'Album not found');

	const album = await db.query.albums.findFirst({ where: eq(albums.id, albumId) });
	if (!album) error(404, 'Album not found');

	const role = await getAlbumRole(albumId, locals.user.email);
	if (!role) error(403, 'No access to this album');
	if (album.decisionMode !== DecisionMode.Together) {
		error(400, 'This album is not in "together" decision mode');
	}

	const conflicts = await listConflicts(albumId);
	return { album: { id: album.id, name: album.name }, conflicts };
};
