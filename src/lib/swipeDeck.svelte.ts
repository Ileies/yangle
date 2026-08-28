import { SvelteMap } from 'svelte/reactivity';
import { DecisionStatus, type DeckPhoto } from './types';

// Session-scoped deck state - exists only while /albums/[id]/swipe is mounted. See TODO.md 3.0.
const BATCH_INTERVAL_MS = 400;
const BATCH_SIZE = 5;
const HISTORY_LIMIT = 20;
const RETRY_DELAYS_MS = [1000, 3000, 8000];

type HistoryEntry = {
	photo: DeckPhoto;
	previousStatus: DecisionStatus;
	nextStatus: DecisionStatus;
};

type SessionCounts = { keep: number; delete: number; favorite: number };

function statusVerb(status: DecisionStatus): string {
	switch (status) {
		case DecisionStatus.Delete:
			return 'deleted';
		case DecisionStatus.Keep:
			return 'kept';
		case DecisionStatus.Favorite:
			return 'favorited';
		default:
			return 'reset';
	}
}

// One-off decision write for callers outside the deck's own queue (duplicate-bracket losers,
// see DuplicateBracket.svelte) - same upsert endpoint, same fire-and-forget-with-retry shape,
// just without the batching/history bookkeeping the deck itself needs.
export async function postDecisions(
	albumId: number,
	batch: { photoId: number; status: DecisionStatus }[],
	attempt = 0
): Promise<void> {
	if (batch.length === 0) return;
	try {
		const res = await fetch(`/albums/${albumId}/decisions`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(batch)
		});
		if (!res.ok) throw new Error(`status ${res.status}`);
	} catch {
		if (attempt < RETRY_DELAYS_MS.length) {
			setTimeout(() => void postDecisions(albumId, batch, attempt + 1), RETRY_DELAYS_MS[attempt]);
		}
	}
}

export class SwipeDeck {
	queue = $state<DeckPhoto[]>([]);
	history = $state<HistoryEntry[]>([]);
	counts = $state<SessionCounts>({ keep: 0, delete: 0, favorite: 0 });
	toastMessage = $state<string | null>(null);
	readonly total: number;

	#albumId: number;
	#statusByPhoto = new SvelteMap<number, DecisionStatus>();
	#pendingBatch: { photoId: number; status: DecisionStatus }[] = [];
	#flushTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(albumId: number, initialQueue: DeckPhoto[], total: number) {
		this.#albumId = albumId;
		this.queue = initialQueue;
		this.total = total;
	}

	get current(): DeckPhoto | undefined {
		return this.queue[0];
	}

	get upcoming(): DeckPhoto[] {
		return this.queue.slice(1);
	}

	get decidedCount(): number {
		return this.total - this.queue.length;
	}

	get lastUndoLabel(): string | null {
		const entry = this.history.at(-1);
		return entry ? `Undo: ${statusVerb(entry.nextStatus)} "${entry.photo.displayName}"` : null;
	}

	// The single entry point every gesture, button, and keyboard shortcut calls through - see
	// TODO.md 3.1's note that a decision has exactly one code path regardless of how it's made.
	decide(status: DecisionStatus): void {
		const photo = this.queue[0];
		if (!photo) return;

		const previousStatus = this.#statusByPhoto.get(photo.id) ?? DecisionStatus.Undecided;
		this.#applyCount(previousStatus, -1);
		this.#applyCount(status, 1);
		this.#statusByPhoto.set(photo.id, status);

		this.queue = this.queue.slice(1);
		this.history.push({ photo, previousStatus, nextStatus: status });
		if (this.history.length > HISTORY_LIMIT) {
			// Once an entry ages out here, its photo can never be undone back into the queue
			// (undo only ever pops the most recent entry), so #statusByPhoto no longer needs to
			// answer for it either - evict in lockstep, unless another history entry for the
			// same photo (e.g. redecided later) still needs it.
			const evicted = this.history.shift();
			if (evicted && !this.history.some((e) => e.photo.id === evicted.photo.id)) {
				this.#statusByPhoto.delete(evicted.photo.id);
			}
		}

		this.#enqueueWrite(photo.id, status);
	}

	undo(): void {
		const entry = this.history.pop();
		if (!entry) return;

		this.#applyCount(entry.nextStatus, -1);
		this.#applyCount(entry.previousStatus, 1);
		this.#statusByPhoto.set(entry.photo.id, entry.previousStatus);

		this.queue = [entry.photo, ...this.queue];
		this.#enqueueWrite(entry.photo.id, entry.previousStatus);
	}

	#applyCount(status: DecisionStatus, delta: number): void {
		if (status === DecisionStatus.Keep) this.counts.keep += delta;
		else if (status === DecisionStatus.Delete) this.counts.delete += delta;
		else if (status === DecisionStatus.Favorite) this.counts.favorite += delta;
	}

	#enqueueWrite(photoId: number, status: DecisionStatus): void {
		this.#pendingBatch.push({ photoId, status });
		if (this.#pendingBatch.length >= BATCH_SIZE) {
			this.#flush();
		} else if (!this.#flushTimer) {
			this.#flushTimer = setTimeout(() => this.#flush(), BATCH_INTERVAL_MS);
		}
	}

	#flush(): void {
		if (this.#flushTimer) {
			clearTimeout(this.#flushTimer);
			this.#flushTimer = null;
		}
		if (this.#pendingBatch.length === 0) return;
		const batch = this.#pendingBatch;
		this.#pendingBatch = [];
		void this.#send(batch, 0);
	}

	async #send(
		batch: { photoId: number; status: DecisionStatus }[],
		attempt: number
	): Promise<void> {
		try {
			const res = await fetch(`/albums/${this.#albumId}/decisions`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(batch)
			});
			if (!res.ok) throw new Error(`status ${res.status}`);
			this.toastMessage = null;
		} catch {
			if (attempt < RETRY_DELAYS_MS.length) {
				const count = batch.length;
				this.toastMessage = `Couldn't save ${count} decision${count === 1 ? '' : 's'}, retrying...`;
				setTimeout(() => void this.#send(batch, attempt + 1), RETRY_DELAYS_MS[attempt]);
			} else {
				this.toastMessage = `Couldn't save ${batch.length} decisions after several attempts.`;
			}
		}
	}

	// Best-effort flush on unmount/navigation - not awaited, per 3.0's "never block the core
	// loop on network" rule; this just avoids waiting the full debounce window unnecessarily.
	flushNow(): void {
		this.#flush();
	}
}
