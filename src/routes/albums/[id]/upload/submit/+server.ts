import { error, json } from '@sveltejs/kit';
import { canContribute, getAlbumRole } from '$lib/server/albums';
import { clusterOnUpload, insertPhoto } from '$lib/server/photos';
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
	for (const file of files) {
		try {
			const buffer = Buffer.from(await file.arrayBuffer());
			const extensionHint = file.name.includes('.') ? file.name.split('.').pop()! : '';
			const stored = await storeUpload(buffer, extensionHint);
			const photo = await insertPhoto(albumId, locals.user.email, file.name, stored);
			await clusterOnUpload(albumId, photo);
			added.push({ id: photo.id, displayName: photo.displayName });
		} catch (err) {
			failed.push({ name: file.name, error: err instanceof Error ? err.message : 'Unknown error' });
		}
	}

	return json({ added, failed });
};
