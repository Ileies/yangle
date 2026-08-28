<script lang="ts">
	import { ArrowLeft, RotateCcw } from '@lucide/svelte';
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { SvelteMap } from 'svelte/reactivity';
	import PhotoViewer from '$lib/components/PhotoViewer.svelte';
	import { photoUrl } from '$lib/photoUrls';
	import { DecisionStatus, type Photo } from '$lib/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// Section 4: the durable, cross-session record of every decision - unlike the swipe deck's
	// in-deck undo (3.6), which only covers the current session's queue, this page can flip a
	// decision made at any point in the past, including duplicate-bracket losers.
	let entries = $derived(data.photos.map((entry) => ({ ...entry })));
	let filter: DecisionStatus | 'all' = $state('all');
	let openIndex: number | null = $state(null);
	let errorMessage: string | null = $state(null);

	const FILTERS: { value: DecisionStatus | 'all'; label: string }[] = [
		{ value: 'all', label: 'All' },
		{ value: DecisionStatus.Undecided, label: 'Undecided' },
		{ value: DecisionStatus.Keep, label: 'Kept' },
		{ value: DecisionStatus.Favorite, label: 'Favorited' },
		{ value: DecisionStatus.Delete, label: 'Deleted' }
	];

	let counts = $derived.by(() => {
		const byStatus = new SvelteMap<DecisionStatus, number>();
		for (const entry of entries) byStatus.set(entry.status, (byStatus.get(entry.status) ?? 0) + 1);
		return byStatus;
	});

	let visible = $derived(
		filter === 'all' ? entries : entries.filter((entry) => entry.status === filter)
	);

	let visiblePhotos = $derived(visible.map((entry) => entry.photo));
	let statuses = $derived(new SvelteMap(entries.map((entry) => [entry.photo.id, entry.status])));

	async function setStatus(photo: Photo, status: DecisionStatus): Promise<void> {
		const index = entries.findIndex((e) => e.photo.id === photo.id);
		if (index === -1) return;
		const previous = entries[index].status;
		entries = entries.map((e, i) => (i === index ? { ...e, status } : e));
		try {
			const res = await fetch(`/albums/${data.album.id}/decisions`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify([{ photoId: photo.id, status }])
			});
			if (!res.ok) throw new Error();
		} catch {
			entries = entries.map((e, i) => (i === index ? { ...e, status: previous } : e));
			errorMessage = `Couldn't update "${photo.displayName}".`;
		}
	}

	async function resetAll(): Promise<void> {
		if (entries.every((e) => e.status === DecisionStatus.Undecided)) return;
		if (!confirm(`Reset all ${entries.length} photos to undecided?`)) return;
		const previous = entries;
		entries = entries.map((e) => ({ ...e, status: DecisionStatus.Undecided }));
		try {
			const res = await fetch(`/albums/${data.album.id}/decisions`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(
					previous.map((e) => ({ photoId: e.photo.id, status: DecisionStatus.Undecided }))
				)
			});
			if (!res.ok) throw new Error();
		} catch {
			entries = previous;
			errorMessage = `Couldn't reset decisions.`;
		}
	}

	async function deletePhoto(photo: Photo): Promise<void> {
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

	function badgeClass(status: DecisionStatus): string {
		switch (status) {
			case DecisionStatus.Keep:
				return 'badge-success';
			case DecisionStatus.Favorite:
				return 'badge-secondary';
			case DecisionStatus.Delete:
				return 'badge-error';
			default:
				return 'badge-ghost';
		}
	}
</script>

<svelte:head>
	<title>Review — {data.album.name} — Yangle</title>
</svelte:head>

<div class="mx-auto flex min-h-full max-w-md flex-col gap-6 p-6">
	<a
		href={resolve('/albums/[id]', { id: String(data.album.id) })}
		class="link link-hover flex items-center gap-1 self-start text-sm text-base-content/60"
	>
		<ArrowLeft class="size-4" /> Back to album
	</a>

	<div class="flex items-center justify-between gap-2">
		<h1 class="truncate text-2xl font-semibold">{data.album.name} &middot; Review</h1>
		<button
			type="button"
			class="btn btn-ghost btn-sm shrink-0"
			onclick={resetAll}
			disabled={entries.every((e) => e.status === DecisionStatus.Undecided)}
		>
			<RotateCcw class="size-4" /> <span class="hidden sm:inline">Reset all</span>
		</button>
	</div>

	<div class="flex flex-wrap gap-2">
		{#each FILTERS as f (f.value)}
			<button
				type="button"
				class="btn btn-sm {filter === f.value ? 'btn-primary' : 'btn-ghost'}"
				onclick={() => (filter = f.value)}
			>
				{f.label}
				{#if f.value !== 'all'}
					<span class="opacity-60">{counts.get(f.value) ?? 0}</span>
				{/if}
			</button>
		{/each}
	</div>

	{#if visible.length === 0}
		<p class="text-sm text-base-content/60">No photos in this category.</p>
	{:else}
		<div class="grid grid-cols-3 gap-1">
			{#each visible as entry, i (entry.photo.id)}
				<button type="button" class="relative" onclick={() => (openIndex = i)}>
					<img
						src={photoUrl(entry.photo, 'thumbnail')}
						alt={entry.photo.displayName}
						loading="lazy"
						class="aspect-square w-full rounded object-cover"
					/>
					<span class="badge {badgeClass(entry.status)} badge-sm absolute right-1 bottom-1">
						{entry.status}
					</span>
				</button>
			{/each}
		</div>
	{/if}
</div>

{#if openIndex !== null}
	<PhotoViewer
		photos={visiblePhotos}
		bind:index={openIndex}
		onClose={() => (openIndex = null)}
		{statuses}
		onSetStatus={setStatus}
		onDelete={data.canContribute ? deletePhoto : undefined}
	/>
{/if}

{#if errorMessage}
	<div class="toast toast-center toast-bottom z-50">
		<button type="button" class="alert alert-error text-sm" onclick={() => (errorMessage = null)}>
			{errorMessage}
		</button>
	</div>
{/if}
