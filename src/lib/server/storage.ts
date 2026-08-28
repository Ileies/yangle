import sharp from 'sharp';
import exifr from 'exifr';
import path from 'node:path';
import { unlink } from 'node:fs/promises';
import { STORAGE_DIR } from '$env/static/private';
import { IMAGE_QUALITY, PREVIEW_MAX_PX, THUMBNAIL_MAX_PX } from '$lib/constants';
import { Orientation } from '$lib/types';
import { sha256Hex } from '$lib/utils';

export function storagePath(...segments: string[]): string {
	return path.join(STORAGE_DIR, ...segments);
}

// 8x8 difference hash. Unlike the exact content hash above, this is robust to the minor
// compression/exposure differences between near-duplicate burst shots, which is what lets us
// cluster them for the pairwise duplicate-resolution screen before they hit the swipe deck.
async function dHash(buffer: Buffer): Promise<string> {
	const { data } = await sharp(buffer)
		.resize(9, 8, { fit: 'fill' })
		.grayscale()
		.raw()
		.toBuffer({ resolveWithObject: true });

	let bits = '';
	for (let row = 0; row < 8; row++) {
		for (let col = 0; col < 8; col++) {
			bits += data[row * 9 + col] < data[row * 9 + col + 1] ? '1' : '0';
		}
	}

	let hex = '';
	for (let i = 0; i < bits.length; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
	return hex;
}

export type StoredImage = {
	contentHash: string;
	perceptualHash: string;
	width: number;
	height: number;
	orientation: Orientation;
	fileSize: number;
	originalPath: string;
	// Set only for formats browsers/most OSes can't open directly (HEIC/HEIF) - a JPEG
	// rendition of the same original, offered as the download fallback for non-Apple
	// recipients. The true original bytes are always kept untouched at `originalPath`.
	compatOriginalPath: string | null;
	thumbnailPath: string;
	previewPath: string;
	takenAt: number | null;
	latitude: number | null;
	longitude: number | null;
};

const HEIF_FORMATS = new Set(['heif', 'heic', 'avif']);

// Writes the original plus a preview (swipe deck) and thumbnail (grids, duplicate-resolution
// screen) size, both re-encoded as WebP. For HEIC/HEIF originals (the iPhone default), also
// writes a JPEG compatibility copy via the same sharp/libvips pipeline - no separate ffmpeg
// dependency, and correctly carries over the embedded ICC profile (Display P3 on iPhone)
// instead of washing colors out. Skips re-processing if the content hash already exists on
// disk (same bytes uploaded again, possibly under a different name).
export async function storeUpload(buffer: Buffer, extensionHint: string): Promise<StoredImage> {
	const contentHash = await sha256Hex(Uint8Array.from(buffer));
	const perceptualHash = await dHash(buffer);
	const metadata = await sharp(buffer).metadata();
	const width = metadata.width ?? 0;
	const height = metadata.height ?? 0;
	const orientation = width >= height ? Orientation.Landscape : Orientation.Portrait;

	// EXIF absence (screenshots, downloaded images, stripped-metadata exports) is expected, not
	// an error - fall back to nulls so the caller can fall back to uploadedAt for display.
	const exif = await exifr.parse(buffer, { gps: true }).catch(() => null);
	const takenAt = exif?.DateTimeOriginal instanceof Date ? exif.DateTimeOriginal.getTime() : null;
	const latitude = typeof exif?.latitude === 'number' ? exif.latitude : null;
	const longitude = typeof exif?.longitude === 'number' ? exif.longitude : null;

	const format = metadata.format ?? extensionHint.replace(/^\./, '');
	const originalRelative = path.join('originals', `${contentHash}.${format}`);
	const previewRelative = path.join('previews', `${contentHash}.webp`);
	const thumbnailRelative = path.join('thumbnails', `${contentHash}.webp`);
	const isHeif = HEIF_FORMATS.has(format);
	const compatOriginalRelative = isHeif
		? path.join('originals', `${contentHash}.compat.jpg`)
		: null;

	if (!(await Bun.file(storagePath(originalRelative)).exists())) {
		await Bun.write(storagePath(originalRelative), buffer);
		await sharp(buffer)
			.resize(PREVIEW_MAX_PX, PREVIEW_MAX_PX, { fit: 'inside', withoutEnlargement: true })
			.webp({ quality: IMAGE_QUALITY })
			.toFile(storagePath(previewRelative));
		await sharp(buffer)
			.resize(THUMBNAIL_MAX_PX, THUMBNAIL_MAX_PX, { fit: 'inside', withoutEnlargement: true })
			.webp({ quality: IMAGE_QUALITY })
			.toFile(storagePath(thumbnailRelative));
		if (compatOriginalRelative) {
			await sharp(buffer).jpeg({ quality: 92 }).toFile(storagePath(compatOriginalRelative));
		}
	}

	return {
		contentHash,
		perceptualHash,
		width,
		height,
		orientation,
		fileSize: buffer.byteLength,
		originalPath: originalRelative,
		compatOriginalPath: compatOriginalRelative,
		thumbnailPath: thumbnailRelative,
		previewPath: previewRelative,
		takenAt,
		latitude,
		longitude
	};
}

// Removes every rendition of a photo from disk. Missing files (already gone, or a compat copy
// that was never written) are not an error - the DB row is the source of truth for what to try.
export async function deleteStoredFiles(image: {
	originalPath: string;
	compatOriginalPath: string | null;
	thumbnailPath: string;
	previewPath: string;
}): Promise<void> {
	const relativePaths = [
		image.originalPath,
		image.compatOriginalPath,
		image.thumbnailPath,
		image.previewPath
	].filter((relative): relative is string => relative !== null);

	await Promise.all(relativePaths.map((relative) => unlink(storagePath(relative)).catch(() => {})));
}
