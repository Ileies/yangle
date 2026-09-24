export function isWeChatBrowser(): boolean {
	return typeof navigator !== 'undefined' && /MicroMessenger/i.test(navigator.userAgent);
}

// WeChat's in-app browser intercepts navigation to downloadable responses (zips, photo
// originals) and renders them in its own inline viewer instead of handing them to the OS as a
// download - neither the `download` attribute nor `Content-Disposition: attachment` survive
// that. There's no client-side trick around it; the only way out is the device's real browser.
export function guardWeChatDownload(
	event: MouseEvent,
	dialogEl: HTMLDialogElement | undefined
): boolean {
	if (!isWeChatBrowser()) return false;
	event.preventDefault();
	dialogEl?.showModal();
	return true;
}
