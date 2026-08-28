import { db } from './db';
import { photoNameVariants, photos } from './db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { deleteStoredFiles } from './storage';
import type { StoredImage } from './storage';
import type { Photo } from '$lib/types';
import { buildBurstClusters, type BurstCandidate } from './burstSimilarity';
import { compareImageNames } from '$lib/imageNames';

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

// Confirms `photoId` actually belongs to `albumId` before a route acts on it - guards against a
// crafted/copy-pasted id from a different album being used to force a decision or resolution
// onto photos/participants the caller has no business touching.
export async function getPhotoInAlbum(albumId: number, photoId: number): Promise<Photo | null> {
	const photo = await db.query.photos.findFirst({
		where: and(eq(photos.albumId, albumId), eq(photos.id, photoId))
	});
	return photo ?? null;
}

// Batched version of getPhotoInAlbum, for validating every id in a decisions batch belongs to
// the album before any of them are written - returns just the matching ids.
export async function getPhotosInAlbum(albumId: number, photoIds: number[]): Promise<Photo[]> {
	if (photoIds.length === 0) return [];
	return db.query.photos.findMany({
		where: and(eq(photos.albumId, albumId), inArray(photos.id, photoIds))
	});
}

export async function listPhotos(albumId: number): Promise<Photo[]> {
	const rows = await db.query.photos.findMany({ where: eq(photos.albumId, albumId) });
	return rows.sort((a, b) => compareImageNames(a.displayName, b.displayName) || a.id - b.id);
}

export async function listPhotoNames(albumId: number): Promise<string[]> {
	const rows = await db.query.photos.findMany({
		where: eq(photos.albumId, albumId),
		columns: { displayName: true }
	});
	return rows.map((row) => row.displayName);
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
// duplicate cluster (those must go through the bracket first, see clusterUploadBatch below).
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

// Cluster only the photos from this upload request. Historical album photos are intentionally
// excluded: this feature identifies camera bursts, not semantically similar scenes taken days
// apart. Complete-link matching and the stronger fingerprints live in burstSimilarity.ts.
export async function clusterUploadBatch(
	albumId: number,
	candidates: BurstCandidate<Photo>[]
): Promise<void> {
	if (candidates.length === 0) return;
	const ids = candidates.map(({ photo }) => photo.id);

	// Fail safe: photos start as ordinary swipe items. Only verified multi-photo clusters are
	// moved into duplicate resolution by the updates below.
	await db
		.update(photos)
		.set({ duplicateGroupId: null, duplicateResolved: true })
		.where(and(eq(photos.albumId, albumId), inArray(photos.id, ids)));

	for (const cluster of buildBurstClusters(candidates)) {
		if (cluster.length < 2) continue;
		const memberIds = cluster.map(({ photo }) => photo.id);
		const groupId = Math.min(...memberIds);
		await db
			.update(photos)
			.set({ duplicateGroupId: groupId, duplicateResolved: false })
			.where(and(eq(photos.albumId, albumId), inArray(photos.id, memberIds)));
	}
}

// Called once a duplicate bracket narrows a cluster down to its single surviving photo - it
// no longer needs bracket resolution and flows into the normal swipe deck queue.
export async function resolveDuplicateSurvivor(photoId: number): Promise<void> {
	await db.update(photos).set({ duplicateResolved: true }).where(eq(photos.id, photoId));
}
