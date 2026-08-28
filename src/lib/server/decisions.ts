import { db } from './db';
import { decisions } from './db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { DecisionStatus } from '$lib/types';

export type DecisionInput = { photoId: number; status: DecisionStatus };

// Upsert on (photoId, email) - a decision is never inserted-then-appended, always the current
// status for that person on that photo. This is what makes both in-deck undo (3.6) and the
// durable review-list undo (Section 4) just callers of the same write path.
export async function applyDecisions(email: string, inputs: DecisionInput[]): Promise<void> {
	if (inputs.length === 0) return;
	for (const input of inputs) {
		await db
			.insert(decisions)
			.values({ photoId: input.photoId, email, status: input.status, decidedAt: Date.now() })
			.onConflictDoUpdate({
				target: [decisions.photoId, decisions.email],
				set: { status: input.status, decidedAt: Date.now() }
			});
	}
}

// The "final joint call" for a `decisionMode: together` album (Section 5) - writes the same
// status for every participant on this one photo, which is what makes it "resolved" again as
// far as the conflict query (conflicts.ts) is concerned: everyone agrees once more.
export async function applyDecisionToAll(
	emails: string[],
	photoId: number,
	status: DecisionStatus
): Promise<void> {
	await Promise.all(emails.map((email) => applyDecisions(email, [{ photoId, status }])));
}

// This user's current decisions across a set of photos, keyed by photoId. Missing entries mean
// undecided (no row written yet) - callers should treat `undefined` the same as `Undecided`.
export async function getDecisionsFor(
	email: string,
	photoIds: number[]
): Promise<Map<number, DecisionStatus>> {
	if (photoIds.length === 0) return new Map();
	const rows = await db.query.decisions.findMany({
		where: and(eq(decisions.email, email), inArray(decisions.photoId, photoIds))
	});
	return new Map(rows.map((row) => [row.photoId, row.status]));
}
