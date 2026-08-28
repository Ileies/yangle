<script lang="ts">
	import { onMount } from 'svelte';
	import { Check } from '@lucide/svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import type { DeckPhoto } from '$lib/types';
	import { clamp } from '$lib/utils';

	// Single-elimination bracket over a burst-shot cluster (TODO.md 3.4). The bracket's state
	// (round, pairing, byes) is entirely computed client-side from the still-unresolved cluster
	// members handed in via `photos` - nothing about bracket progress is persisted server-side,
	// so a reload mid-bracket just recomputes the same bracket from whichever photos are still
	// `duplicateResolved: false`.
	let {
		albumId,
		photos,
		onEliminate,
		onAllResolved
	}: {
		albumId: number;
		photos: DeckPhoto[];
		onEliminate: (photo: DeckPhoto) => void;
		onAllResolved: () => void;
	} = $props();

	// Group by duplicateGroupId, preserving upload order within each group - burst shots are
	// usually already adjacent in upload order, so round-1 pairing naturally pits genuinely
	// similar-looking shots against each other first.
	const clusters: DeckPhoto[][] = (() => {
		const byGroup = new SvelteMap<number, DeckPhoto[]>();
		for (const photo of photos) {
			const key = photo.duplicateGroupId ?? photo.id;
			if (!byGroup.has(key)) byGroup.set(key, []);
			byGroup.get(key)!.push(photo);
		}
		return [...byGroup.values()];
	})();

	let clusterIdx = $state(0);
	let roundContestants: DeckPhoto[] = $state([]);
	let roundWinners: DeckPhoto[] = $state([]);
	let pairIdx = $state(0);
	let roundNumber = $state(1);
	let resolving = $state(false);
	let resolveError = $state<string | null>(null);
	let retryAction: (() => void) | null = $state(null);

	let currentCluster = $derived(clusters[clusterIdx] ?? []);
	let totalRounds = $derived(Math.max(1, Math.ceil(Math.log2(Math.max(currentCluster.length, 1)))));
	let currentPair = $derived.by((): [DeckPhoto, DeckPhoto] | null => {
		const a = roundContestants[pairIdx * 2];
		const b = roundContestants[pairIdx * 2 + 1];
		return a && b ? [a, b] : null;
	});

	function startCluster(idx: number): void {
		clusterIdx = idx;
		const members = clusters[idx] ?? [];
		if (members.length <= 1) {
			if (members[0]) void resolveSurvivor(members[0]);
			return;
		}
		roundContestants = [...members];
		roundWinners = [];
		pairIdx = 0;
		roundNumber = 1;
		skipByes();
	}

	function skipByes(): void {
		while (roundContestants[pairIdx * 2] && !roundContestants[pairIdx * 2 + 1]) {
			roundWinners.push(roundContestants[pairIdx * 2]);
			pairIdx++;
		}
		if (pairIdx * 2 >= roundContestants.length) finishRound();
	}

	function finishRound(): void {
		if (roundWinners.length <= 1) {
			const survivor = roundWinners[0] ?? roundContestants[0];
			if (survivor) void resolveSurvivor(survivor);
			return;
		}
		roundContestants = roundWinners;
		roundWinners = [];
		pairIdx = 0;
		roundNumber++;
		skipByes();
	}

	async function resolvePair(winner: DeckPhoto, loser: DeckPhoto): Promise<void> {
		resolving = true;
		resolveError = null;
		try {
			// A loser is done with the bracket forever, same as a survivor - flip it out of the
			// pending-cluster query now, otherwise it would keep reappearing as an unresolved
			// cluster member on every future page load even though its fate is already decided.
			await markResolved(loser.id);
		} catch {
			resolving = false;
			resolveError = "Couldn't save that choice. Check your connection and try again.";
			retryAction = () => void resolvePair(winner, loser);
			return;
		}
		resolving = false;
		onEliminate(loser);
		roundWinners.push(winner);
		advancePair();
	}

	// Both photos are worth keeping - neither is eliminated, and neither goes on to face a
	// future opponent (a "kept" photo has already had its fate decided, same as a bracket
	// survivor). Both simply exit the bracket and flow into the normal swipe deck.
	async function resolveKeepBoth(a: DeckPhoto, b: DeckPhoto): Promise<void> {
		resolving = true;
		resolveError = null;
		try {
			await markResolved(a.id);
			await markResolved(b.id);
		} catch {
			resolving = false;
			resolveError = "Couldn't save that choice. Check your connection and try again.";
			retryAction = () => void resolveKeepBoth(a, b);
			return;
		}
		resolving = false;
		advancePair();
	}

	function advancePair(): void {
		pairIdx++;
		dragPercent = 50;
		if (pairIdx * 2 >= roundContestants.length) finishRound();
		else skipByes();
	}

	async function markResolved(photoId: number): Promise<void> {
		const res = await fetch(`/albums/${albumId}/duplicates/resolve`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ photoId })
		});
		if (!res.ok) throw new Error(`status ${res.status}`);
	}

	async function resolveSurvivor(photo: DeckPhoto): Promise<void> {
		resolving = true;
		resolveError = null;
		try {
			await markResolved(photo.id);
		} catch {
			resolving = false;
			resolveError = "Couldn't save that choice. Check your connection and try again.";
			retryAction = () => void resolveSurvivor(photo);
			return;
		}
		resolving = false;
		if (clusterIdx + 1 < clusters.length) startCluster(clusterIdx + 1);
		else onAllResolved();
	}

	onMount(() => startCluster(0));

	// Draggable S-curve divider. Dragging past 65%/35% picks a side; releasing in the dead
	// zone springs back to center without a decision. Tap-to-pick buttons below each photo are
	// the non-drag fallback (3.4's explicit accessibility requirement).
	let dragPercent = $state(50);
	let dragging = $state(false);
	let containerEl: HTMLDivElement | undefined = $state();

	function percentFromPointer(clientX: number): number {
		if (!containerEl) return 50;
		const rect = containerEl.getBoundingClientRect();
		return clamp(((clientX - rect.left) / rect.width) * 100, 0, 100);
	}

	function onPointerDown(event: PointerEvent): void {
		dragging = true;
		(event.target as HTMLElement).setPointerCapture(event.pointerId);
		dragPercent = percentFromPointer(event.clientX);
	}
	function onPointerMove(event: PointerEvent): void {
		if (!dragging) return;
		dragPercent = percentFromPointer(event.clientX);
	}
	function onPointerUp(): void {
		dragging = false;
		if (!currentPair) return;
		const [left, right] = currentPair;
		if (dragPercent < 35) void resolvePair(right, left);
		else if (dragPercent > 65) void resolvePair(left, right);
		else dragPercent = 50;
	}

	let containerWidth = $state(0);
	let containerHeight = $state(0);
	let clipPath = $derived.by(() => {
		const w = containerWidth || 1;
		const h = containerHeight || 1;
		const x = (w * dragPercent) / 100;
		const amplitude = 20 + (Math.abs(dragPercent - 50) / 50) * 60;
		return `path('M ${x} 0 C ${x + amplitude} ${h * 0.25}, ${x - amplitude} ${h * 0.25}, ${x} ${h * 0.5} C ${x + amplitude} ${h * 0.75}, ${x - amplitude} ${h * 0.75}, ${x} ${h} L ${w} ${h} L ${w} 0 Z')`;
	});
