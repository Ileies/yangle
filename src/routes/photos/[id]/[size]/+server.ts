import { error } from '@sveltejs/kit';
import { getAlbumRole } from '$lib/server/albums';
import { getPhoto } from '$lib/server/photos';
import { storagePath } from '$lib/server/storage';
import type { RequestHandler } from './$types';

// Auth-gated file serving: images live outside `static/` on purpose, so access follows
// album membership instead of "anyone with the URL". `size` picks which derived file to
// stream - thumbnail/preview are always WebP, original/compat keep their source format.
const RENDITIONS = ['thumbnail', 'preview', 'original', 'compat'] as const;
type Rendition = (typeof RENDITIONS)[number];

const CONTENT_TYPES: Partial<Record<Rendition, string>> = {
	thumbnail: 'image/webp',
	preview: 'image/webp'
};

export const GET: RequestHandler = async ({ params, locals, url }) => {
	if (!locals.user) error(401, 'Not logged in');

	const photoId = Number(params.id);
	if (!Number.isInteger(photoId)) error(404, 'Photo not found');

	const photo = await getPhoto(photoId);
	if (!photo) error(404, 'Photo not found');

	const role = await getAlbumRole(photo.albumId, locals.user.email);
	if (!role) error(403, 'No access to this album');

	if (!RENDITIONS.includes(params.size as Rendition)) error(404, 'No such rendition');
	const size = params.size as Rendition;

	const relativePath = {
		thumbnail: photo.thumbnailPath,
		preview: photo.previewPath,
		original: photo.originalPath,
		compat: photo.compatOriginalPath
	}[size];
	if (!relativePath) error(404, 'No such rendition');

	const file = Bun.file(storagePath(relativePath));
	if (!(await file.exists())) error(404, 'File missing on disk');

	return new Response(file, {
		headers: {
			'Content-Type': CONTENT_TYPES[size] ?? file.type,
			'Cache-Control':
				url.searchParams.get('v') === photo.contentHash
					? 'private, max-age=31536000, immutable'
					: 'private, no-cache'
		}
	});
};
