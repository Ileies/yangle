import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { getAlbumRole, canContribute } from '$lib/server/albums';
import { parseJsonBody } from '$lib/server/jsonBody';
import { findExistingByHash } from '$lib/server/photos';
import type { RequestHandler } from './$types';

const checkSchema = z.object({ hashes: z.array(z.string().regex(/^[a-f0-9]{64}$/)) });

// Client hashes each file before upload and calls this first, so files whose bytes are
// already in the album never need to be sent over the wire at all.
export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) error(401, 'Not logged in');

	const albumId = Number(params.id);
	const role = await getAlbumRole(albumId, locals.user.email);
	if (!canContribute(role)) error(403, 'No upload access to this album');

	const { hashes } = await parseJsonBody(request, checkSchema, 'Invalid hashes');
	const existing = await findExistingByHash(albumId, hashes);

	return json({
		existing: Array.from(existing.values()).map((photo) => ({
			hash: photo.contentHash,
			id: photo.id,
			displayName: photo.displayName
		}))
	});
};
