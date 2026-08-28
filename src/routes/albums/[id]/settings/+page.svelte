<script lang="ts">
	import { untrack } from 'svelte';
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { ArrowLeft, Copy, Link2, Trash2, UserMinus, UserPlus } from '@lucide/svelte';
	import { AlbumRole, DecisionMode, ResolveMode } from '$lib/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let inviteEmail = $state('');
	let inviteRole: AlbumRole.Contributor | AlbumRole.Viewer = $state(AlbumRole.Contributor);
	let linkRole: AlbumRole.Contributor | AlbumRole.Viewer = $state(AlbumRole.Viewer);
	// Seeded once from the loaded album, then a locally-editable form draft - deliberately not
	// reactive to `data.album` changing (untrack silences the "you probably meant $derived"
	// warning, which doesn't apply to editable form state).
	let decisionMode: DecisionMode = $state(untrack(() => data.album.decisionMode));
	let resolveMode: ResolveMode = $state(
		untrack(() => data.album.resolveMode ?? ResolveMode.SwipeAllThenResolve)
	);
	let deleteConfirmText = $state('');
	let errorMessage: string | null = $state(null);
	let busy = $state(false);

	let inviteUrl = $derived(
		data.album.inviteToken ? `${page.url.origin}/invite/${data.album.inviteToken}` : null
	);

	async function inviteByEmail(): Promise<void> {
		if (!inviteEmail.trim()) return;
		busy = true;
		try {
			const res = await fetch(`/albums/${data.album.id}/shares`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email: inviteEmail.trim().toLowerCase(), role: inviteRole })
			});
			if (!res.ok) throw new Error(await res.text());
			inviteEmail = '';
			await invalidateAll();
		} catch {
			errorMessage = "Couldn't share the album with that address.";
		} finally {
			busy = false;
		}
	}

	async function removeShare(email: string): Promise<void> {
		busy = true;
		try {
			const res = await fetch(`/albums/${data.album.id}/shares`, {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email })
			});
			if (!res.ok) throw new Error();
			await invalidateAll();
		} catch {
			errorMessage = "Couldn't remove that person.";
		} finally {
			busy = false;
		}
	}

	async function generateLink(): Promise<void> {
		busy = true;
		try {
			const res = await fetch(`/albums/${data.album.id}/invite-link`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ role: linkRole })
			});
			if (!res.ok) throw new Error();
			await invalidateAll();
		} catch {
			errorMessage = "Couldn't create a link.";
		} finally {
			busy = false;
		}
	}

	async function revokeLink(): Promise<void> {
		busy = true;
		try {
			const res = await fetch(`/albums/${data.album.id}/invite-link`, { method: 'DELETE' });
			if (!res.ok) throw new Error();
			await invalidateAll();
		} catch {
			errorMessage = "Couldn't revoke the link.";
		} finally {
			busy = false;
		}
	}

	async function copyLink(): Promise<void> {
		if (inviteUrl) await navigator.clipboard.writeText(inviteUrl);
	}

	async function saveDecisionSettings(): Promise<void> {
		busy = true;
		try {
			const res = await fetch(`/albums/${data.album.id}/decision-mode`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					decisionMode,
					resolveMode: decisionMode === DecisionMode.Together ? resolveMode : null
				})
			});
			if (!res.ok) throw new Error();
			await invalidateAll();
		} catch {
			errorMessage = "Couldn't save decision settings.";
		} finally {
			busy = false;
		}
	}

	async function deleteAlbumForever(): Promise<void> {
		if (deleteConfirmText !== data.album.name) return;
		busy = true;
		try {
			const res = await fetch(`/albums/${data.album.id}/delete`, { method: 'DELETE' });
			if (!res.ok) throw new Error();
			await goto(resolve('/albums'));
		} catch {
			errorMessage = "Couldn't delete the album.";
			busy = false;
		}
	}
</script>

<svelte:head>
	<title>Settings — {data.album.name} — Yangle</title>
</svelte:head>

