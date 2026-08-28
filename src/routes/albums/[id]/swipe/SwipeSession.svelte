<script lang="ts">
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';
	import { resolve } from '$app/paths';
	import { ArrowLeft, RotateCw, Undo2, Upload } from '@lucide/svelte';
	import DuplicateBracket from '$lib/components/DuplicateBracket.svelte';
	import SwipeButtons from '$lib/components/SwipeButtons.svelte';
	import SwipeCard from '$lib/components/SwipeCard.svelte';
	import { DeviceOrientation } from '$lib/orientation.svelte';
	import { PrefetchQueue } from '$lib/prefetchQueue';
	import { yangle } from '$lib/state.svelte';
	import { postDecisions, SwipeDeck } from '$lib/swipeDeck.svelte';
	import { DecisionStatus } from '$lib/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// This component is remounted (keyed on album id) whenever `data.album.id` changes,
	// so reading `data` once here to construct the deck is safe.
	// svelte-ignore state_referenced_locally
	const deck = new SwipeDeck(data.album.id, data.queue, data.total);
	const prefetch = new PrefetchQueue();
	const orientation = new DeviceOrientation();

	// svelte-ignore state_referenced_locally
	let clustersPending = $state(data.clusters.length > 0);
	let reducedMotion = $state(false);
	let activeCardDragging = $state(false);
	let showRotateHint = $state(false);
	let rotateHintTimeout: ReturnType<typeof setTimeout> | undefined;
	let skipInitialOrientationEffect = true;

	function previewUrl(id: number): string {
		return `/photos/${id}/preview`;
	}
	function thumbnailUrl(id: number): string {
		return `/photos/${id}/thumbnail`;
	}

	function onEliminate(photo: (typeof data.clusters)[number]): void {
		void postDecisions(data.album.id, [{ photoId: photo.id, status: DecisionStatus.Delete }]);
	}

	$effect(() => {
		yangle.activeSwipeAlbumId = deck.current || clustersPending ? data.album.id : null;
	});

	onMount(() => {
		orientation.start();
		const media = window.matchMedia('(prefers-reduced-motion: reduce)');
		reducedMotion = media.matches;
		const onMediaChange = (e: MediaQueryListEvent) => (reducedMotion = e.matches);
		media.addEventListener('change', onMediaChange);

		const stored = localStorage.getItem('yangle:allowLandscapeRotation');
		if (stored !== null) yangle.allowLandscapeRotation = stored === 'true';

		const onKeydown = (event: KeyboardEvent) => {
			if (clustersPending) return;
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
				event.preventDefault();
				deck.undo();
				return;
			}
			if (event.key === 'ArrowLeft') deck.decide(DecisionStatus.Delete);
			else if (event.key === 'ArrowRight') deck.decide(DecisionStatus.Keep);
			else if (event.key === 'ArrowUp') deck.decide(DecisionStatus.Favorite);
		};
		window.addEventListener('keydown', onKeydown);

		const onBeforeUnload = () => deck.flushNow();
		window.addEventListener('beforeunload', onBeforeUnload);

		return () => {
			orientation.stop();
			media.removeEventListener('change', onMediaChange);
			window.removeEventListener('keydown', onKeydown);
			window.removeEventListener('beforeunload', onBeforeUnload);
			clearTimeout(rotateHintTimeout);
			prefetch.destroy();
			deck.flushNow();
		};
	});

	$effect(() => {
		const current = deck.current;
		if (!current) return;
		void prefetch.focus(
			{ id: current.id, url: previewUrl(current.id) },
			deck.upcoming.map((p) => ({ id: p.id, url: previewUrl(p.id) }))
		);
	});

	function toggleLandscapeRotation(): void {
		yangle.allowLandscapeRotation = !yangle.allowLandscapeRotation;
		localStorage.setItem('yangle:allowLandscapeRotation', String(yangle.allowLandscapeRotation));
	}

	$effect(() => {
		void orientation.isLandscape;
		if (skipInitialOrientationEffect) {
			skipInitialOrientationEffect = false;
			return;
		}
		showRotateHint = true;
		clearTimeout(rotateHintTimeout);
		rotateHintTimeout = setTimeout(() => (showRotateHint = false), 3000);
	});
</script>

<svelte:head>
	<title>Swipe &middot; {data.album.name}</title>
