import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { getAlbumRole, revokeInviteLink, setInviteLink } from '$lib/server/albums';
import { parseJsonBody } from '$lib/server/jsonBody';
import { AlbumRole } from '$lib/types';
import type { RequestHandler } from './$types';

async function requireOwner(albumId: number, email: string) {
	const role = await getAlbumRole(albumId, email);
	if (role !== AlbumRole.Owner) error(403, 'Only the album owner can manage sharing');
}

export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) error(401, 'Not signed in');
	const albumId = Number(params.id);
	await requireOwner(albumId, locals.user.email);

	const body = await parseJsonBody(
		request,
		z.object({ role: z.enum([AlbumRole.Contributor, AlbumRole.Viewer]) }),
		'Invalid role'
	);

	const token = await setInviteLink(albumId, body.role);
	return json({ token });
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) error(401, 'Not signed in');
	const albumId = Number(params.id);
	await requireOwner(albumId, locals.user.email);

	await revokeInviteLink(albumId);
	return json({ ok: true });
};
