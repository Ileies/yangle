<script lang="ts">
	import { resolve } from '$app/paths';
	import { ArrowLeft, FolderPlus } from '@lucide/svelte';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();
</script>

<svelte:head>
	<title>New album — Yangle</title>
</svelte:head>

<div class="mx-auto flex min-h-full max-w-md flex-col gap-6 p-6">
	<h1 class="text-2xl font-semibold">New album</h1>

	<form method="POST" class="flex flex-col gap-3">
		<label class="flex flex-col gap-1 text-sm">
			Name
			<input
				type="text"
				name="name"
				required
				placeholder="e.g. Summer trip"
				class="input input-bordered w-full"
			/>
		</label>
		{#if form?.error}
			<p class="text-sm text-error">{form.error}</p>
		{/if}
		<button type="submit" class="btn btn-primary self-start"
			><FolderPlus class="size-4" /> Create</button
		>
	</form>

	<a
		href={resolve('/albums')}
		class="link link-hover flex items-center gap-1 self-start text-sm text-base-content/60"
	>
		<ArrowLeft class="size-4" /> Back
	</a>
</div>
