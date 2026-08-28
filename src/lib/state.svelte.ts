import type { User } from './types';

export const yangle: {
	user: User | null;
	// Opt-in landscape mode: when off, only button glyphs rotate in place on a confirmed
	// orientation change; when on, the whole swipe layout (image + buttons) rotates.
	allowLandscapeRotation: boolean;
	// Album currently being swiped, so the bottom nav can offer a way back into it after
	// navigating elsewhere to check something. Cleared once that album's deck is finished.
	activeSwipeAlbumId: number | null;
} = $state({
	user: null,
	allowLandscapeRotation: false,
	activeSwipeAlbumId: null
});
