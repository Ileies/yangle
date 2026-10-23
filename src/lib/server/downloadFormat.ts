import type { Photo } from '#lib/types.js';

export type DownloadFormat = 'original' | 'compatible';

export function parseDownloadFormat(value: string | null): DownloadFormat {
	return value === 'compatible' ? 'compatible' : 'original';
}

// Which file goes into the ZIP for a photo. `compatible` swaps in the JPEG rendition where one
// exists (HEIC/HEIF originals) and renames the entry to .jpg; photos without a rendition are
// already broadly compatible, so they ship as their original in both formats.
export function zipSourceFor(
	photo: Pick<Photo, 'displayName' | 'originalPath' | 'compatOriginalPath'>,
	format: DownloadFormat
): { path: string; name: string } {
	if (format === 'original' || !photo.compatOriginalPath) {
		return { path: photo.originalPath, name: photo.displayName };
	}
	const dot = photo.displayName.lastIndexOf('.');
	const base = dot === -1 ? photo.displayName : photo.displayName.slice(0, dot);
	return { path: photo.compatOriginalPath, name: `${base}.jpg` };
}
