<script lang="ts">
	import { resolve } from '$app/paths';
	import { FolderPlus } from '@lucide/svelte';
	import type { AlbumWithCover } from '$lib/types';
	import { photoStackPlacements } from '$lib/utils';
	import { photoUrl } from '$lib/photoUrls';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

{#snippet albumCard(album: AlbumWithCover)}
	<a href={resolve('/albums/[id]', { id: String(album.id) })} class="group block">
		<div class="relative aspect-square w-full overflow-hidden rounded-xl bg-base-200">
			{#if album.coverPhotos.length === 0}
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
				{#each album.coverPhotos as photo, i (photo.id)}
					{@const p = photoStackPlacements(album.coverPhotos.length)[i]}
					<div
						class="absolute aspect-square overflow-hidden rounded-lg shadow-md"
						style="left: {p.left}%; top: {p.top}%; width: {p.width}%; z-index: {i}; transform: translate(-50%, -50%) rotate({p.rotate}deg)"
					>
						<img
							src={photoUrl(photo, 'thumbnail')}
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
	<title>Albums — Yangle</title>
</svelte:head>

<div class="mx-auto flex min-h-full max-w-md flex-col gap-8 p-6">
	<div class="flex items-center justify-between">
		<h1 class="text-2xl font-semibold">Albums</h1>
		<a href={resolve('/albums/new')} class="btn btn-primary btn-sm">
			<FolderPlus class="size-4" /> <span class="hidden sm:inline">New album</span>
		</a>
	</div>

	<section class="flex flex-col gap-2">
		<h2 class="text-lg font-medium">Your albums</h2>
		{#if data.owned.length === 0}
			<p class="text-sm text-base-content/60">No albums yet.</p>
		{:else}
			<div class="grid grid-cols-2 gap-3">
				{#each data.owned as album (album.id)}
					{@render albumCard(album)}
				{/each}
			</div>
		{/if}
	</section>

	<section class="flex flex-col gap-2">
		<h2 class="text-lg font-medium">Shared with you</h2>
		{#if data.shared.length === 0}
			<p class="text-sm text-base-content/60">No albums shared with you yet.</p>
		{:else}
			<div class="grid grid-cols-2 gap-3">
				{#each data.shared as album (album.id)}
					{@render albumCard(album)}
				{/each}
			</div>
		{/if}
	</section>
</div>
