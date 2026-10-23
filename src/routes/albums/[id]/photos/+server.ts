import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { canContribute, getAlbumRole } from '#lib/server/albums.js';
import { parseJsonBody } from '#lib/server/jsonBody.js';
import { deletePhotos } from '#lib/server/photos.js';
import type { RequestHandler } from './$types';

const photoIdsSchema = z.array(z.number().int().positive());

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

	const body = await parseJsonBody(request, photoIdsSchema, 'Expected an array of photo IDs');

	await deletePhotos(albumId, body);
	return Response.json({ ok: true });
};
