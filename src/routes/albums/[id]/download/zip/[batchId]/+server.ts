import { error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { albums, downloadBatches } from '$lib/server/db/schema';
import { getAlbumRole } from '$lib/server/albums';
import { parseByteRange } from '$lib/server/byteRange';
import { storagePath } from '$lib/server/storage';
import { DownloadBatchStatus } from '$lib/types';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals, request }) => {
	if (!locals.user) error(401, 'Not logged in');
	const albumId = Number(params.id);
	const batchId = Number(params.batchId);
	if (!Number.isSafeInteger(albumId) || !Number.isSafeInteger(batchId))
		error(404, 'Download not found');

	const [album, batch, role] = await Promise.all([
		db.query.albums.findFirst({ where: eq(albums.id, albumId) }),
		db.query.downloadBatches.findFirst({
			where: and(
				eq(downloadBatches.id, batchId),
				eq(downloadBatches.albumId, albumId),
				eq(downloadBatches.email, locals.user.email)
			)
		}),
		getAlbumRole(albumId, locals.user.email)
	]);
	if (!album || !role || !batch || batch.status !== DownloadBatchStatus.Ready || !batch.zipPath)
		error(404, 'Download not found');

	const file = Bun.file(storagePath(batch.zipPath));
	if (!(await file.exists())) error(404, 'Download file missing');
	const size = file.size;
	const etag = `"${batchId}-${size}"`;
	const safeName = album.name.replace(/[^a-z0-9 _-]/gi, '_').trim() || 'album';
	const headers = new Headers({
		'Content-Type': 'application/zip',
		'Content-Disposition': `attachment; filename="${safeName}.zip"`,
		'Accept-Ranges': 'bytes',
		'Cache-Control': 'private, no-cache',
		ETag: etag
	});
	const range =
		request.headers.get('if-range') && request.headers.get('if-range') !== etag
			? null
			: parseByteRange(request.headers.get('range'), size);
	if (range === 'unsatisfiable') {
		headers.set('Content-Range', `bytes */${size}`);
		return new Response(null, { status: 416, headers });
	}
	if (range) {
		headers.set('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
		headers.set('Content-Length', String(range.end - range.start + 1));
		return new Response(file.slice(range.start, range.end + 1), { status: 206, headers });
	}
	headers.set('Content-Length', String(size));
	return new Response(file, { headers });
};
