import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { requireAlbumAccess } from '$lib/server/albums';
import { parseJsonBody } from '$lib/server/jsonBody';
import { getPhotoInAlbum, resolveDuplicateSurvivor } from '$lib/server/photos';
import type { RequestHandler } from './$types';

const resolveSchema = z.object({ photoId: z.number().int().positive() });

// Called once a duplicate bracket (TODO.md 3.4) narrows a cluster down to one surviving photo -
// flips it out of the pending-cluster state so it flows into the normal swipe deck. The
// eliminated photos are marked `delete` via the normal /decisions batch endpoint, not here.
export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) error(401, 'Not logged in');

	const albumId = Number(params.id);
	await requireAlbumAccess(albumId, locals.user.email);

	const { photoId } = await parseJsonBody(request, resolveSchema, 'Invalid photoId');

	const photo = await getPhotoInAlbum(albumId, photoId);
	if (!photo) error(404, 'Photo not found');

	await resolveDuplicateSurvivor(photoId);
	return json({ ok: true });
};
