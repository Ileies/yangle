<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import {
		ArrowUp,
		Check,
		Download,
		Heart,
		Layers,
		ListChecks,
		Scale,
		Settings,
		Trash2,
		Upload,
		X
	} from '@lucide/svelte';
	import PhotoViewer from '$lib/components/PhotoViewer.svelte';
	import { photoUrl } from '$lib/photoUrls';
	import { AlbumRole, DecisionMode, DecisionStatus, type Photo } from '$lib/types';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let openIndex: number | null = $state(null);
	let pageElement: HTMLDivElement;
	let selected = new SvelteSet<number>();
	let errorMessage: string | null = $state(null);
	let statuses = new SvelteMap<number, DecisionStatus>();
	$effect(() => {
		statuses.clear();
		for (const [photoId, status] of data.decisions) statuses.set(photoId, status);
	});

	async function setStatus(photo: Photo, status: DecisionStatus): Promise<void> {
		const previous = statuses.get(photo.id) ?? DecisionStatus.Undecided;
		statuses.set(photo.id, status);
		try {
			const res = await fetch(`/albums/${data.album.id}/decisions`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify([{ photoId: photo.id, status }])
			});
			if (!res.ok) throw new Error();
		} catch {
			statuses.set(photo.id, previous);
			errorMessage = `Couldn't update "${photo.displayName}".`;
		}
	}

	const LONG_PRESS_MS = 450;
	const MOVE_CANCEL_PX = 10;
	let longPressTimer: ReturnType<typeof setTimeout> | null = null;
	let pointerStart: { x: number; y: number } | null = null;
	let suppressNextClick = false;

	function toggleSelected(id: number) {
		if (selected.has(id)) selected.delete(id);
		else selected.add(id);
	}

	function clearLongPress() {
		if (longPressTimer) clearTimeout(longPressTimer);
		longPressTimer = null;
		pointerStart = null;
	}

	function onPointerDown(e: PointerEvent, id: number) {
		if (e.pointerType === 'mouse' && e.button !== 0) return;
		pointerStart = { x: e.clientX, y: e.clientY };
		longPressTimer = setTimeout(() => {
			toggleSelected(id);
			suppressNextClick = true;
			navigator.vibrate?.(15);
			longPressTimer = null;
		}, LONG_PRESS_MS);
	}

	function onPointerMove(e: PointerEvent) {
		if (!pointerStart) return;
		if (Math.hypot(e.clientX - pointerStart.x, e.clientY - pointerStart.y) > MOVE_CANCEL_PX) {
			clearLongPress();
		}
	}

	function onContextMenu(e: MouseEvent, id: number) {
		e.preventDefault();
		clearLongPress();
		toggleSelected(id);
	}

	function onThumbClick(id: number, index: number) {
		if (suppressNextClick) {
			suppressNextClick = false;
			return;
		}
		if (selected.size > 0) toggleSelected(id);
		else openIndex = index;
	}

	async function bulkDecide(status: DecisionStatus) {
		const photoIds = [...selected];
		selected.clear();
		try {
			const res = await fetch(`/albums/${data.album.id}/decisions`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(photoIds.map((photoId) => ({ photoId, status })))
			});
			if (!res.ok) throw new Error();
		} catch {
			errorMessage = `Couldn't update ${photoIds.length} photo${photoIds.length === 1 ? '' : 's'}.`;
		}
	}

	async function bulkDelete() {
		const photoIds = [...selected];
		const count = photoIds.length;
		if (!confirm(`Delete ${count} photo${count === 1 ? '' : 's'}? This can't be undone.`)) return;
		selected.clear();
		try {
			const res = await fetch(`/albums/${data.album.id}/photos`, {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(photoIds)
			});
			if (!res.ok) throw new Error();
			await invalidateAll();
		} catch {
			errorMessage = `Couldn't delete ${count} photo${count === 1 ? '' : 's'}.`;
		}
	}

	async function deletePhoto(photo: Photo) {
		if (!confirm(`Delete "${photo.displayName}" permanently? This can't be undone.`)) return;
		try {
			const res = await fetch(`/albums/${data.album.id}/photos`, {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify([photo.id])
			});
			if (!res.ok) throw new Error();
			openIndex = null;
			await invalidateAll();
		} catch {
			errorMessage = `Couldn't delete "${photo.displayName}".`;
		}
	}
</script>

<svelte:head>
	<title>{data.album.name} — Yangle</title>
</svelte:head>

