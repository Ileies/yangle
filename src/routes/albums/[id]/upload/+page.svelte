<script lang="ts">
	import { resolve } from '$app/paths';
	import { ArrowLeft, Check, ChevronDown, FolderUp, X } from '@lucide/svelte';
	import { sha256Hex } from '$lib/utils';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	type Conflict = { photoId: number; existingName: string; newName: string };
	type LogEntry = { name: string; status: 'success' | 'skipped' | 'failed'; detail: string };

	let status = $state<'idle' | 'hashing' | 'uploading' | 'done'>('idle');
	let addedCount = $state(0);
	let skippedCount = $state(0);
	let failedCount = $state(0);
	let conflicts = $state<Conflict[]>([]);
	let errorMessage = $state('');

	let currentFileName = $state('');
	let uploadedBytes = $state(0);
	let totalBytes = $state(0);
	let uploadPercent = $derived(totalBytes > 0 ? Math.round((uploadedBytes / totalBytes) * 100) : 0);

	let logEntries = $state<LogEntry[]>([]);
	let logOpen = $state(false);

	function uploadSingleFile(
		albumId: number,
		file: File,
		onProgress: (loaded: number) => void
	): Promise<{ id: number; displayName: string }> {
		return new Promise((resolvePromise, rejectPromise) => {
			const xhr = new XMLHttpRequest();
			xhr.open('POST', `/albums/${albumId}/upload/submit`);
			xhr.upload.onprogress = (event) => {
				if (event.lengthComputable) onProgress(event.loaded);
			};
			xhr.onload = () => {
				if (xhr.status < 200 || xhr.status >= 300) {
					rejectPromise(new Error(`Upload failed (${xhr.status}).`));
					return;
				}
				try {
					const body = JSON.parse(xhr.responseText) as {
						added: { id: number; displayName: string }[];
						failed: { name: string; error: string }[];
					};
					if (body.added[0]) resolvePromise(body.added[0]);
					else rejectPromise(new Error(body.failed[0]?.error ?? 'Upload failed.'));
				} catch {
					rejectPromise(new Error('Upload failed.'));
				}
			};
			xhr.onerror = () => rejectPromise(new Error('Network error during upload.'));

			const form = new FormData();
			form.append('files', file);
			xhr.send(form);
		});
	}

	const IMAGE_EXTENSION_PATTERN = /\.(jpe?g|png|gif|webp|bmp|tiff?|avif|heic|heif)$/i;

	function looksLikeImage(file: File): boolean {
		// Some formats (notably HEIC/HEIF, common in phone camera folders) aren't recognized by
		// the browser's MIME sniffer and come through with an empty `type`, so a `file.type`
		// check alone drops them - fall back to the extension whenever type is inconclusive.
		if (file.type.startsWith('image/')) return true;
		if (file.type !== '') return false;
		return IMAGE_EXTENSION_PATTERN.test(file.name);
	}

	async function handleFiles(fileList: FileList) {
		const files = Array.from(fileList).filter(looksLikeImage);
		if (files.length === 0) return;

		status = 'hashing';
		errorMessage = '';
		addedCount = 0;
		skippedCount = 0;
		failedCount = 0;
		conflicts = [];
		logEntries = [];
		currentFileName = '';
		uploadedBytes = 0;
		totalBytes = 0;

		try {
			const hashes = await Promise.all(files.map((file) => file.arrayBuffer().then(sha256Hex)));

			const checkResponse = await fetch(`/albums/${data.album.id}/upload/check`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ hashes })
			});
			if (!checkResponse.ok) throw new Error('Could not check for existing photos.');
			const { existing } = (await checkResponse.json()) as {
				existing: { hash: string; id: number; displayName: string }[];
			};
			const existingByHash = new Map(existing.map((entry) => [entry.hash, entry]));

			const toUpload: File[] = [];
			for (let i = 0; i < files.length; i++) {
				const match = existingByHash.get(hashes[i]);
				if (!match) {
					toUpload.push(files[i]);
				} else if (match.displayName === files[i].name) {
					skippedCount++;
					logEntries.push({
						name: files[i].name,
						status: 'skipped',
						detail: 'Already in this album'
					});
				} else {
					conflicts.push({
						photoId: match.id,
						existingName: match.displayName,
						newName: files[i].name
					});
				}
			}

			if (toUpload.length > 0) {
				status = 'uploading';
				totalBytes = toUpload.reduce((sum, file) => sum + file.size, 0);

				for (const file of toUpload) {
					currentFileName = file.name;
					const bytesBefore = uploadedBytes;
					try {
						await uploadSingleFile(data.album.id, file, (loaded) => {
							uploadedBytes = bytesBefore + loaded;
						});
						uploadedBytes = bytesBefore + file.size;
						addedCount++;
						logEntries.push({
							name: file.name,
							status: 'success',
							detail: 'Uploaded, thumbnail generated'
						});
					} catch (err) {
						uploadedBytes = bytesBefore + file.size;
						failedCount++;
						logEntries.push({
							name: file.name,
							status: 'failed',
							detail: err instanceof Error ? err.message : 'Upload failed.'
						});
					}
				}
			}

			currentFileName = '';
			status = 'done';
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'Something went wrong.';
			status = 'idle';
		}
	}

	async function resolveConflict(conflict: Conflict, keepName: string) {
		const otherName = keepName === conflict.existingName ? conflict.newName : conflict.existingName;
		await fetch(`/albums/${data.album.id}/upload/resolve`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ photoId: conflict.photoId, keepName, otherName })
		});
		conflicts = conflicts.filter((c) => c !== conflict);
	}

	const busy = $derived(status === 'hashing' || status === 'uploading');
