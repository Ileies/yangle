<script lang="ts">
	import { Send } from '@lucide/svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head>
	<title>Sign in — Yangle</title>
</svelte:head>

<div class="flex min-h-full flex-col items-center justify-center gap-6 p-6">
	<h1 class="text-2xl font-semibold">Sign in to Yangle</h1>

	{#if form?.sent}
		<p class="max-w-sm text-center text-base-content/70">
			We sent a login link to <span class="font-medium text-base-content">{form.email}</span>. Check
			your inbox (and spam folder) — it expires in 15 minutes.
		</p>
	{:else}
		<form method="POST" class="flex w-full max-w-sm flex-col gap-3">
			<input type="hidden" name="redirectTo" value={data.redirectTo ?? ''} />
			<input
				type="email"
				name="email"
				placeholder="you@example.com"
				autocomplete="email"
				inputmode="email"
				required
				value={form?.email ?? ''}
				class="input input-bordered w-full"
			/>
			{#if form?.error ?? data.error}
				<p class="text-sm text-error">{form?.error ?? data.error}</p>
			{/if}
			<button type="submit" class="btn btn-primary w-full"
				><Send class="size-4" /> Send login link</button
			>
		</form>
	{/if}
</div>
