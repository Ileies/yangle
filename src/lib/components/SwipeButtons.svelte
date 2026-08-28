<script lang="ts">
	import { Check, Heart, X } from '@lucide/svelte';
	import { DecisionStatus } from '$lib/types';

	// Real <button> elements are the primary accessible path (TODO.md 3.8), not a gesture-only
	// affordance - they dispatch through the exact same onDecide callback a swipe does. `angle`
	// rotates the glyphs in place, camera-app style, on a confirmed orientation change (3.3);
	// it never changes layout, only the icon rotation.
	let { angle, onDecide }: { angle: number; onDecide: (status: DecisionStatus) => void } = $props();
</script>

<div class="flex items-center justify-center gap-6">
	<button
		type="button"
		aria-label="Delete photo"
		class="btn btn-circle btn-error btn-lg"
		style:transform="rotate({angle}deg)"
		onclick={() => onDecide(DecisionStatus.Delete)}
	>
		<X class="size-7" />
	</button>
	<button
		type="button"
		aria-label="Favorite photo"
		class="btn btn-circle btn-lg"
		style:transform="rotate({angle}deg)"
		onclick={() => onDecide(DecisionStatus.Favorite)}
	>
		<Heart class="size-7" />
	</button>
	<button
		type="button"
		aria-label="Keep photo"
		class="btn btn-circle btn-success btn-lg"
		style:transform="rotate({angle}deg)"
		onclick={() => onDecide(DecisionStatus.Keep)}
	>
		<Check class="size-7" />
	</button>
</div>
