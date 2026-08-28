import { db } from './db';
import { photoNameVariants, photos } from './db/schema';
import { and, eq, inArray, isNotNull, ne } from 'drizzle-orm';
import { DUPLICATE_HAMMING_THRESHOLD } from '$lib/constants';
import { hammingDistance } from '$lib/utils';
import { deleteStoredFiles } from './storage';
import type { StoredImage } from './storage';
import type { Photo } from '$lib/types';

// Of these content hashes, which ones already exist in the album - keyed by hash so the
// upload flow can skip re-sending bytes it already has and instead surface a name conflict.
export async function findExistingByHash(
	albumId: number,
	hashes: string[]
): Promise<Map<string, Photo>> {
	if (hashes.length === 0) return new Map();
	const rows = await db.query.photos.findMany({
		where: and(eq(photos.albumId, albumId), inArray(photos.contentHash, hashes))
	});
	return new Map(rows.map((row) => [row.contentHash, row]));
}

export async function insertPhoto(
	albumId: number,
	uploadedBy: string,
	displayName: string,
	stored: StoredImage
): Promise<Photo> {
	const [photo] = await db
		.insert(photos)
		.values({
			albumId,
			uploadedBy,
			displayName,
			contentHash: stored.contentHash,
			perceptualHash: stored.perceptualHash,
			originalPath: stored.originalPath,
			compatOriginalPath: stored.compatOriginalPath,
			thumbnailPath: stored.thumbnailPath,
			previewPath: stored.previewPath,
			width: stored.width,
			height: stored.height,
			orientation: stored.orientation,
			fileSize: stored.fileSize,
			takenAt: stored.takenAt,
			latitude: stored.latitude,
			longitude: stored.longitude,
			uploadedAt: Date.now()
		})
		.returning();
	return photo;
}

// Records that this content hash has also been seen under `name`, without changing which
// name the photo currently displays under - that choice is made explicitly via
// `setDisplayName` once the uploader resolves the conflict.
export async function recordNameVariant(photoId: number, name: string): Promise<void> {
	const existing = await db.query.photoNameVariants.findFirst({
		where: and(eq(photoNameVariants.photoId, photoId), eq(photoNameVariants.name, name))
	});
	if (existing) return;
	await db.insert(photoNameVariants).values({ photoId, name, seenAt: Date.now() });
}

export async function setDisplayName(photoId: number, displayName: string): Promise<void> {
	await db.update(photos).set({ displayName }).where(eq(photos.id, photoId));
}

export async function getPhoto(photoId: number): Promise<Photo | null> {
	const photo = await db.query.photos.findFirst({ where: eq(photos.id, photoId) });
	return photo ?? null;
}

export async function listPhotos(albumId: number): Promise<Photo[]> {
	return db.query.photos.findMany({
		where: eq(photos.albumId, albumId),
		orderBy: (photo, { asc }) => asc(photo.displayName)
	});
}

// Permanently removes the given photos (must belong to `albumId`, so a crafted id from another
// album can't be deleted through here) - the DB rows plus every rendition on disk. Unlike a
// decision status, this can't be undone.
export async function deletePhotos(albumId: number, ids: number[]): Promise<void> {
	if (ids.length === 0) return;
	const rows = await db.query.photos.findMany({
		where: and(eq(photos.albumId, albumId), inArray(photos.id, ids))
	});
	if (rows.length === 0) return;
	await db.delete(photos).where(
		inArray(
			photos.id,
			rows.map((row) => row.id)
		)
	);
	await Promise.all(rows.map((row) => deleteStoredFiles(row)));
}

// Photos still awaiting a decision from this user, excluding ones stuck in an unresolved
// duplicate cluster (those must go through the bracket first, see clusterOnUpload below).
export async function listResolvedUndecided(albumId: number): Promise<Photo[]> {
	return db.query.photos.findMany({
		where: and(eq(photos.albumId, albumId), eq(photos.duplicateResolved, true)),
		orderBy: (photo, { asc }) => asc(photo.uploadedAt)
	});
}

// Every photo still sitting in an unresolved duplicate cluster, grouped by duplicateGroupId.
// The bracket itself (pairing/rounds) is derived client-side from this list, not stored.
export async function listPendingDuplicateClusters(albumId: number): Promise<Photo[]> {
	return db.query.photos.findMany({
		where: and(eq(photos.albumId, albumId), eq(photos.duplicateResolved, false)),
		orderBy: (photo, { asc }) => asc(photo.uploadedAt)
	});
}

// Union-find-style clustering, run synchronously right after a new photo is stored. Compares
// the new photo's perceptual hash against every other still-unresolved photo in the album
// (already-resolved singles don't need re-comparison - once resolved, a photo is done). If no
// match is found the photo is an immediate singleton, resolved on the spot. Otherwise it joins
// (and if needed merges) the matched cluster(s), reopening any of them that had already been
// marked resolved as a singleton.
export async function clusterOnUpload(albumId: number, newPhoto: Photo): Promise<void> {
	if (!newPhoto.perceptualHash) return;

	const candidates = await db.query.photos.findMany({
		where: and(
			eq(photos.albumId, albumId),
			isNotNull(photos.perceptualHash),
			ne(photos.id, newPhoto.id)
		)
	});
	const matches = candidates.filter(
		(candidate) =>
			hammingDistance(candidate.perceptualHash!, newPhoto.perceptualHash!) <=
			DUPLICATE_HAMMING_THRESHOLD
	);

	if (matches.length === 0) {
		await db.update(photos).set({ duplicateResolved: true }).where(eq(photos.id, newPhoto.id));
		return;
	}

	const existingGroupIds = [
		...new Set(matches.map((m) => m.duplicateGroupId).filter((id): id is number => id != null))
	];
	const canonicalGroupId = Math.min(newPhoto.id, ...matches.map((m) => m.id), ...existingGroupIds);

	const memberIds = [newPhoto.id, ...matches.map((m) => m.id)];
	await db
		.update(photos)
		.set({ duplicateGroupId: canonicalGroupId, duplicateResolved: false })
		.where(inArray(photos.id, memberIds));

	// Merge: any other member of a matched photo's pre-existing group also moves to the
	// canonical group id, even if it didn't itself hash-match the new photo directly.
	if (existingGroupIds.length > 0) {
		await db
			.update(photos)
			.set({ duplicateGroupId: canonicalGroupId })
			.where(and(eq(photos.albumId, albumId), inArray(photos.duplicateGroupId, existingGroupIds)));
	}
}

// Called once a duplicate bracket narrows a cluster down to its single surviving photo - it
// no longer needs bracket resolution and flows into the normal swipe deck queue.
export async function resolveDuplicateSurvivor(photoId: number): Promise<void> {
	await db.update(photos).set({ duplicateResolved: true }).where(eq(photos.id, photoId));
}
