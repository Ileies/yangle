import { error } from '@sveltejs/kit';
import { acceptInvite } from '#lib/server/albums.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) error(401, 'Not signed in');

	const album = await acceptInvite(params.token, locals.user.email);
	if (!album) error(404, 'This invite link is invalid or has been revoked');

	return Response.json({ albumId: album.id });
};
