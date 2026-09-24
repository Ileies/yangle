<script lang="ts">
	let { dialogEl = $bindable() }: { dialogEl?: HTMLDialogElement } = $props();
</script>

<dialog bind:this={dialogEl} class="modal">
	<div class="modal-box">
		<h3 class="text-lg font-semibold">Can't download inside WeChat</h3>
		<p class="py-2 text-sm text-base-content/70">
			WeChat's built-in browser blocks file downloads. Tap <strong>⋯</strong> in the top-right
			corner and choose <strong>"Open in Browser"</strong> (or "Open in Safari" / "Open in Chrome"), then
			download again from there.
		</p>
		<div class="modal-action">
			<form method="dialog"><button class="btn btn-primary">Got it</button></form>
		</div>
	</div>
	<form method="dialog" class="modal-backdrop"><button aria-label="Close">close</button></form>
</dialog>
