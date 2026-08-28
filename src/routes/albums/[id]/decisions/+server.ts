import { error, json } from '@sveltejs/kit';
import { requireAlbumAccess } from '$lib/server/albums';
import { applyDecisions } from '$lib/server/decisions';
import { getPhotosInAlbum } from '$lib/server/photos';
import { DecisionStatus } from '$lib/types';
import type { RequestHandler } from './$types';

const VALID_STATUSES = new Set(Object.values(DecisionStatus));

// Batched write for the swipe deck (see TODO.md 3.0) - one request per coalesced burst of
// swipes/undos, never one per gesture. Any album role (owner/contributor/viewer) may decide.
export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) error(401, 'Not logged in');

	const albumId = Number(params.id);
	await requireAlbumAccess(albumId, locals.user.email);

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

	// Reject the whole batch if any photoId doesn't belong to this album - otherwise a crafted
	// id from another album could have a decision recorded against it here.
	if (inputs.length > 0) {
		const validPhotos = await getPhotosInAlbum(
			albumId,
			inputs.map((input) => input.photoId)
		);
		const validIds = new Set(validPhotos.map((photo) => photo.id));
		if (inputs.some((input) => !validIds.has(input.photoId))) {
			error(400, 'One or more photos do not belong to this album');
		}
	}

	await applyDecisions(locals.user.email, inputs);
	return json({ ok: true });
};
