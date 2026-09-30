import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { canContribute, getAlbumRole } from '$lib/server/albums';
import { flattenImageName, uniqueImageName } from '$lib/imageNames';
import { parseJsonBody } from '$lib/server/jsonBody';
import { getPhoto, listPhotoNames, recordNameVariant, setDisplayName } from '$lib/server/photos';
import type { RequestHandler } from './$types';

const resolveSchema = z.object({
	photoId: z.number().int().positive(),
	keepName: z.string().min(1),
	otherName: z.string().min(1)
});

// Resolves a name conflict surfaced by /upload/check: same content hash already in the
// album under `photo.displayName`, but the file just selected was named `otherName`.
// The name not kept is preserved in photo_name_variants so it isn't silently lost.
export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) error(401, 'Not logged in');

	const albumId = Number(params.id);
	const role = await getAlbumRole(albumId, locals.user.email);
	if (!canContribute(role)) error(403, 'No upload access to this album');

	const { photoId, keepName, otherName } = await parseJsonBody(
		request,
		resolveSchema,
		'Invalid photoId or names'
	);

	const photo = await getPhoto(photoId);
	if (!photo || photo.albumId !== albumId) error(404, 'Photo not found');

	const flattenedKeepName = flattenImageName(keepName);
	const flattenedOtherName = flattenImageName(otherName);
	await recordNameVariant(photoId, flattenedOtherName);
	if (flattenedKeepName !== photo.displayName) {
		const usedNames = new Set(
			(await listPhotoNames(albumId)).filter((name) => name !== photo.displayName)
		);
		await setDisplayName(photoId, uniqueImageName(flattenedKeepName, usedNames));
	}

	return json({ ok: true });
};
