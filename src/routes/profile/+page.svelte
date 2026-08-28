<script lang="ts">
	import { LogOut, Save } from '@lucide/svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head>
	<title>Profile — Yangle</title>
</svelte:head>

<div class="mx-auto flex min-h-full max-w-md flex-col gap-8 p-6">
	<h1 class="text-2xl font-semibold">Profile</h1>

	<form method="POST" action="?/updateName" class="flex flex-col gap-3">
		<label class="flex flex-col gap-1 text-sm">
			Display name
			<input
				type="text"
				name="displayName"
				value={data.user.displayName}
				required
				class="input input-bordered w-full"
			/>
		</label>
		{#if form?.error}
			<p class="text-sm text-error">{form.error}</p>
		{/if}
		{#if form?.updated}
			<p class="text-sm text-success">Saved.</p>
		{/if}
		<button type="submit" class="btn btn-primary self-start"><Save class="size-4" /> Save</button>
	</form>

	<div class="flex flex-col gap-2 border-t border-base-300 pt-6">
		<form method="POST" action="/logout">
			<button type="submit" class="btn btn-outline w-full"><LogOut class="size-4" /> Log out</button
			>
		</form>
		<form method="POST" action="?/logoutEverywhere">
			<button type="submit" class="btn btn-outline btn-error w-full"
				><LogOut class="size-4" /> Log out everywhere</button
			>
		</form>
	</div>
</div>
