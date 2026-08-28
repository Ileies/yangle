import { error, redirect } from '@sveltejs/kit';
import { requireAlbumAccess } from '$lib/server/albums';
import { listConflicts } from '$lib/server/conflicts';
import { DecisionMode } from '$lib/types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!locals.user) redirect(303, '/login');

	const albumId = Number(params.id);
	const { album } = await requireAlbumAccess(albumId, locals.user.email);
	if (album.decisionMode !== DecisionMode.Together) {
		error(400, 'This album is not in "together" decision mode');
	}

	const conflicts = await listConflicts(albumId);
	return { album: { id: album.id, name: album.name }, conflicts };
};