<div bind:this={pageElement} class="mx-auto flex min-h-full max-w-md flex-col gap-6 p-6">
	<div class="flex items-center justify-between">
		<h1 class="truncate text-2xl font-semibold">{data.album.name}</h1>
		<div class="flex gap-2">
			{#if data.canContribute}
				<a
					href={resolve('/albums/[id]/upload', { id: String(data.album.id) })}
					class="btn btn-primary btn-sm"
					aria-label="Upload"
					title="Upload"
				>
					<Upload class="size-4" />
				</a>
			{/if}
			{#if data.photos.length > 0}
				<a
					href={resolve('/albums/[id]/swipe', { id: String(data.album.id) })}
					class="btn btn-secondary btn-sm"
					aria-label="Swipe"
					title="Swipe"
				>
					<Layers class="size-4" />
				</a>
				<a
					href={resolve('/albums/[id]/review', { id: String(data.album.id) })}
					class="btn btn-ghost btn-sm"
					aria-label="Review"
					title="Review"
				>
					<ListChecks class="size-4" />
				</a>
				<a
					href={resolve('/albums/[id]/download', { id: String(data.album.id) })}
					class="btn btn-ghost btn-sm"
					aria-label="Download"
					title="Download"
				>
					<Download class="size-4" />
				</a>
			{/if}
			{#if data.album.decisionMode === DecisionMode.Together}
				<a
					href={resolve('/albums/[id]/resolve', { id: String(data.album.id) })}
					class="btn btn-ghost btn-sm"
					aria-label="Resolve disagreements"
					title="Resolve disagreements"
				>
					<Scale class="size-4" />
				</a>
			{/if}
			{#if data.role === AlbumRole.Owner}
				<a
					href={resolve('/albums/[id]/settings', { id: String(data.album.id) })}
					class="btn btn-ghost btn-sm"
					aria-label="Settings"
					title="Settings"
				>
					<Settings class="size-4" />
				</a>
			{/if}
		</div>
	</div>

	{#if data.photos.length === 0}
		<p class="text-sm text-base-content/60">
			No photos yet.{#if data.canContribute}
				Use "Upload" to add some.{/if}
		</p>
	{:else}
		<div class="grid grid-cols-3 gap-1">
			{#each data.photos as photo, i (photo.id)}
				<button
					type="button"
					class="contents"
					onpointerdown={(e) => onPointerDown(e, photo.id)}
					onpointerup={clearLongPress}
					onpointerleave={clearLongPress}
					onpointermove={onPointerMove}
					oncontextmenu={(e) => onContextMenu(e, photo.id)}
					onclick={() => onThumbClick(photo.id, i)}
				>
					<div class="relative">
						<img
							src={photoUrl(photo, 'thumbnail')}
							alt={photo.displayName}
							loading="lazy"
							class="aspect-square w-full rounded object-cover"
						/>
						{#if selected.has(photo.id)}
							<div
								class="absolute inset-0 rounded ring-2 ring-primary ring-inset bg-primary/20"
							></div>
						{/if}
					</div>
				</button>
			{/each}
		</div>
	{/if}

	{#if data.photos.length > 0}
		<button
			type="button"
			onclick={() => pageElement.scrollIntoView({ behavior: 'smooth' })}
			class="link link-hover flex items-center gap-1 self-start text-sm text-base-content/60"
		>
			<ArrowUp class="size-4" /> Back to top
		</button>
	{/if}
</div>

{#if selected.size > 0}
	<div
		class="fixed inset-x-0 bottom-16 z-40 flex items-center justify-between gap-2 border-t border-base-300 bg-base-100 p-3"
	>
		<span class="text-sm">{selected.size} selected</span>
		<div class="flex flex-wrap justify-end gap-2">
			<button
				type="button"
				class="btn btn-circle btn-sm btn-ghost"
				title="Delete"
				aria-label="Mark selected as delete"
				onclick={() => bulkDecide(DecisionStatus.Delete)}><Trash2 class="size-4" /></button
			>
			<button
				type="button"
				class="btn btn-circle btn-sm btn-ghost"
				title="Favorite"
				aria-label="Mark selected as favorite"
				onclick={() => bulkDecide(DecisionStatus.Favorite)}><Heart class="size-4" /></button
			>
			<button
				type="button"
				class="btn btn-circle btn-sm btn-ghost"
				title="Keep"
				aria-label="Mark selected as keep"
				onclick={() => bulkDecide(DecisionStatus.Keep)}><Check class="size-4" /></button
			>
			{#if data.canContribute}
				<button
					type="button"
					class="btn btn-circle btn-sm btn-ghost text-error"
					title="Delete permanently"
					aria-label="Delete selected permanently"
					onclick={bulkDelete}><Trash2 class="size-4" /></button
				>
			{/if}
			<button
				type="button"
				class="btn btn-circle btn-sm btn-ghost"
				title="Cancel"
				aria-label="Cancel selection"
				onclick={() => selected.clear()}><X class="size-4" /></button
			>
		</div>
	</div>
{/if}

{#if errorMessage}
	<div class="toast toast-center toast-bottom z-50">
		<button type="button" class="alert alert-error text-sm" onclick={() => (errorMessage = null)}>
			{errorMessage}
		</button>
	</div>
{/if}

{#if openIndex !== null}
	<PhotoViewer
		photos={data.photos}
		bind:index={openIndex}
		onClose={() => (openIndex = null)}
		{statuses}
		onSetStatus={setStatus}
		onDelete={data.canContribute ? deletePhoto : undefined}
	/>
{/if}
