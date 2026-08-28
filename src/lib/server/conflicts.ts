import { db } from './db';
import { decisions } from './db/schema';
import { inArray } from 'drizzle-orm';
import { listParticipants } from './albums';
import { listResolvedUndecided } from './photos';
import { DecisionStatus } from '$lib/types';
import type { Photo } from '$lib/types';

export type ConflictEntry = {
	photo: Photo;
	decisions: { email: string; status: DecisionStatus }[];
};

// The "swipe-all-then-resolve" conflict set (TODO.md 5, resolveMode: SwipeAllThenResolve): a
// photo only shows up here once every participant has made a real decision (not Undecided) AND
// those decisions don't all agree. Still-pending photos (someone hasn't swiped yet) and
// already-agreed photos are both excluded - there's nothing for the joint-resolution screen to
// do with either.
export async function listConflicts(albumId: number): Promise<ConflictEntry[]> {
	const participants = await listParticipants(albumId);
	if (participants.length <= 1) return [];

	const photos = await listResolvedUndecided(albumId);
	if (photos.length === 0) return [];

	const rows = await db.query.decisions.findMany({
		where: inArray(
			decisions.photoId,
			photos.map((photo) => photo.id)
		)
	});
	const byPhoto = new Map<number, Map<string, DecisionStatus>>();
	for (const row of rows) {
		if (!participants.includes(row.email)) continue;
		if (!byPhoto.has(row.photoId)) byPhoto.set(row.photoId, new Map());
		byPhoto.get(row.photoId)!.set(row.email, row.status);
	}

	const conflicts: ConflictEntry[] = [];
	for (const photo of photos) {
		const byEmail = byPhoto.get(photo.id);
		if (!byEmail) continue;
		const entries = participants.map((email) => ({
			email,
			status: byEmail.get(email) ?? DecisionStatus.Undecided
		}));
		const allDecided = entries.every((entry) => entry.status !== DecisionStatus.Undecided);
		if (!allDecided) continue;
		const allAgree = entries.every((entry) => entry.status === entries[0].status);
		if (allAgree) continue;
		conflicts.push({ photo, decisions: entries });
	}
	return conflicts;
}
