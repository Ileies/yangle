import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { getAlbumRole, listParticipants } from '$lib/server/albums';
import { applyDecisionToAll } from '$lib/server/decisions';
import { DecisionStatus } from '$lib/types';
import type { RequestHandler } from './$types';

const bodySchema = z.object({
	photoId: z.number().int(),
	status: z.enum([DecisionStatus.Keep, DecisionStatus.Delete, DecisionStatus.Favorite])
});

// The joint-resolution write: one participant's pick becomes everyone's decision on this photo,
// which is what makes conflicts.ts stop treating it as a conflict (everyone agrees again).
export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) error(401, 'Not signed in');
	const albumId = Number(params.id);
	const role = await getAlbumRole(albumId, locals.user.email);
	if (!role) error(403, 'No access to this album');

	const body = bodySchema.safeParse(await request.json());
	if (!body.success) error(400, 'Invalid photoId or status');

	const participants = await listParticipants(albumId);
	await applyDecisionToAll(participants, body.data.photoId, body.data.status);

	return json({ ok: true });
};
