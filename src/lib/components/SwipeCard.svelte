<script lang="ts">
	import { Gesture } from '@use-gesture/vanilla';
	import { RefreshCw } from '@lucide/svelte';
	import {
		SWIPE_DISMISS_PX,
		SWIPE_DISMISS_VELOCITY,
		ZOOM_MAX_SCALE,
		ZOOM_MIN_SCALE
	} from '$lib/constants';
	import { DecisionStatus } from '$lib/types';
	import { clamp } from '$lib/utils';

	// See TODO.md 3.1.1/3.1.2 for the full gesture state machine and zoom/pan reasoning this
	// implements. `active` marks the top-of-deck card - only it receives gesture bindings;
	// cards stacked behind it (see swipe/+page.svelte) render inert.
	let {
		displayName,
		previewUrl,
		thumbnailUrl,
		active,
		previewReady,
		previewFailed,
		reducedMotion,
		onDecide,
		onRetry,
		onDraggingChange
	}: {
		displayName: string;
		previewUrl: string;
		thumbnailUrl: string;
		active: boolean;
		previewReady: boolean;
		previewFailed: boolean;
		reducedMotion: boolean;
		onDecide: (status: DecisionStatus) => void;
		onRetry: () => void;
		onDraggingChange?: (dragging: boolean) => void;
	} = $props();

	let root: HTMLDivElement | undefined = $state();

	type Mode = 'idle' | 'swiping' | 'panning' | 'pinching';
	let mode: Mode = $state('idle');
	let card = $state({ x: 0, y: 0, scale: 1, rotate: 0, originX: 50, originY: 50 });
	let flying = $state(false);
	let dragging = $state(false);

	$effect(() => {
		onDraggingChange?.(dragging);
	});

	let directionLock: 'horizontal' | 'vertical' | null = null;
	let panBase = { x: 0, y: 0 };
	let lastTapAt = 0;

	// Continuous "approaching the target" feedback, read by the parent for the heart-icon glow
	// (see 3.5) and by this component for opacity/scale feedback during the drag itself.
	let progressX = $derived(clamp(card.x / SWIPE_DISMISS_PX, -1, 1));
	let progressUp = $derived(clamp(-card.y / SWIPE_DISMISS_PX, 0, 1));

	function clampPan(x: number, y: number, scale: number): { x: number; y: number } {
		if (!root) return { x, y };
		const bound = (root.clientWidth * (scale - 1)) / 2;
		const boundY = (root.clientHeight * (scale - 1)) / 2;
		return { x: clamp(x, -bound, bound), y: clamp(y, -boundY, boundY) };
	}

	function resetTransform(): void {
		card = { x: 0, y: 0, scale: 1, rotate: 0, originX: 50, originY: 50 };
	}

	function dismiss(status: DecisionStatus, dirX: number, dirY: number): void {
		flying = true;
		if (reducedMotion) {
			onDecide(status);
			return;
		}
		const distance = Math.max(window.innerWidth, window.innerHeight) * 1.3;
		card = { ...card, x: dirX * distance, y: dirY * distance, rotate: dirX * 24 };
		setTimeout(() => onDecide(status), 220);
	}

	function toggleZoom(clientX: number, clientY: number): void {
		if (!root) return;
		if (card.scale > 1) {
			resetTransform();
			return;
		}
		const rect = root.getBoundingClientRect();
		card = {
			x: 0,
			y: 0,
			scale: 2.5,
			rotate: 0,
			originX: ((clientX - rect.left) / rect.width) * 100,
			originY: ((clientY - rect.top) / rect.height) * 100
		};
	}

	$effect(() => {
		if (!active || !root) return;

		// Pinch-to-zoom anchors on the touch midpoint by dynamically setting CSS
		// transform-origin to that point at pinch start, rather than solving the general
		// translate-recompute matrix math - visually equivalent for a single scale transform,
		// far less error-prone.
		const gesture = new Gesture(
			root,
			{
				onDragStart: () => {
					if (mode === 'pinching') return;
					directionLock = null;
					dragging = true;
					if (card.scale > 1) {
						mode = 'panning';
						panBase = { x: card.x, y: card.y };
					}
				},
				onDrag: (state) => {
					if (state.pinching) return;
					const [mx, my] = state.movement;

					if (card.scale > 1) {
						const { x, y } = clampPan(panBase.x + mx, panBase.y + my, card.scale);
						card = { ...card, x, y };
						return;
					}

					mode = 'swiping';
					if (!directionLock && Math.hypot(mx, my) > 10) {
						directionLock = Math.abs(mx) > Math.abs(my) ? 'horizontal' : 'vertical';
					}
					if (directionLock === 'horizontal') {
						card = { ...card, x: mx, y: 0, rotate: clamp(mx / 20, -15, 15) };
					} else if (directionLock === 'vertical' && my < 0) {
						card = { ...card, x: 0, y: my, rotate: 0 };
					} else {
						card = { ...card, x: mx * 0.3, y: my * 0.3, rotate: 0 };
					}
				},
				onDragEnd: (state) => {
					dragging = false;
					if (state.pinching) return;

					if (state.tap) {
						const now = performance.now();
						const [x, y] = state.xy;
						if (now - lastTapAt < 300) {
							toggleZoom(x, y);
							lastTapAt = 0;
						} else {
							lastTapAt = now;
						}
						mode = 'idle';
						return;
					}

					if (card.scale > 1) {
						mode = 'idle';
						directionLock = null;
						return;
					}

					const [mx, my] = state.movement;
					const [vx, vy] = state.velocity;
					const distance = Math.hypot(mx, my);
					const velocity = Math.hypot(vx, vy);
					const past = distance > SWIPE_DISMISS_PX || velocity > SWIPE_DISMISS_VELOCITY;

					if (past && directionLock === 'horizontal') {
						dismiss(mx > 0 ? DecisionStatus.Keep : DecisionStatus.Delete, mx > 0 ? 1 : -1, 0);
					} else if (past && directionLock === 'vertical' && my < 0) {
						dismiss(DecisionStatus.Favorite, 0, -1);
					} else {
						resetTransform();
					}
					mode = 'idle';
					directionLock = null;
				},
				onPinchStart: (state) => {
					if (!root) return;
					mode = 'pinching';
					const rect = root.getBoundingClientRect();
					const [ox, oy] = state.origin;
					card = {
						...card,
						originX: ((ox - rect.left) / rect.width) * 100,
						originY: ((oy - rect.top) / rect.height) * 100
					};
				},
				onPinch: (state) => {
					const [scale] = state.offset;
					card = { ...card, scale: clamp(scale, ZOOM_MIN_SCALE * 0.9, ZOOM_MAX_SCALE * 1.1) };
				},
				onPinchEnd: () => {
					card = { ...card, scale: clamp(card.scale, ZOOM_MIN_SCALE, ZOOM_MAX_SCALE) };
					mode = 'idle';
				}
			},
			{
				drag: { filterTaps: true, threshold: 3 },
				pinch: { scaleBounds: { min: ZOOM_MIN_SCALE, max: ZOOM_MAX_SCALE }, rubberband: true }
			}
		);
		return () => gesture.destroy();
	});
