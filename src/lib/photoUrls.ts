export type PhotoUrlIdentity = {
	id: number;
	contentHash: string;
};

export type PhotoRendition = 'thumbnail' | 'preview' | 'original' | 'compat';

// The content hash makes the URL immutable even if a development database is recreated and a
// numeric photo id is assigned to different bytes. It also replaces any stale id-only cache entry.
export function photoUrl(photo: PhotoUrlIdentity, rendition: PhotoRendition): string {
	return `/photos/${photo.id}/${rendition}?v=${encodeURIComponent(photo.contentHash)}`;
}
