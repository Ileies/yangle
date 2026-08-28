export function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

// `left`/`top`/`width` are all percentages of the *container* (not the photo itself,
// unlike a CSS transform: translate() percentage) - so slots can be sized and spread to
// cover most of the card, instead of leaving a wide grey margin or just a thin sliver of
// each back photo peeking out from behind the one in front.
export type PhotoStackPlacement = { rotate: number; left: number; top: number; width: number };

// Fixed per-slot placement for a 1-3 photo "spread on a table" cover stack, back photo
// first (most rotated/smallest) through front photo last (flattest/largest/on top).
const PHOTO_STACK_PLACEMENTS: Record<number, PhotoStackPlacement[]> = {
	1: [{ rotate: 0, left: 50, top: 50, width: 92 }],
	2: [
		{ rotate: -8, left: 37, top: 61, width: 62 },
		{ rotate: 6, left: 63, top: 40, width: 68 }
	],
	3: [
		{ rotate: -12, left: 31, top: 65, width: 54 },
		{ rotate: 11, left: 67, top: 33, width: 58 },
		{ rotate: -3, left: 50, top: 50, width: 64 }
	]
};

export function photoStackPlacements(count: number): PhotoStackPlacement[] {
	return PHOTO_STACK_PLACEMENTS[clamp(count, 1, 3)] ?? [];
}

export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	const units = ['KB', 'MB', 'GB'];
	let value = bytes;
	let unit = -1;
	do {
		value /= 1024;
		unit++;
	} while (value >= 1024 && unit < units.length - 1);
	return `${value.toFixed(1)} ${units[unit]}`;
}

// SHA-256 as lowercase hex. Runs identically in the browser and on the server (Web Crypto),
// which is what lets the upload flow hash a file client-side and compare it against the
// server's content hash without needing a second implementation.
export async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', data as BufferSource);
	return Array.from(new Uint8Array(digest))
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('');
}

// Cryptographically random URL-safe token, used for magic-link and session tokens.
export function randomToken(bytes = 32): string {
	const arr = new Uint8Array(bytes);
	crypto.getRandomValues(arr);
	return btoa(String.fromCharCode(...arr))
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');
}

// Hamming distance between two same-length hex-encoded perceptual hashes.
// Used to cluster visually similar photos (e.g. burst shots) before they enter the swipe deck.
export function hammingDistance(hexA: string, hexB: string): number {
	if (hexA.length !== hexB.length) return Number.POSITIVE_INFINITY;
	let distance = 0;
	for (let i = 0; i < hexA.length; i++) {
		let xor = parseInt(hexA[i], 16) ^ parseInt(hexB[i], 16);
		while (xor) {
			distance += xor & 1;
			xor >>= 1;
		}
	}
	return distance;
}
