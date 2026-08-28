<script lang="ts">
	import SwipeSession from './SwipeSession.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

{#key data.album.id}
	<SwipeSession {data} />
{/key}
