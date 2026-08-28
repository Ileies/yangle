<script lang="ts">
	import { resolve } from '$app/paths';
	import { ArrowLeft, Download } from '@lucide/svelte';
	import { DecisionStatus } from '$lib/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const downloadCount = $derived(
		data.entries.filter((e) => e.decision !== DecisionStatus.Undecided).length
	);

	function badgeLabel(badge: (typeof data.entries)[number]['badge']): string {
		if (badge === 'downloaded') return 'downloaded';
		if (badge === 'new') return 'new';
		return 'not yet decided';
	}

	function badgeClass(badge: (typeof data.entries)[number]['badge']): string {
		if (badge === 'downloaded') return 'badge-ghost';
		if (badge === 'new') return 'badge-primary';
		return 'badge-outline';
	}
</script>

<svelte:head>
	<title>Download — {data.album.name} — Yangle</title>
</svelte:head>

<div class="mx-auto flex min-h-dvh max-w-md flex-col gap-6 p-6">
	<a
		href={resolve('/albums/[id]', { id: String(data.album.id) })}
		class="link link-hover flex items-center gap-1 self-start text-sm text-base-content/60"
	>
		<ArrowLeft class="size-4" /> Back to album
	</a>

	<h1 class="truncate text-2xl font-semibold">{data.album.name} &middot; Download</h1>

	{#if downloadCount === 0}
		<p class="text-sm text-base-content/60">
			Nothing to download yet — keep or favorite some photos first.
		</p>
	{:else}
		<a
			href={resolve('/albums/[id]/download/zip', { id: String(data.album.id) })}
			class="btn btn-primary self-start"
		>
			<Download class="size-4" /> Download ZIP ({downloadCount})
		</a>
	{/if}

	{#if data.entries.length > 0}
		<ul class="flex flex-col gap-2">
			{#each data.entries as entry (entry.photo.id)}
				<li class="flex items-center gap-3 rounded bg-base-200 p-2">
					<img
						src="/photos/{entry.photo.id}/thumbnail"
						alt={entry.photo.displayName}
						class="size-12 shrink-0 rounded object-cover"
					/>
					<span class="flex-1 truncate text-sm">{entry.photo.displayName}</span>
					<span class="badge badge-sm {badgeClass(entry.badge)}">{badgeLabel(entry.badge)}</span>
				</li>
			{/each}
		</ul>
	{/if}
</div>
