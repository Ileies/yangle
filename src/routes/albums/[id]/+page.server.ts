import { error, redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { albums } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { canContribute, getAlbumRole } from '$lib/server/albums';
import { getDecisionsFor } from '$lib/server/decisions';
import { listPhotos } from '$lib/server/photos';
import { DecisionStatus } from '$lib/types';
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

	const photos = await listPhotos(albumId);
	const decisions = await getDecisionsFor(
		locals.user.email,
		photos.map((photo) => photo.id)
	);
	const statuses = photos.map((photo) => decisions.get(photo.id) ?? DecisionStatus.Undecided);

	return { album, role, canContribute: canContribute(role), photos, statuses };
};
