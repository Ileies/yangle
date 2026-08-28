<script lang="ts">
	import { resolve } from '$app/paths';
	import type { AlbumWithCover } from '$lib/types';
	import { photoStackPlacements } from '$lib/utils';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let albums = $derived([...data.owned, ...data.shared]);
</script>

{#snippet albumCard(album: AlbumWithCover)}
	<a href={resolve('/albums/[id]/swipe', { id: String(album.id) })} class="group block">
		<div class="relative aspect-square w-full overflow-hidden rounded-xl bg-base-200">
			{#if album.coverPhotoIds.length === 0}
				<div class="flex h-full w-full items-center justify-center text-base-content/30">
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="1.5"
						class="h-8 w-8"
					>
						<rect x="3" y="3" width="18" height="18" rx="2" />
						<circle cx="8.5" cy="8.5" r="1.5" />
						<path d="M21 15l-5-5L5 21" />
					</svg>
				</div>
			{:else}
				{#each album.coverPhotoIds as photoId, i (photoId)}
					{@const p = photoStackPlacements(album.coverPhotoIds.length)[i]}
					<div
						class="absolute aspect-square overflow-hidden rounded-lg shadow-md"
						style="left: {p.left}%; top: {p.top}%; width: {p.width}%; z-index: {i}; transform: translate(-50%, -50%) rotate({p.rotate}deg)"
					>
						<img
							src="/photos/{photoId}/thumbnail"
							alt=""
							loading="lazy"
							class="h-full w-full object-cover"
						/>
					</div>
				{/each}
			{/if}
			<div
				class="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/70 to-transparent px-3 pt-8 pb-2"
			>
				<span class="block truncate text-sm font-medium tracking-wide text-white/95"
					>{album.name}</span
				>
			</div>
		</div>
	</a>
{/snippet}

<svelte:head>
	<title>Swipe — Yangle</title>
</svelte:head>

<div class="mx-auto flex min-h-full max-w-md flex-col gap-6 p-6">
	<h1 class="text-2xl font-semibold">Choose an album to swipe</h1>

	{#if albums.length === 0}
		<p class="text-sm text-base-content/60">No albums yet.</p>
	{:else}
		<div class="grid grid-cols-2 gap-3">
			{#each albums as album (album.id)}
				{@render albumCard(album)}
			{/each}
		</div>
	{/if}
</div>
