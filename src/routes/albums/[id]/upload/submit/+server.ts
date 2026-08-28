import { error, json } from '@sveltejs/kit';
import { canContribute, getAlbumRole } from '$lib/server/albums';
import { flattenImageName, uniqueImageName } from '$lib/imageNames';
import { clusterOnUpload, insertPhoto, listPhotoNames } from '$lib/server/photos';
import { storeUpload } from '$lib/server/storage';
import type { RequestHandler } from './$types';

// Bytes only reach here for files the client's /upload/check call determined are genuinely
// new to the album - already-present content hashes are resolved as name conflicts instead
// (see /upload/resolve), never re-uploaded.
export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) error(401, 'Not logged in');

	const albumId = Number(params.id);
	const role = await getAlbumRole(albumId, locals.user.email);
	if (!canContribute(role)) error(403, 'No upload access to this album');

	const form = await request.formData();
	const files = form.getAll('files').filter((entry): entry is File => entry instanceof File);

	const added = [];
	const failed: { name: string; error: string }[] = [];
	const usedNames = new Set(await listPhotoNames(albumId));

	// storeUpload (sharp encoding, EXIF/hash parsing) is CPU/IO-bound and independent per file,
	// so it's safe to fan out within a bounded chunk. clusterOnUpload is NOT safe to run
	// concurrently within the same chunk: it reads the album's current unresolved photos, then
	// writes duplicateGroupId based on that read. Two files that are duplicates of each other
	// landing in the same chunk could both read before either write lands, each missing the
	// other as a candidate and never merging into one group. So insertPhoto + clusterOnUpload
	// stay sequential, in upload order, while only the storeUpload step is parallelized.
	const CHUNK_SIZE = 4;
	for (let i = 0; i < files.length; i += CHUNK_SIZE) {
		const chunk = files.slice(i, i + CHUNK_SIZE);
		type StoreResult =
			| { ok: true; file: File; stored: Awaited<ReturnType<typeof storeUpload>> }
			| { ok: false; file: File; error: string };

		const stores = await Promise.all(
			chunk.map(async (file): Promise<StoreResult> => {
				try {
					const buffer = Buffer.from(await file.arrayBuffer());
					const flattenedName = flattenImageName(file.name);
					const extensionHint = flattenedName.includes('.') ? flattenedName.split('.').pop()! : '';
					const stored = await storeUpload(buffer, extensionHint);
					return { ok: true, file, stored };
				} catch (err) {
					return { ok: false, file, error: err instanceof Error ? err.message : 'Unknown error' };
				}
			})
		);

		for (const result of stores) {
			if (!result.ok) {
				failed.push({ name: result.file.name, error: result.error });
				continue;
			}
			try {
				const displayName = uniqueImageName(result.file.name, usedNames);
				const photo = await insertPhoto(albumId, locals.user.email, displayName, result.stored);
				usedNames.add(displayName);
				await clusterOnUpload(albumId, photo);
				added.push({ id: photo.id, displayName: photo.displayName });
			} catch (err) {
				failed.push({
					name: result.file.name,
					error: err instanceof Error ? err.message : 'Unknown error'
				});
			}
		}
	}

	return json({ added, failed });
};
