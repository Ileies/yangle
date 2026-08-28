import { SvelteSet } from 'svelte/reactivity';
import { PREFETCH_AHEAD_COUNT } from './constants';

// See TODO.md 3.2 for the full algorithm this implements. Kept independent of any component so
// it's testable and swappable without touching gesture/render code.
const MAX_CONCURRENT_PREFETCH = 2;

export type PrefetchTarget = { id: number; url: string };

type Entry = { image: HTMLImageElement; generation: number };

export class PrefetchQueue {
	// Reactive so a card can cross-fade in the instant its preview becomes decode-ready.
	ready = new SvelteSet<number>();
	failed = new SvelteSet<number>();

	#entries = new Map<number, Entry>();
	#generation = 0;
	#active = 0;
	#pending: PrefetchTarget[] = [];

	// Call whenever the current card (queue[0]) or its upcoming window changes. The focused
	// card is decoded at high priority and awaited first; only then does prefetching for the
	// next PREFETCH_AHEAD_COUNT cards begin, at low priority with capped concurrency.
	async focus(focused: PrefetchTarget, upcoming: PrefetchTarget[]): Promise<void> {
		const window = upcoming.slice(0, PREFETCH_AHEAD_COUNT);
		const keep = new Set([focused.id, ...window.map((p) => p.id)]);

		for (const [id, entry] of this.#entries) {
			if (!keep.has(id)) {
				entry.image.src = ''; // best-effort cancel of the in-flight request
				this.#entries.delete(id);
				this.ready.delete(id);
				this.failed.delete(id);
			}
		}
		this.#pending = this.#pending.filter(
			(target) => keep.has(target.id) && !this.#entries.has(target.id)
		);

		await this.#load(focused, 'high');

		for (const target of window) {
			if (!this.#entries.has(target.id) && !this.#pending.some((p) => p.id === target.id)) {
				this.#pending.push(target);
			}
		}
		this.#drain();
	}

	isReady(id: number): boolean {
		return this.ready.has(id);
	}

	hasFailed(id: number): boolean {
		return this.failed.has(id);
	}

	retry(target: PrefetchTarget): void {
		this.failed.delete(target.id);
		this.#entries.delete(target.id);
		void this.#load(target, 'high');
	}

	#drain(): void {
		while (this.#active < MAX_CONCURRENT_PREFETCH && this.#pending.length > 0) {
			const next = this.#pending.shift()!;
			if (this.#entries.has(next.id)) continue;
			this.#active++;
			void this.#load(next, 'low').finally(() => {
				this.#active--;
				this.#drain();
			});
		}
	}

	async #load(target: PrefetchTarget, priority: 'high' | 'low'): Promise<void> {
		const generation = ++this.#generation;
		let entry = this.#entries.get(target.id);
		if (!entry) {
			const image = new Image();
			image.fetchPriority = priority;
			image.src = target.url;
			entry = { image, generation };
			this.#entries.set(target.id, entry);
		}
		try {
			await entry.image.decode();
			if (this.#entries.get(target.id) === entry) this.ready.add(target.id);
		} catch {
			if (this.#entries.get(target.id) === entry) this.failed.add(target.id);
		}
	}

	destroy(): void {
		for (const entry of this.#entries.values()) entry.image.src = '';
		this.#entries.clear();
		this.#pending = [];
		this.ready.clear();
		this.failed.clear();
	}
}
