import { error, json } from '@sveltejs/kit';
import { deleteAlbum, getAlbumRole } from '$lib/server/albums';
import { AlbumRole } from '$lib/types';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) error(401, 'Not signed in');
	const albumId = Number(params.id);
	const role = await getAlbumRole(albumId, locals.user.email);
	if (role !== AlbumRole.Owner) error(403, 'Only the album owner can do this');

	await deleteAlbum(albumId);
	return json({ ok: true });
};
