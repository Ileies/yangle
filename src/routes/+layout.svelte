<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { Images, CircleUser, Layers } from '@lucide/svelte';
	import { yangle } from '$lib/state.svelte';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();

	let albumsHref = $derived(resolve('/albums'));
	let profileHref = $derived(resolve('/profile'));
	let swipeHref = $derived(
		yangle.activeSwipeAlbumId !== null
			? resolve('/albums/[id]/swipe', { id: String(yangle.activeSwipeAlbumId) })
			: resolve('/swipe')
	);
	let onSwipe = $derived(page.url.pathname === swipeHref);
	let onAlbums = $derived(page.url.pathname.startsWith(albumsHref) && !onSwipe);
	let onProfile = $derived(page.url.pathname.startsWith(profileHref));
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<div class="flex h-dvh flex-col">
	<div class="flex-1 overflow-y-auto">
		{@render children()}
	</div>

	{#if data.user}
		<nav
			class="shrink-0 border-t border-base-300 bg-base-100"
			style="padding-bottom: env(safe-area-inset-bottom)"
		>
			<div class="mx-auto flex max-w-md">
				<a
					href={albumsHref}
					class="flex flex-1 flex-col items-center gap-1 py-2 text-xs {onAlbums
						? 'text-primary'
						: 'text-base-content/60'}"
				>
					<Images class="size-6" />
					Albums
				</a>
				<a
					href={swipeHref}
					class="flex flex-1 flex-col items-center gap-1 py-2 text-xs {onSwipe
						? 'text-primary'
						: 'text-base-content/60'}"
				>
					<Layers class="size-6" />
					Swipe
				</a>
				<a
					href={profileHref}
					class="flex flex-1 flex-col items-center gap-1 py-2 text-xs {onProfile
						? 'text-primary'
						: 'text-base-content/60'}"
				>
					<CircleUser class="size-6" />
					Profile
				</a>
			</div>
		</nav>
	{/if}
</div>