</script>

{#if currentPair}
	{@const [left, right] = currentPair}
	<div class="flex min-h-full flex-col gap-4 p-4">
		<p class="text-center text-sm text-base-content/60">
			Round {roundNumber} of {totalRounds} &middot; burst {clusterIdx + 1} of {clusters.length}
		</p>
		<p class="text-center text-sm">Drag the divider toward the one you want to discard</p>

		<div
			bind:this={containerEl}
			bind:clientWidth={containerWidth}
			bind:clientHeight={containerHeight}
			class="relative flex-1 touch-none overflow-hidden rounded-2xl bg-base-300"
			onpointerdown={onPointerDown}
			onpointermove={onPointerMove}
			onpointerup={onPointerUp}
			onpointercancel={onPointerUp}
			role="slider"
			aria-label="Divider between two candidate photos"
			aria-valuenow={dragPercent}
			aria-valuemin={0}
			aria-valuemax={100}
			tabindex="0"
		>
			<img
				src="/photos/{left.id}/preview"
				alt={left.displayName}
				class="absolute inset-0 h-full w-full object-cover select-none"
				draggable="false"
			/>
			<img
				src="/photos/{right.id}/preview"
				alt={right.displayName}
				class="absolute inset-0 h-full w-full object-cover select-none"
				style:clip-path={clipPath}
				draggable="false"
			/>
		</div>

		<div class="grid grid-cols-3 gap-3">
			<button
				type="button"
				class="btn"
				disabled={resolving}
				onclick={() => void resolvePair(left, right)}><Check class="size-4" /> Keep this one</button
			>
			<button
				type="button"
				class="btn btn-ghost"
				disabled={resolving}
				onclick={() => void resolveKeepBoth(left, right)}>Keep both</button
			>
			<button
				type="button"
				class="btn"
				disabled={resolving}
				onclick={() => void resolvePair(right, left)}><Check class="size-4" /> Keep this one</button
			>
		</div>
	</div>
{:else}
	<div class="flex min-h-full items-center justify-center">
		<span class="loading loading-spinner"></span>
	</div>
{/if}

{#if resolveError}
	<div class="toast toast-center toast-bottom">
		<div class="alert alert-warning text-sm">
			<span>{resolveError}</span>
			<button type="button" class="btn btn-xs" onclick={() => retryAction?.()}>Retry</button>
		</div>
	</div>
{/if}