</svelte:head>

{#if clustersPending}
	<DuplicateBracket
		albumId={data.album.id}
		photos={data.clusters}
		{onEliminate}
		onAllResolved={() => (clustersPending = false)}
	/>
{:else if deck.current}
	<div class="flex min-h-full flex-col gap-3 p-3 pb-0">
		<div>
			<progress class="progress progress-primary w-full" value={deck.decidedCount} max={deck.total}
			></progress>
			<p class="text-center text-xs text-base-content/60">{deck.decidedCount} / {deck.total}</p>
		</div>

		<div class="relative flex-1">
			{#if showRotateHint}
				<div class="absolute inset-x-0 top-4 z-30 flex justify-center" transition:fade>
					<button
						type="button"
						class="btn btn-circle btn-ghost btn-sm bg-base-100/70 backdrop-blur-sm"
						onclick={toggleLandscapeRotation}
						title="Rotate layout with device"
						aria-pressed={yangle.allowLandscapeRotation}
					>
						<RotateCw class="size-4" />
					</button>
				</div>
			{/if}
			{#each deck.queue.slice(0, 3) as photo, i (photo.id)}
				<div class="absolute inset-0" style:z-index={10 - i}>
					<SwipeCard
						displayName={photo.displayName}
						previewUrl={previewUrl(photo.id)}
						thumbnailUrl={thumbnailUrl(photo.id)}
						active={i === 0}
						previewReady={prefetch.isReady(photo.id)}
						previewFailed={prefetch.hasFailed(photo.id)}
						{reducedMotion}
						onDecide={(status) => deck.decide(status)}
						onRetry={() => prefetch.retry({ id: photo.id, url: previewUrl(photo.id) })}
						onDraggingChange={(value) => (activeCardDragging = value)}
					/>
				</div>
			{/each}

			<div
				class="absolute inset-x-0 bottom-4 z-20 flex flex-col items-center gap-2 transition-opacity duration-150"
				class:opacity-0={activeCardDragging}
				class:pointer-events-none={activeCardDragging}
			>
				<SwipeButtons
					angle={orientation.isLandscape ? 90 : 0}
					onDecide={(status) => deck.decide(status)}
				/>

				{#if deck.history.length > 0}
					<button
						type="button"
						class="btn btn-ghost btn-sm bg-base-100/70 backdrop-blur-sm"
						onclick={() => deck.undo()}
					>
						<Undo2 class="size-4" />
						{deck.lastUndoLabel}
					</button>
				{/if}
			</div>
		</div>
	</div>

	{#if deck.toastMessage}
		<div class="toast toast-center toast-bottom">
			<div class="alert alert-warning text-sm">{deck.toastMessage}</div>
		</div>
	{/if}
{:else if deck.total === 0}
	<div class="flex min-h-full flex-col items-center justify-center gap-4 p-6 text-center">
		<p class="text-lg font-medium">Nothing to swipe yet</p>
		<p class="text-sm text-base-content/60">
			{#if data.canContribute}
				Upload some photos first.
			{:else}
				Everything's already been decided.
			{/if}
		</p>
		<div class="flex gap-3">
			{#if data.canContribute}
				<a
					href={resolve('/albums/[id]/upload', { id: String(data.album.id) })}
					class="btn btn-primary"><Upload class="size-4" /> Upload</a
				>
			{/if}
			<a href={resolve('/albums/[id]', { id: String(data.album.id) })} class="btn"
				><ArrowLeft class="size-4" /> Back to album</a
			>
		</div>
	</div>
{:else}
	<div class="flex min-h-full flex-col items-center justify-center gap-4 p-6 text-center">
		<p class="text-lg font-medium">All done!</p>
		<p class="text-sm text-base-content/60">
			{deck.counts.keep} kept &middot; {deck.counts.favorite} favorited &middot; {deck.counts
				.delete} deleted this session
		</p>
		<div class="flex gap-3">
			<a
				href={resolve('/albums/[id]/review', { id: String(data.album.id) })}
				class="btn btn-primary">Review decisions</a
			>
			<a href={resolve('/albums/[id]', { id: String(data.album.id) })} class="btn"
				><ArrowLeft class="size-4" /> Back to album</a
			>
		</div>
	</div>
{/if}
