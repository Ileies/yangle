<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { Check } from '@lucide/svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let joining = $state(false);
	let errorMessage: string | null = $state(null);

	async function join(): Promise<void> {
		joining = true;
		try {
			const res = await fetch(`/invite/${data.token}/accept`, { method: 'POST' });
			if (!res.ok) throw new Error();
			const { albumId } = await res.json();
			await goto(resolve('/albums/[id]', { id: String(albumId) }));
		} catch {
			errorMessage = "Couldn't join this album. The link may have been revoked.";
			joining = false;
		}
	}
</script>

<svelte:head>
	<title>Join {data.album.name} — Yangle</title>
</svelte:head>

<div class="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
	<h1 class="text-2xl font-semibold">{data.album.name}</h1>

	{#if data.alreadyMember}
		<p class="text-base-content/70">You already have access to this album.</p>
		<a href={resolve('/albums/[id]', { id: String(data.album.id) })} class="btn btn-primary"
			>Open album</a
		>
	{:else}
		<p class="text-base-content/70">
			You've been invited to join as <span class="font-medium">{data.inviteRole}</span>.
		</p>
		<button type="button" class="btn btn-primary" disabled={joining} onclick={join}>
			<Check class="size-4" /> Join album
		</button>
		{#if errorMessage}
			<p class="text-sm text-error">{errorMessage}</p>
		{/if}
	{/if}
</div>
