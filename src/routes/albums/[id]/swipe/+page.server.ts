import { error, redirect } from '@sveltejs/kit';
import { canContribute, getAlbumRole } from '$lib/server/albums';
import { getDecisionsFor } from '$lib/server/decisions';
import { db } from '$lib/server/db';
import { albums } from '$lib/server/db/schema';
import { listPendingDuplicateClusters, listResolvedUndecided } from '$lib/server/photos';
import { DecisionStatus, type DeckPhoto } from '$lib/types';
import { eq } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!locals.user) redirect(303, '/login');

	const albumId = Number(params.id);
	const album = await db.query.albums.findFirst({ where: eq(albums.id, albumId) });
	if (!album) error(404, 'Album not found');

	const role = await getAlbumRole(albumId, locals.user.email);
	if (!role) error(403, 'No access to this album');

	const [pendingCluster, resolved] = await Promise.all([
		listPendingDuplicateClusters(albumId),
		listResolvedUndecided(albumId)
	]);

	const decisions = await getDecisionsFor(
		locals.user.email,
		resolved.map((photo) => photo.id)
	);
	const queue = resolved.filter((photo) => {
		const status = decisions.get(photo.id);
		return status === undefined || status === DecisionStatus.Undecided;
	});

	const toDeckPhoto = (photo: (typeof resolved)[number]): DeckPhoto => ({
		id: photo.id,
		displayName: photo.displayName,
		width: photo.width,
		height: photo.height,
		orientation: photo.orientation,
		duplicateGroupId: photo.duplicateGroupId
	});

	return {
		album: { id: album.id, name: album.name },
		canContribute: canContribute(role),
		clusters: pendingCluster.map(toDeckPhoto),
		queue: queue.map(toDeckPhoto),
		total: queue.length
	};
};
