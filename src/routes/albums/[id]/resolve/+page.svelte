<script lang="ts">
	import { ArrowLeft, Check, Heart, Trash2 } from '@lucide/svelte';
	import { resolve } from '$app/paths';
	import { DecisionStatus } from '$lib/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let remaining = $state([...data.conflicts]);
	let busy = $state(false);
	let errorMessage: string | null = $state(null);

	function statusLabel(status: DecisionStatus): string {
		if (status === DecisionStatus.Undecided) return 'undecided';
		return status;
	}

	async function pick(photoId: number, status: DecisionStatus): Promise<void> {
		busy = true;
		try {
			const res = await fetch(`/albums/${data.album.id}/resolve/apply`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ photoId, status })
			});
			if (!res.ok) throw new Error();
			remaining = remaining.filter((entry) => entry.photo.id !== photoId);
		} catch {
			errorMessage = "Couldn't save that decision.";
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head>
	<title>Resolve — {data.album.name} — Yangle</title>
</svelte:head>

<div class="mx-auto flex min-h-dvh max-w-md flex-col gap-6 p-6">
	<a
		href={resolve('/albums/[id]', { id: String(data.album.id) })}
		class="link link-hover flex items-center gap-1 self-start text-sm text-base-content/60"
	>
		<ArrowLeft class="size-4" /> Back to album
	</a>

	<h1 class="truncate text-2xl font-semibold">{data.album.name} &middot; Resolve</h1>

	{#if remaining.length === 0}
		<p class="text-sm text-base-content/60">
			No disagreements to resolve. Photos show up here once everyone has decided and their decisions
			don't match.
		</p>
	{:else}
		<p class="text-sm text-base-content/60">
			{remaining.length} photo{remaining.length === 1 ? '' : 's'} where you disagreed. Pick the final
			call for each.
		</p>
		<ul class="flex flex-col gap-6">
			{#each remaining as entry (entry.photo.id)}
				<li class="flex flex-col gap-3 rounded-2xl bg-base-200 p-3">
					<img
						src="/photos/{entry.photo.id}/preview"
						alt={entry.photo.displayName}
						class="max-h-72 w-full rounded-lg object-contain"
					/>
					<ul class="flex flex-wrap gap-2 text-xs text-base-content/60">
						{#each entry.decisions as d (d.email)}
							<li class="badge badge-ghost badge-sm">{d.email}: {statusLabel(d.status)}</li>
						{/each}
					</ul>
					<div class="grid grid-cols-3 gap-2">
						<button
							type="button"
							class="btn btn-sm"
							disabled={busy}
							onclick={() => pick(entry.photo.id, DecisionStatus.Delete)}
						>
							<Trash2 class="size-4" /> Delete
						</button>
						<button
							type="button"
							class="btn btn-sm"
							disabled={busy}
							onclick={() => pick(entry.photo.id, DecisionStatus.Favorite)}
						>
							<Heart class="size-4" /> Favorite
						</button>
						<button
							type="button"
							class="btn btn-sm"
							disabled={busy}
							onclick={() => pick(entry.photo.id, DecisionStatus.Keep)}
						>
							<Check class="size-4" /> Keep
						</button>
					</div>
				</li>
			{/each}
		</ul>
	{/if}

	{#if errorMessage}
		<div class="toast toast-center toast-bottom z-50">
			<button type="button" class="alert alert-error text-sm" onclick={() => (errorMessage = null)}>
				{errorMessage}
			</button>
		</div>
	{/if}
</div>
