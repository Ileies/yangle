import { redirect } from '@sveltejs/kit';
import { canContribute, requireAlbumAccess } from '#lib/server/albums.js';
import { getDecisionsFor } from '#lib/server/decisions.js';
import { listPhotos } from '#lib/server/photos.js';
import { DecisionStatus } from '#lib/types.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!locals.user) redirect(303, '/login');

	const albumId = Number(params.id);
	const { album, role } = await requireAlbumAccess(albumId, locals.user.email);

	const photos = await listPhotos(albumId);
	const decisions = await getDecisionsFor(
		locals.user.email,
		photos.map((photo) => photo.id)
	);
	const withStatus = photos.map((photo) => ({
		photo,
		status: decisions.get(photo.id) ?? DecisionStatus.Undecided
	}));

	return { album, canContribute: canContribute(role), photos: withStatus };
};
