import { error, redirect } from '@sveltejs/kit';
import { Zip, ZipPassThrough } from 'fflate';
import { db } from '$lib/server/db';
import { albums } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { getAlbumRole } from '$lib/server/albums';
import {
	completeDownloadBatch,
	failDownloadBatch,
	photosToDownload,
	recordDownloadBatch
} from '$lib/server/downloads';
import { storagePath } from '$lib/server/storage';
import type { RequestHandler } from './$types';

// Two photos can legitimately share a display name (different content hashes, same original
// file name from different bursts/contributors) - the DB only requires uniqueness per content
// hash, not per name. A ZIP can't have two entries with the same path, so collisions get the
// photo id appended before the extension.
function uniqueZipName(used: Set<string>, displayName: string, photoId: number): string {
	if (!used.has(displayName)) {
		used.add(displayName);
		return displayName;
	}
	const dot = displayName.lastIndexOf('.');
	const base = dot === -1 ? displayName : displayName.slice(0, dot);
	const ext = dot === -1 ? '' : displayName.slice(dot);
	const name = `${base}-${photoId}${ext}`;
	used.add(name);
	return name;
}

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) redirect(303, '/login');

	const albumId = Number(params.id);
	if (!Number.isInteger(albumId)) error(404, 'Album not found');

	const [album, role] = await Promise.all([
		db.query.albums.findFirst({ where: eq(albums.id, albumId) }),
		getAlbumRole(albumId, locals.user.email)
	]);
	if (!album || !role) error(404, 'Album not found');

	const email = locals.user.email;
	const photos = await photosToDownload(albumId, email);
	if (photos.length === 0) error(400, 'Nothing to download yet');

	const batchId = await recordDownloadBatch(
		albumId,
		email,
		photos.map((photo) => photo.id)
	);
	const used = new Set<string>();

	// Streams the ZIP as it's built rather than buffering the whole archive in memory first -
	// fflate's `Zip` emits compressed chunks via a callback, which maps directly onto a
	// `ReadableStream`'s controller. Each original is still read fully into memory one at a
	// time before being added (not itself streamed off disk), which is fine at this app's
	// scale (hundreds, not thousands, of photos per album - see storage.ts/TODO.md).
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			const zip = new Zip((err, chunk, final) => {
				if (err) {
					controller.error(err);
					failDownloadBatch(batchId).catch(() => {});
					return;
				}
				controller.enqueue(chunk);
				if (final) controller.close();
			});

			(async () => {
				for (const photo of photos) {
					const bytes = new Uint8Array(
						await Bun.file(storagePath(photo.originalPath)).arrayBuffer()
					);
					const name = uniqueZipName(used, photo.displayName, photo.id);
					const entry = new ZipPassThrough(name);
					zip.add(entry);
					entry.push(bytes, true);
				}
				zip.end();
				await completeDownloadBatch(
					batchId,
					photos.map((photo) => photo.id),
					email
				);
			})().catch((err) => {
				controller.error(err);
				failDownloadBatch(batchId).catch(() => {});
			});
		}
	});

	const safeName = album.name.replace(/[^a-z0-9 _-]/gi, '_').trim() || 'album';
	return new Response(stream, {
		headers: {
			'Content-Type': 'application/zip',
			'Content-Disposition': `attachment; filename="${safeName}.zip"`
		}
	});
};
