import { error, json } from '@sveltejs/kit';
import { getAlbumRole } from '$lib/server/albums';
import { applyDecisions } from '$lib/server/decisions';
import { DecisionStatus } from '$lib/types';
import type { RequestHandler } from './$types';

const VALID_STATUSES = new Set(Object.values(DecisionStatus));

// Batched write for the swipe deck (see TODO.md 3.0) - one request per coalesced burst of
// swipes/undos, never one per gesture. Any album role (owner/contributor/viewer) may decide.
export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) error(401, 'Not logged in');

	const albumId = Number(params.id);
	const role = await getAlbumRole(albumId, locals.user.email);
	if (!role) error(403, 'No access to this album');

	const body = await request.json();
	if (!Array.isArray(body)) error(400, 'Expected an array of decisions');

	const inputs = body.map((entry) => {
		const photoId = Number(entry?.photoId);
		const status = entry?.status;
		if (!Number.isInteger(photoId) || !VALID_STATUSES.has(status)) {
			error(400, 'Invalid decision entry');
		}
		return { photoId, status: status as DecisionStatus };
	});

	await applyDecisions(locals.user.email, inputs);
	return json({ ok: true });
};