</script>

<svelte:head>
	<title>Upload — {data.album.name}</title>
</svelte:head>

<div class="mx-auto flex min-h-full max-w-md flex-col gap-6 p-6">
	<h1 class="text-2xl font-semibold">Upload to {data.album.name}</h1>

	<div class="flex flex-col gap-2 sm:flex-row">
		<input
			type="file"
			accept="image/*"
			multiple
			disabled={busy}
			onchange={(event) => {
				const input = event.currentTarget;
				if (input.files) handleFiles(input.files);
				input.value = '';
			}}
			class="file-input file-input-bordered w-full"
		/>

		<label class="btn btn-outline" class:btn-disabled={busy}>
			<FolderUp class="size-4" /> Upload folder
			<input
				type="file"
				multiple
				webkitdirectory
				disabled={busy}
				onchange={(event) => {
					const input = event.currentTarget;
					if (input.files) handleFiles(input.files);
					input.value = '';
				}}
				class="hidden"
			/>
		</label>
	</div>

	{#if status === 'hashing'}
		<p class="text-sm text-base-content/60">Checking for photos you've already uploaded...</p>
	{:else if status === 'uploading'}
		<div class="flex flex-col gap-1">
			<div class="flex items-center justify-between text-sm">
				<span class="truncate">Uploading {currentFileName}</span>
				<span class="text-base-content/60">{uploadPercent}%</span>
			</div>
			<progress class="progress progress-primary w-full" value={uploadPercent} max="100"></progress>
		</div>
	{:else if status === 'done'}
		<p class="text-sm text-success">
			Added {addedCount}, skipped {skippedCount} already-uploaded photo{skippedCount === 1
				? ''
				: 's'}{failedCount > 0 ? `, ${failedCount} failed` : ''}.
		</p>
	{/if}

	{#if errorMessage}
		<p class="text-sm text-error">{errorMessage}</p>
	{/if}

	{#if logEntries.length > 0}
		<div class="collapse-arrow collapse border border-base-300">
			<input type="checkbox" bind:checked={logOpen} />
			<div class="collapse-title flex items-center gap-2 text-sm font-medium">
				<ChevronDown class="size-4" /> Upload log ({logEntries.length})
			</div>
			<div class="collapse-content">
				<ul class="flex flex-col gap-1.5 text-sm">
					{#each logEntries as entry, i (i)}
						<li class="flex items-start gap-2">
							{#if entry.status === 'success'}
								<Check class="mt-0.5 size-4 shrink-0 text-success" />
							{:else if entry.status === 'skipped'}
								<Check class="mt-0.5 size-4 shrink-0 text-base-content/40" />
							{:else}
								<X class="mt-0.5 size-4 shrink-0 text-error" />
							{/if}
							<span class="flex flex-col">
								<span class="break-all">{entry.name}</span>
								<span class="text-xs text-base-content/60">{entry.detail}</span>
							</span>
						</li>
					{/each}
				</ul>
			</div>
		</div>
	{/if}

	{#if conflicts.length > 0}
		<section class="flex flex-col gap-3">
			<h2 class="text-lg font-medium">Name conflicts</h2>
			<p class="text-sm text-base-content/60">
				These photos are already in the album under a different name. Which name should we keep?
			</p>
			{#each conflicts as conflict (conflict.photoId)}
				<div class="flex flex-col gap-2 rounded border border-base-300 p-3">
					<div class="flex gap-2">
						<button
							type="button"
							class="btn btn-sm flex-1"
							onclick={() => resolveConflict(conflict, conflict.existingName)}
						>
							<Check class="size-4" /> Keep "{conflict.existingName}"
						</button>
						<button
							type="button"
							class="btn btn-sm flex-1"
							onclick={() => resolveConflict(conflict, conflict.newName)}
						>
							<Check class="size-4" /> Use "{conflict.newName}"
						</button>
					</div>
				</div>
			{/each}
		</section>
	{/if}

	<a
		href={resolve('/albums/[id]', { id: String(data.album.id) })}
		class="link link-hover flex items-center gap-1 self-start text-sm text-base-content/60"
	>
		<ArrowLeft class="size-4" /> Back to album
	</a>
</div>
