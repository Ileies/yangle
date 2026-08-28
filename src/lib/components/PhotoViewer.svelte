<script lang="ts">
	import { resolve } from '$app/paths';
	import {
		ChevronLeft,
		ChevronRight,
		Download,
		Eye,
		EyeOff,
		Info,
		Trash2,
		X
	} from '@lucide/svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import { formatBytes } from '$lib/utils';
	import { photoUrl } from '$lib/photoUrls';
	import { DecisionStatus, type Photo } from '$lib/types';

	let {
		photos,
		index = $bindable(),
		onClose,
		statuses,
		onSetStatus,
		onDelete
	}: {
		photos: Photo[];
		index: number;
		onClose: () => void;
		statuses?: Map<number, DecisionStatus>;
		onSetStatus?: (photo: Photo, status: DecisionStatus) => void | Promise<void>;
		onDelete?: (photo: Photo) => void | Promise<void>;
	} = $props();

	let dialogEl: HTMLDialogElement | undefined = $state();
	let viewportEl: HTMLDivElement | undefined = $state();
	let showInfo = $state(false);
	let showButtons = $state(
		typeof localStorage === 'undefined'
			? true
			: (localStorage.getItem('photoViewerShowButtons') ?? 'true') === 'true'
	);

	const MIN_SCALE = 1;
	const MAX_SCALE = 5;
	let scale = $state(1);
	let translateX = $state(0);
	let translateY = $state(0);

	const pointers = new SvelteMap<number, { x: number; y: number }>();
	let pinchStartDist = $state(0);
	let pinchStartScale = 1;
	let panStart: { x: number; y: number; tx: number; ty: number } | null = $state(null);
	let swipeStart: { x: number; y: number } | null = $state(null);

	let photo = $derived(photos[index]);
	let status = $derived(
		photo && statuses ? (statuses.get(photo.id) ?? DecisionStatus.Undecided) : null
	);
	let canDecide = $derived(!!onSetStatus);
	let canDelete = $derived(!!onDelete);

	$effect(() => {
		if (photo && dialogEl && !dialogEl.open) dialogEl.showModal();
	});

	$effect(() => {
		// Reset zoom/pan whenever the visible photo changes.
		void photo;
		resetZoom();
	});

	function persistShowButtons() {
		if (typeof localStorage !== 'undefined') {
			localStorage.setItem('photoViewerShowButtons', String(showButtons));
		}
	}

	function toggleShowButtons() {
		showButtons = !showButtons;
		persistShowButtons();
	}

	function close() {
		dialogEl?.close();
		onClose();
	}

	function resetZoom() {
		scale = 1;
		translateX = 0;
		translateY = 0;
	}

	function clampPan() {
		if (!viewportEl) return;
		const rect = viewportEl.getBoundingClientRect();
		const maxX = (rect.width * (scale - 1)) / 2;
		const maxY = (rect.height * (scale - 1)) / 2;
		translateX = Math.min(maxX, Math.max(-maxX, translateX));
		translateY = Math.min(maxY, Math.max(-maxY, translateY));
	}

	function prev() {
		if (scale > 1) return;
		index = (index - 1 + photos.length) % photos.length;
	}

	function next() {
		if (scale > 1) return;
		index = (index + 1) % photos.length;
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowLeft') prev();
		else if (e.key === 'ArrowRight') next();
		else if (e.key === 'Escape' && scale > 1) resetZoom();
	}

	function zoomAt(clientX: number, clientY: number, nextScale: number) {
		if (!viewportEl) return;
		const rect = viewportEl.getBoundingClientRect();
		const originX = clientX - rect.left - rect.width / 2;
		const originY = clientY - rect.top - rect.height / 2;
		const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, nextScale));
		const ratio = clamped / scale;
		translateX = originX - (originX - translateX) * ratio;
		translateY = originY - (originY - translateY) * ratio;
		scale = clamped;
		if (scale === MIN_SCALE) {
			translateX = 0;
			translateY = 0;
		} else {
			clampPan();
		}
	}

	function onWheel(e: WheelEvent) {
		e.preventDefault();
		const delta = -e.deltaY * 0.0025;
		zoomAt(e.clientX, e.clientY, scale * (1 + delta));
	}

	function onDoubleClick(e: MouseEvent) {
		if (e.target instanceof Element && e.target.closest('button')) return;
		if (scale > 1) resetZoom();
		else zoomAt(e.clientX, e.clientY, 2.5);
	}

	function onPointerDown(e: PointerEvent) {
		pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
		if (pointers.size === 2) {
			const [a, b] = [...pointers.values()];
			pinchStartDist = Math.hypot(a.x - b.x, a.y - b.y);
			pinchStartScale = scale;
			panStart = null;
			swipeStart = null;
		} else if (pointers.size === 1 && scale > 1) {
			panStart = { x: e.clientX, y: e.clientY, tx: translateX, ty: translateY };
			viewportEl?.setPointerCapture(e.pointerId);
		} else if (pointers.size === 1 && e.pointerType === 'touch') {
			swipeStart = { x: e.clientX, y: e.clientY };
			viewportEl?.setPointerCapture(e.pointerId);
		}
	}

	function onPointerMove(e: PointerEvent) {
		if (!pointers.has(e.pointerId)) return;
		pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

		if (pointers.size === 2) {
			const [a, b] = [...pointers.values()];
			const dist = Math.hypot(a.x - b.x, a.y - b.y);
			if (pinchStartDist > 0) {
				const midX = (a.x + b.x) / 2;
				const midY = (a.y + b.y) / 2;
				zoomAt(midX, midY, pinchStartScale * (dist / pinchStartDist));
			}
		} else if (panStart && pointers.size === 1) {
			translateX = panStart.tx + (e.clientX - panStart.x);
			translateY = panStart.ty + (e.clientY - panStart.y);
			clampPan();
		}
	}

	function onPointerUp(e: PointerEvent) {
		if (e.type === 'pointerup' && swipeStart && pointers.size === 1 && scale === 1) {
			const deltaX = e.clientX - swipeStart.x;
			const deltaY = e.clientY - swipeStart.y;
			if (Math.abs(deltaX) >= 50 && Math.abs(deltaX) > Math.abs(deltaY)) {
				if (deltaX < 0) next();
				else prev();
			}
		}
		swipeStart = null;
		pointers.delete(e.pointerId);
		if (pointers.size < 2) pinchStartDist = 0;
		if (pointers.size === 0) panStart = null;
	}

	function gcd(a: number, b: number): number {
		return b === 0 ? a : gcd(b, a % b);
	}

	function aspectRatio(width: number, height: number): string {
		const divisor = gcd(width, height);
		return `${width / divisor}:${height / divisor}`;
	}

	async function setStatus(status: DecisionStatus) {
		if (!photo || !onSetStatus) return;
		await onSetStatus(photo, status);
	}

	async function deletePhoto() {
		if (!photo || !onDelete) return;
		await onDelete(photo);
	}

	const dateFormatter = new Intl.DateTimeFormat(undefined, {
		dateStyle: 'medium',
		timeStyle: 'short'
	});
