import { error, json } from '@sveltejs/kit';
import { getAlbumRole } from '$lib/server/albums';
import { getPhoto, resolveDuplicateSurvivor } from '$lib/server/photos';
import type { RequestHandler } from './$types';

// Called once a duplicate bracket (TODO.md 3.4) narrows a cluster down to one surviving photo -
// flips it out of the pending-cluster state so it flows into the normal swipe deck. The
// eliminated photos are marked `delete` via the normal /decisions batch endpoint, not here.
export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) error(401, 'Not logged in');

	const albumId = Number(params.id);
	const role = await getAlbumRole(albumId, locals.user.email);
	if (!role) error(403, 'No access to this album');

	const { photoId } = await request.json();
	if (!Number.isInteger(photoId)) error(400, 'Invalid photoId');

	const photo = await getPhoto(photoId);
	if (!photo || photo.albumId !== albumId) error(404, 'Photo not found');

	await resolveDuplicateSurvivor(photoId);
	return json({ ok: true });
};
