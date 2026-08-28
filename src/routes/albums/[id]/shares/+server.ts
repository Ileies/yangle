import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { addOrUpdateShare, getAlbumRole, removeShare } from '$lib/server/albums';
import { db } from '$lib/server/db';
import { albums } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { sendAlbumShareEmail } from '$lib/server/mail';
import { AlbumRole } from '$lib/types';
import type { RequestHandler } from './$types';

const shareSchema = z.object({
	email: z.email(),
	role: z.enum([AlbumRole.Contributor, AlbumRole.Viewer])
});

async function requireOwner(albumId: number, email: string) {
	const role = await getAlbumRole(albumId, email);
	if (role !== AlbumRole.Owner) error(403, 'Only the album owner can manage sharing');
}

export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) error(401, 'Not signed in');
	const albumId = Number(params.id);
	await requireOwner(albumId, locals.user.email);

	const body = shareSchema.safeParse(await request.json());
	if (!body.success) error(400, 'Invalid email or role');
	const { email, role } = body.data;
	if (email === locals.user.email) error(400, 'You already own this album');

	const album = await db.query.albums.findFirst({ where: eq(albums.id, albumId) });
	if (!album) error(404, 'Album not found');

	await addOrUpdateShare(albumId, email, role);
	await sendAlbumShareEmail(email, album.name, locals.user.displayName).catch(() => {});

	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) error(401, 'Not signed in');
	const albumId = Number(params.id);
	await requireOwner(albumId, locals.user.email);

	const body = z.object({ email: z.email() }).safeParse(await request.json());
	if (!body.success) error(400, 'Invalid email');

	await removeShare(albumId, body.data.email);
	return json({ ok: true });
};