</script>

<svelte:window onkeydown={photo ? onKeydown : undefined} />

<dialog bind:this={dialogEl} class="modal" onclose={close}>
	{#if photo}
		<div class="modal-box relative flex h-dvh max-h-dvh w-dvw max-w-full flex-col gap-0 p-0">
			<div class="flex items-center justify-between gap-2 bg-black/40 p-3 text-white">
				<button
					type="button"
					class="btn btn-circle btn-ghost btn-sm text-white"
					onclick={close}
					aria-label="Close"><X class="size-4" /></button
				>
				<span class="truncate text-sm">{photo.displayName}</span>
				<div class="flex items-center gap-1">
					{#if canDecide}
						<button
							type="button"
							class="btn btn-circle btn-ghost btn-sm text-white"
							onclick={toggleShowButtons}
							aria-label={showButtons ? 'Hide buttons' : 'Show buttons'}
						>
							{#if showButtons}<Eye class="size-4" />{:else}<EyeOff class="size-4" />{/if}
						</button>
					{/if}
					<button
						type="button"
						class="btn btn-circle btn-ghost btn-sm text-white"
						class:btn-active={showInfo}
						onclick={() => (showInfo = !showInfo)}
						aria-label="Toggle info"><Info class="size-4" /></button
					>
				</div>
			</div>

			<div
				bind:this={viewportEl}
				role="img"
				aria-label={photo.displayName}
				class="relative flex flex-1 touch-none items-center justify-center overflow-hidden bg-black"
				onwheel={onWheel}
				ondblclick={onDoubleClick}
				onpointerdown={onPointerDown}
				onpointermove={onPointerMove}
				onpointerup={onPointerUp}
				onpointercancel={onPointerUp}
			>
				<img
					src={photoUrl(photo, 'preview')}
					alt={photo.displayName}
					class="max-h-full max-w-full object-contain select-none"
					style="transform: translate({translateX}px, {translateY}px) scale({scale}); transition: {panStart ||
					pinchStartDist
						? 'none'
						: 'transform 0.15s ease-out'};"
					draggable="false"
				/>

				{#if photos.length > 1 && scale === 1}
					<button
						type="button"
						class="btn btn-circle btn-ghost absolute left-2 text-white"
						onclick={prev}
						aria-label="Previous photo"><ChevronLeft class="size-6" /></button
					>
					<button
						type="button"
						class="btn btn-circle btn-ghost absolute right-2 text-white"
						onclick={next}
						aria-label="Next photo"><ChevronRight class="size-6" /></button
					>
				{/if}
			</div>

			{#if showInfo}
				<div class="max-h-[45dvh] overflow-y-auto bg-base-100 p-4">
					<dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
						<dt class="text-base-content/60">Name</dt>
						<dd class="truncate">{photo.displayName}</dd>

						<dt class="text-base-content/60">Taken</dt>
						<dd>
							{photo.takenAt
								? dateFormatter.format(new Date(photo.takenAt))
								: `${dateFormatter.format(new Date(photo.uploadedAt))} (upload date)`}
						</dd>

						<dt class="text-base-content/60">Dimensions</dt>
						<dd>{photo.width} × {photo.height} px ({aspectRatio(photo.width, photo.height)})</dd>

						<dt class="text-base-content/60">Size</dt>
						<dd>{formatBytes(photo.fileSize)}</dd>

						{#if photo.latitude !== null && photo.longitude !== null}
							<dt class="text-base-content/60">Location</dt>
							<dd>
								<a
									class="link"
									href="https://www.openstreetmap.org/?mlat={photo.latitude}&mlon={photo.longitude}#map=16/{photo.latitude}/{photo.longitude}"
									target="_blank"
									rel="noopener noreferrer"
								>
									{photo.latitude.toFixed(5)}, {photo.longitude.toFixed(5)}
								</a>
							</dd>
						{/if}
					</dl>
				</div>
			{/if}

			{#if canDecide && showButtons}
				<div class="flex gap-2 bg-base-100 p-3">
					<label class="sr-only" for="photo-status">Photo category</label>
					<select
						id="photo-status"
						class="select select-sm min-w-0 flex-1"
						value={status ?? DecisionStatus.Undecided}
						onchange={(event) => setStatus(event.currentTarget.value as DecisionStatus)}
					>
						<option value={DecisionStatus.Undecided}>Undecided</option>
						<option value={DecisionStatus.Keep}>Keep</option>
						<option value={DecisionStatus.Favorite}>Favorite</option>
						<option value={DecisionStatus.Delete}>Delete</option>
					</select>
					{#if canDelete}
						<button
							type="button"
							class="btn btn-error btn-square btn-sm"
							onclick={deletePhoto}
							title="Delete permanently"
							aria-label="Delete photo permanently"
						>
							<Trash2 class="size-4" />
						</button>
					{/if}
					<a
						href={resolve(
							`/photos/${photo.id}/original?v=${encodeURIComponent(photo.contentHash)}`
						)}
						download={photo.displayName}
						class="btn btn-square btn-sm btn-outline"
						title="Download"
						aria-label="Download photo"
					>
						<Download class="size-4" />
					</a>
				</div>
			{/if}
		</div>
		<form method="dialog" class="modal-backdrop">
			<button aria-label="Close">close</button>
		</form>
	{/if}
</dialog>
