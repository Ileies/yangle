import { db } from './db';
import { downloadBatches, downloadBatchPhotos, photoDownloads } from './db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { getDecisionsFor } from './decisions';
import { listPhotos } from './photos';
import { DecisionStatus, DownloadBatchStatus } from '$lib/types';
import type { Photo } from '$lib/types';

export type DownloadBadge = 'downloaded' | 'new' | 'undecided';

export type DownloadListEntry = {
	photo: Photo;
	decision: DecisionStatus;
	badge: DownloadBadge;
};

// Every non-deleted photo this user can potentially download, with a badge showing whether
// it's already in a prior ZIP, newly kept/favorited since then, or still undecided - deleted
// photos are excluded outright, they were never download candidates.
export async function listDownloadableFor(
	albumId: number,
	email: string
): Promise<DownloadListEntry[]> {
	const photos = await listPhotos(albumId);
	const decisions = await getDecisionsFor(
		email,
		photos.map((photo) => photo.id)
	);
	const downloadedRows = await db.query.photoDownloads.findMany({
		where: and(
			eq(photoDownloads.email, email),
			inArray(
				photoDownloads.photoId,
				photos.map((photo) => photo.id)
			)
		)
	});
	const downloadedIds = new Set(downloadedRows.map((row) => row.photoId));

	const entries: DownloadListEntry[] = [];
	for (const photo of photos) {
		const decision = decisions.get(photo.id) ?? DecisionStatus.Undecided;
		if (decision === DecisionStatus.Delete) continue;
		const badge: DownloadBadge =
			decision === DecisionStatus.Undecided
				? 'undecided'
				: downloadedIds.has(photo.id)
					? 'downloaded'
					: 'new';
		entries.push({ photo, decision, badge });
	}
	return entries;
}

// The actual ZIP contents: everything this user has kept or favorited, regardless of whether
// it was included in an earlier download - re-downloading is always allowed, "new" is just a
// badge, not a filter.
export async function photosToDownload(albumId: number, email: string): Promise<Photo[]> {
	const photos = await listPhotos(albumId);
	const decisions = await getDecisionsFor(
		email,
		photos.map((photo) => photo.id)
	);
	return photos.filter((photo) => {
		const status = decisions.get(photo.id) ?? DecisionStatus.Undecided;
		return status === DecisionStatus.Keep || status === DecisionStatus.Favorite;
	});
}

export async function recordDownloadBatch(
	albumId: number,
	email: string,
	photoIds: number[]
): Promise<number> {
	const [batch] = await db
		.insert(downloadBatches)
		.values({ albumId, email, status: DownloadBatchStatus.Pending, requestedAt: Date.now() })
		.returning();
	if (photoIds.length > 0) {
		await db
			.insert(downloadBatchPhotos)
			.values(photoIds.map((photoId) => ({ batchId: batch.id, photoId })));
	}
	return batch.id;
}

// Marks the batch ready and stamps `photoDownloads` for every included photo - upsert, since
// re-downloading an already-downloaded photo just refreshes `downloadedAt`, it doesn't need a
// second row.
export async function completeDownloadBatch(
	batchId: number,
	photoIds: number[],
	email: string
): Promise<void> {
	await db
		.update(downloadBatches)
		.set({ status: DownloadBatchStatus.Ready, readyAt: Date.now() })
		.where(eq(downloadBatches.id, batchId));
	if (photoIds.length === 0) return;
	const downloadedAt = Date.now();
	await db
		.insert(photoDownloads)
		.values(photoIds.map((photoId) => ({ photoId, email, downloadedAt })))
		.onConflictDoUpdate({
			target: [photoDownloads.photoId, photoDownloads.email],
			set: { downloadedAt }
		});
}

export async function failDownloadBatch(batchId: number): Promise<void> {
	await db
		.update(downloadBatches)
		.set({ status: DownloadBatchStatus.Failed })
		.where(eq(downloadBatches.id, batchId));
}
