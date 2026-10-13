<script lang="ts">
	import { resolve } from '$app/paths';
	import { ArrowLeft, Download } from '@lucide/svelte';
	import { DecisionStatus } from '$lib/types';
	import { photoUrl } from '$lib/photoUrls';
	import { guardWeChatDownload } from '$lib/wechat';
	import WeChatDownloadNotice from '$lib/components/WeChatDownloadNotice.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let wechatDialogEl: HTMLDialogElement | undefined = $state();

	const downloadCount = $derived(
		data.entries.filter((e) => e.decision !== DecisionStatus.Undecided).length
	);

	let format: 'original' | 'compatible' = $state('original');

	// Only offer a choice when it changes something: HEIC/HEIF photos carry a JPEG rendition.
	const compatibleCount = $derived(
		data.entries.filter(
			(e) => e.decision !== DecisionStatus.Undecided && e.photo.compatOriginalPath !== null
		).length
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
		{#if compatibleCount > 0}
			<fieldset class="flex flex-col gap-2">
				<legend class="mb-1 text-sm text-base-content/60">
					{compatibleCount} HEIC {compatibleCount === 1 ? 'photo' : 'photos'} in this download
				</legend>
				<label class="flex cursor-pointer items-start gap-2 text-sm">
					<input
						type="radio"
						name="format"
						value="original"
						class="radio radio-sm mt-0.5"
						bind:group={format}
					/>
					<span>
						<span class="font-medium">Original (HEIC)</span><br />
						<span class="text-base-content/60">Untouched files, best for Apple devices.</span>
					</span>
				</label>
				<label class="flex cursor-pointer items-start gap-2 text-sm">
					<input
						type="radio"
						name="format"
						value="compatible"
						class="radio radio-sm mt-0.5"
						bind:group={format}
					/>
					<span>
						<span class="font-medium">Compatible (JPEG)</span><br />
						<span class="text-base-content/60">Opens everywhere, e.g. Windows and Android.</span>
					</span>
				</label>
			</fieldset>
		{/if}
		<a
			href="{resolve('/albums/[id]/download/zip', { id: String(data.album.id) })}?format={format}"
			class="btn btn-primary self-start"
			onclick={(e) => guardWeChatDownload(e, wechatDialogEl)}
		>
			<Download class="size-4" /> Download ZIP ({downloadCount})
		</a>
	{/if}

	{#if data.entries.length > 0}
		<ul class="flex flex-col gap-2">
			{#each data.entries as entry (entry.photo.id)}
				<li class="flex items-center gap-3 rounded bg-base-200 p-2">
					<img
						src={photoUrl(entry.photo, 'thumbnail')}
						alt={entry.photo.displayName}
						class="size-12 shrink-0 rounded object-cover"
					/>
					<span class="flex-1 truncate text-sm">{entry.photo.displayName}</span>
					<span class="badge badge-sm {badgeClass(entry.badge)}">{badgeLabel(entry.badge)}</span>
				</li>
			{/each}
		</ul>
	{/if}

	<WeChatDownloadNotice bind:dialogEl={wechatDialogEl} />
</div>
