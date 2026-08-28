import { redirect } from '@sveltejs/kit';
import { canContribute, requireAlbumAccess } from '$lib/server/albums';
import { getDecisionsFor } from '$lib/server/decisions';
import { listPhotos } from '$lib/server/photos';
import { DecisionStatus } from '$lib/types';
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
	const statuses = photos.map((photo) => decisions.get(photo.id) ?? DecisionStatus.Undecided);

	return { album, role, canContribute: canContribute(role), photos, statuses };
};
