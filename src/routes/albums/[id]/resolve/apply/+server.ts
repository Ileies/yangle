import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { listParticipants, requireAlbumAccess } from '$lib/server/albums';
import { applyDecisionToAll } from '$lib/server/decisions';
import { getPhotoInAlbum } from '$lib/server/photos';
import { DecisionMode, DecisionStatus } from '$lib/types';
import type { RequestHandler } from './$types';

const bodySchema = z.object({
	photoId: z.number().int(),
	status: z.enum([DecisionStatus.Keep, DecisionStatus.Delete, DecisionStatus.Favorite])
});

// The joint-resolution write: one participant's pick becomes everyone's decision on this photo,
// which is what makes conflicts.ts stop treating it as a conflict (everyone agrees again). Only
// valid for "together"-mode albums, and only for a photo that actually belongs to this album -
// otherwise any member of any album could force a decision onto photos/participants elsewhere.
export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) error(401, 'Not signed in');
	const albumId = Number(params.id);
	const { album } = await requireAlbumAccess(albumId, locals.user.email);
	if (album.decisionMode !== DecisionMode.Together) {
		error(400, 'This album is not in "together" decision mode');
	}

	const body = bodySchema.safeParse(await request.json());
	if (!body.success) error(400, 'Invalid photoId or status');

	const photo = await getPhotoInAlbum(albumId, body.data.photoId);
	if (!photo) error(404, 'Photo not found');

	const participants = await listParticipants(albumId);
	await applyDecisionToAll(participants, body.data.photoId, body.data.status);

	return json({ ok: true });
};
