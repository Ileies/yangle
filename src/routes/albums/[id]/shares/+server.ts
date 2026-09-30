import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { addOrUpdateShare, removeShare, requireAlbumAccess } from '$lib/server/albums';
import { parseJsonBody } from '$lib/server/jsonBody';
import { sendAlbumShareEmail } from '$lib/server/mail';
import { AlbumRole } from '$lib/types';
import type { RequestHandler } from './$types';

const shareSchema = z.object({
	email: z.email(),
	role: z.enum([AlbumRole.Contributor, AlbumRole.Viewer])
});

async function requireOwner(albumId: number, email: string) {
	const { album, role } = await requireAlbumAccess(albumId, email);
	if (role !== AlbumRole.Owner) error(403, 'Only the album owner can manage sharing');
	return album;
}

export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) error(401, 'Not signed in');
	const albumId = Number(params.id);
	const album = await requireOwner(albumId, locals.user.email);

	const { email, role } = await parseJsonBody(request, shareSchema, 'Invalid email or role');
	if (email === locals.user.email) error(400, 'You already own this album');

	await addOrUpdateShare(albumId, email, role);
	await sendAlbumShareEmail(email, album.name, locals.user.displayName).catch(() => {});

	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) error(401, 'Not signed in');
	const albumId = Number(params.id);
	await requireOwner(albumId, locals.user.email);

	const body = await parseJsonBody(request, z.object({ email: z.email() }), 'Invalid email');

	await removeShare(albumId, body.email);
	return json({ ok: true });
};
