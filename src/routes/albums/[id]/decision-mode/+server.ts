import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { requireAlbumAccess, updateDecisionSettings } from '$lib/server/albums';
import { AlbumRole, DecisionMode, ResolveMode } from '$lib/types';
import type { RequestHandler } from './$types';

const settingsSchema = z.object({
	decisionMode: z.enum([DecisionMode.Independent, DecisionMode.Together]),
	resolveMode: z.enum([ResolveMode.SwipeAllThenResolve]).nullable()
});

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) error(401, 'Not signed in');
	const albumId = Number(params.id);
	const { role } = await requireAlbumAccess(albumId, locals.user.email);
	if (role !== AlbumRole.Owner) error(403, 'Only the album owner can do this');

	const body = settingsSchema.safeParse(await request.json());
	if (!body.success) error(400, 'Invalid decision settings');

	await updateDecisionSettings(albumId, body.data.decisionMode, body.data.resolveMode);
	return json({ ok: true });
};
