import { error, redirect } from '@sveltejs/kit';
import { listShares, requireAlbumAccess } from '$lib/server/albums';
import { AlbumRole } from '$lib/types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!locals.user) redirect(303, '/login');

	const albumId = Number(params.id);
	const { album, role } = await requireAlbumAccess(albumId, locals.user.email);
	if (role !== AlbumRole.Owner) error(403, 'Only the album owner can manage sharing');

	const shares = await listShares(albumId);
	return { album, shares };
};