<div class="mx-auto flex min-h-dvh max-w-md flex-col gap-8 p-6">
	<a
		href={resolve('/albums/[id]', { id: String(data.album.id) })}
		class="link link-hover flex items-center gap-1 self-start text-sm text-base-content/60"
	>
		<ArrowLeft class="size-4" /> Back to album
	</a>

	<h1 class="truncate text-2xl font-semibold">{data.album.name} &middot; Settings</h1>

	<section class="flex flex-col gap-3">
		<h2 class="font-medium">Shared with</h2>
		{#if data.shares.length === 0}
			<p class="text-sm text-base-content/60">Nobody yet — invite someone below.</p>
		{:else}
			<ul class="flex flex-col gap-2">
				{#each data.shares as share (share.id)}
					<li class="flex items-center justify-between gap-2 rounded bg-base-200 p-2 text-sm">
						<span class="truncate">{share.email}</span>
						<div class="flex items-center gap-2">
							<span class="badge badge-ghost badge-sm">{share.role}</span>
							<button
								type="button"
								class="btn btn-circle btn-ghost btn-xs"
								disabled={busy}
								aria-label="Remove {share.email}"
								onclick={() => removeShare(share.email)}><UserMinus class="size-3.5" /></button
							>
						</div>
					</li>
				{/each}
			</ul>
		{/if}

		<div class="flex gap-2">
			<input
				type="email"
				placeholder="someone@example.com"
				bind:value={inviteEmail}
				class="input input-bordered input-sm flex-1"
			/>
			<select bind:value={inviteRole} class="select select-bordered select-sm">
				<option value={AlbumRole.Contributor}>Contributor</option>
				<option value={AlbumRole.Viewer}>Viewer</option>
			</select>
			<button
				type="button"
				class="btn btn-primary btn-sm"
				disabled={busy || !inviteEmail.trim()}
				onclick={inviteByEmail}
			>
				<UserPlus class="size-4" />
			</button>
		</div>
	</section>

	<section class="flex flex-col gap-3">
		<h2 class="font-medium">Shareable link</h2>
		{#if inviteUrl}
			<p class="text-sm text-base-content/60">
				Anyone with this link can join as <span class="font-medium">{data.album.inviteRole}</span>.
			</p>
			<div class="flex gap-2">
				<input
					type="text"
					readonly
					value={inviteUrl}
					class="input input-bordered input-sm flex-1 text-xs"
				/>
				<button type="button" class="btn btn-ghost btn-sm" onclick={copyLink}
					><Copy class="size-4" /></button
				>
				<button type="button" class="btn btn-ghost btn-sm" disabled={busy} onclick={revokeLink}
					>Revoke</button
				>
			</div>
		{:else}
			<div class="flex gap-2">
				<select bind:value={linkRole} class="select select-bordered select-sm flex-1">
					<option value={AlbumRole.Contributor}>Contributor</option>
					<option value={AlbumRole.Viewer}>Viewer</option>
				</select>
				<button type="button" class="btn btn-sm" disabled={busy} onclick={generateLink}>
					<Link2 class="size-4" /> Generate link
				</button>
			</div>
		{/if}
	</section>

	<section class="flex flex-col gap-3">
		<h2 class="font-medium">Decision mode</h2>
		<div class="flex flex-col gap-2">
			<label class="flex items-center gap-2 text-sm">
				<input
					type="radio"
					name="decisionMode"
					class="radio radio-sm"
					value={DecisionMode.Independent}
					bind:group={decisionMode}
				/>
				Independent — everyone's decisions are their own
			</label>
			<label class="flex items-center gap-2 text-sm">
				<input
					type="radio"
					name="decisionMode"
					class="radio radio-sm"
					value={DecisionMode.Together}
					bind:group={decisionMode}
				/>
				Together — swipe separately, then resolve disagreements jointly
			</label>
		</div>
		{#if decisionMode === DecisionMode.Together}
			<p class="text-xs text-base-content/60">
				Everyone swipes the whole album independently first; once everyone's done, photos you
				disagree on show up on the <a
					href={resolve('/albums/[id]/resolve', { id: String(data.album.id) })}
					class="link">resolve screen</a
				> for a final joint call.
			</p>
		{/if}
		<button
			type="button"
			class="btn btn-sm self-start"
			disabled={busy}
			onclick={saveDecisionSettings}>Save</button
		>
	</section>

	<section class="flex flex-col gap-3 rounded border border-error/30 p-4">
		<h2 class="font-medium text-error">Danger zone</h2>
		<p class="text-sm text-base-content/60">
			Deletes the album, every photo in it, and everyone's decisions. This can't be undone. Type the
			album name to confirm.
		</p>
		<input
			type="text"
			placeholder={data.album.name}
			bind:value={deleteConfirmText}
			class="input input-bordered input-sm"
		/>
		<button
			type="button"
			class="btn btn-outline btn-error btn-sm self-start"
			disabled={busy || deleteConfirmText !== data.album.name}
			onclick={deleteAlbumForever}
		>
			<Trash2 class="size-4" /> Delete album forever
		</button>
	</section>

	{#if errorMessage}
		<div class="toast toast-center toast-bottom z-50">
			<button type="button" class="alert alert-error text-sm" onclick={() => (errorMessage = null)}>
				{errorMessage}
			</button>
		</div>
	{/if}
</div>