</script>

<div
	bind:this={root}
	class="absolute inset-0 touch-none select-none"
	style:transform="translate3d({card.x}px, {card.y}px, 0) rotate({card.rotate}deg) scale({card.scale})"
	style:transform-origin="{card.originX}% {card.originY}%"
	style:transition={dragging
		? 'none'
		: reducedMotion
			? 'opacity 150ms linear'
			: 'transform 250ms cubic-bezier(0.2, 0.8, 0.2, 1)'}
	style:opacity={reducedMotion && flying ? 0 : 1}
	style:will-change="transform"
>
	<div class="relative h-full w-full overflow-hidden rounded-2xl bg-base-300 shadow-xl">
		<img
			src={thumbnailUrl}
			alt=""
			aria-hidden="true"
			class="absolute inset-0 h-full w-full object-cover blur-lg transition-opacity duration-200"
			style:opacity={previewReady ? 0 : 1}
		/>
		<img
			src={previewUrl}
			alt={displayName}
			class="absolute inset-0 h-full w-full object-contain transition-opacity duration-200"
			style:opacity={previewReady ? 1 : 0}
			draggable="false"
		/>
		{#if previewFailed}
			<div class="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-base-300/90">
				<p class="text-sm text-base-content/70">Couldn't load this photo.</p>
				<button type="button" class="btn btn-sm" onclick={onRetry}
					><RefreshCw class="size-4" /> Retry</button
				>
			</div>
		{/if}

		{#if active && progressX !== 0}
			<div
				class="absolute top-6 right-6 left-6 flex justify-between text-3xl font-bold uppercase"
				style:opacity={Math.abs(progressX)}
			>
				<span class="text-error" style:opacity={progressX < 0 ? 1 : 0}>Delete</span>
				<span class="text-success" style:opacity={progressX > 0 ? 1 : 0}>Keep</span>
			</div>
		{/if}
		{#if active && progressUp > 0}
			<div class="absolute inset-x-0 top-6 flex justify-center">
				<span
					class="text-4xl transition-transform"
					style:opacity={progressUp}
					style:transform="scale({1 + progressUp * 0.6})">❤️</span
				>
			</div>
		{/if}
	</div>
</div>
