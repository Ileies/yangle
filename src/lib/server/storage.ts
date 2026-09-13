import { PNG } from 'pngjs';
import exifr from 'exifr';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { rename, unlink } from 'node:fs/promises';
import { STORAGE_DIR } from '$env/static/private';
import { IMAGE_QUALITY, PREVIEW_MAX_PX, THUMBNAIL_MAX_PX } from '$lib/constants';
import { Orientation } from '$lib/types';
import { sha256Hex } from '$lib/utils';
import type { BurstFingerprint } from '$lib/server/burstSimilarity';

export function storagePath(...segments: string[]): string {
	return path.join(STORAGE_DIR, ...segments);
}

// 8x8 difference hash. This is only the cheap first pass for burst candidates; SSIM and color
// similarity must also pass before photos are allowed into the same duplicate group.
async function dHash(buffer: Buffer): Promise<string> {
	const { data } = PNG.sync.read(
		await new Bun.Image(buffer).resize(9, 8, { fit: 'fill' }).png().buffer()
	);
	const luminance = (pixel: number) => {
		const offset = pixel * 4;
		return 0.2126 * data[offset] + 0.7152 * data[offset + 1] + 0.0722 * data[offset + 2];
	};

	let bits = '';
	for (let row = 0; row < 8; row++) {
		for (let col = 0; col < 8; col++) {
			bits += luminance(row * 9 + col) < luminance(row * 9 + col + 1) ? '1' : '0';
		}
	}

	let hex = '';
	for (let i = 0; i < bits.length; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
	return hex;
}

async function burstFingerprint(buffer: Buffer): Promise<BurstFingerprint> {
	const imageSize = 64;
	const { data } = PNG.sync.read(
		await new Bun.Image(buffer).resize(imageSize, imageSize, { fit: 'fill' }).png().buffer()
	);
	const luminance: number[] = [];
	const colorHistogram = Array<number>(64).fill(0);
	const pixelCount = imageSize * imageSize;
	for (let i = 0; i < pixelCount; i++) {
		const offset = i * 4;
		const red = data[offset];
		const green = data[offset + 1];
		const blue = data[offset + 2];
		luminance.push(0.2126 * red + 0.7152 * green + 0.0722 * blue);
		const bin = Math.min(3, red >> 6) * 16 + Math.min(3, green >> 6) * 4 + Math.min(3, blue >> 6);
		colorHistogram[bin]++;
	}
	for (let i = 0; i < colorHistogram.length; i++) colorHistogram[i] /= pixelCount;
	return { dHash: await dHash(buffer), luminance, colorHistogram, imageSize };
}

export type StoredImage = {
	contentHash: string;
	perceptualHash: string;
	burstFingerprint: BurstFingerprint;
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

// Writes to a temp path in the same directory as `destPath` (so the rename below stays on the
// same filesystem, keeping it atomic) and renames into place once the write is fully complete.
// Two concurrent uploads of identical bytes (same content hash) racing past the exists() check
// below both end up writing their own temp file and renaming over the same destination - since
// content hash guarantees the bytes are identical, whichever rename lands last "wins" harmlessly
// instead of the two writers corrupting a shared destination file mid-write.
async function writeAtomic(
	destPath: string,
	write: (tempPath: string) => Promise<unknown>
): Promise<void> {
	const tempPath = `${destPath}.tmp-${randomUUID()}`;
	await write(tempPath);
	await rename(tempPath, destPath);
}

export async function storeUpload(buffer: Buffer, extensionHint: string): Promise<StoredImage> {
	if (typeof Bun.Image !== 'function') throw new Error('Image processing requires Bun >= 1.3.14.');
	const metadata = await new Bun.Image(buffer, { autoOrient: false }).metadata();
	if (process.platform === 'linux' && HEIF_FORMATS.has(metadata.format)) {
		throw new Error(
			'HEIC/HEIF and AVIF uploads are not supported on this server. Upload JPEG or PNG instead.'
		);
	}
	const contentHash = await sha256Hex(Uint8Array.from(buffer));
	const fingerprint = await burstFingerprint(buffer);
	const perceptualHash = fingerprint.dHash;
	const exifOrientation =
		metadata.format === 'jpeg' ? await exifr.orientation(buffer).catch(() => undefined) : undefined;
	const swapDimensions =
		exifOrientation !== undefined && exifOrientation >= 5 && exifOrientation <= 8;
	const width = swapDimensions ? metadata.height : metadata.width;
	const height = swapDimensions ? metadata.width : metadata.height;
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
		await writeAtomic(storagePath(originalRelative), (tempPath) => Bun.write(tempPath, buffer));
		await writeAtomic(storagePath(previewRelative), (tempPath) =>
			new Bun.Image(buffer)
				.resize(PREVIEW_MAX_PX, PREVIEW_MAX_PX, { fit: 'inside', withoutEnlargement: true })
				.webp({ quality: IMAGE_QUALITY })
				.write(tempPath)
		);
		await writeAtomic(storagePath(thumbnailRelative), (tempPath) =>
			new Bun.Image(buffer)
				.resize(THUMBNAIL_MAX_PX, THUMBNAIL_MAX_PX, { fit: 'inside', withoutEnlargement: true })
				.webp({ quality: IMAGE_QUALITY })
				.write(tempPath)
		);
		if (compatOriginalRelative) {
			await writeAtomic(storagePath(compatOriginalRelative), (tempPath) =>
				new Bun.Image(buffer).jpeg({ quality: 92 }).write(tempPath)
			);
		}
	}

	return {
		contentHash,
		perceptualHash,
		burstFingerprint: fingerprint,
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
