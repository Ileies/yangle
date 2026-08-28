// Reports the device's actual, OS-honored layout orientation - never raw accelerometer/tilt
// data. `screen.orientation`'s `change` event only fires when the browser's viewport truly
// re-renders in a new orientation, which is inherently gated on the OS rotation lock (a locked
// screen never re-lays-out, so this event doubles as rotation-lock detection for free). See
// TODO.md 3.3 for the full reasoning and test matrix.
export class DeviceOrientation {
	angle = $state(0);
	isLandscape = $state(false);

	#mediaQuery: MediaQueryList | null = null;
	#onScreenOrientationChange = () => {
		this.angle = screen.orientation?.angle ?? 0;
		this.isLandscape = Math.abs(this.angle) === 90;
	};
	#onMediaChange = (event: MediaQueryListEvent) => {
		this.isLandscape = event.matches;
	};

	start(): void {
		if (typeof window === 'undefined') return;
		if ('orientation' in screen && screen.orientation) {
			this.#onScreenOrientationChange();
			screen.orientation.addEventListener('change', this.#onScreenOrientationChange);
		} else {
			// Older iOS Safari: screen.orientation support is patchy. matchMedia's change event
			// shares the same "only fires on a genuine layout change" property we depend on.
			this.#mediaQuery = window.matchMedia('(orientation: landscape)');
			this.isLandscape = this.#mediaQuery.matches;
			this.#mediaQuery.addEventListener('change', this.#onMediaChange);
		}
	}

	stop(): void {
		if (typeof window === 'undefined') return;
		screen.orientation?.removeEventListener('change', this.#onScreenOrientationChange);
		this.#mediaQuery?.removeEventListener('change', this.#onMediaChange);
	}
}
