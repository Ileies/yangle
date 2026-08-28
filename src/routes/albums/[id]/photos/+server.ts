import { error, json } from '@sveltejs/kit';
import { canContribute, getAlbumRole } from '$lib/server/albums';
import { deletePhotos } from '$lib/server/photos';
import type { RequestHandler } from './$types';

// Bulk hard-delete from the album overview's multi-select. Unlike a decision status (per-user,
// reversible), this removes the row and every file rendition for everyone - so it's gated to
// contributors/owner rather than the "any role" the decisions endpoint allows.
export const DELETE: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) error(401, 'Not logged in');

	const albumId = Number(params.id);
	if (!Number.isInteger(albumId)) error(404, 'Album not found');

	const role = await getAlbumRole(albumId, locals.user.email);
	if (!role) error(403, 'No access to this album');
	if (!canContribute(role)) error(403, 'Only contributors can delete photos');

	const body = await request.json();
	if (!Array.isArray(body) || !body.every((id) => Number.isInteger(id))) {
		error(400, 'Expected an array of photo IDs');
	}

	await deletePhotos(albumId, body);
	return json({ ok: true });
};
