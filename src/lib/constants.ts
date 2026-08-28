// Auth
export const MAGIC_LINK_TTL_MS = 15 * 60 * 1000; // 15 minutes
export const MAGIC_LINK_RESEND_COOLDOWN_MS = 60 * 1000; // 1 minute between requests per email
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const SESSION_COOKIE = 'session';

// Image pipeline. Three sizes per photo:
//  - thumbnail: grid views and the duplicate-resolution split screen
//  - preview:   the swipe deck itself (what you zoom into) - sized for a phone screen at
//               typical DPR, not the megapixel original, so it stays fast on a slow link
//  - original:  untouched, only fetched for the final ZIP download
export const THUMBNAIL_MAX_PX = 320;
export const PREVIEW_MAX_PX = 1600;
export const IMAGE_QUALITY = 82;

// Swipe deck prefetching: how many photos ahead of the current one to have in-memory
// preview images ready for, fetched only while the current photo isn't itself still loading.
export const PREFETCH_AHEAD_COUNT = 4;

// Near-duplicate clustering (burst shots). Dhash is a 64-bit hash; two photos within this
// Hamming distance are considered visually similar enough to require pre-resolution.
export const DUPLICATE_HAMMING_THRESHOLD = 8;

// Swipe gesture tuning
export const SWIPE_DISMISS_PX = 120;
export const SWIPE_DISMISS_VELOCITY = 0.5; // px/ms
export const ZOOM_MIN_SCALE = 1;
export const ZOOM_MAX_SCALE = 4;
