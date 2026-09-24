export type ByteRange = { start: number; end: number };

// Only one byte range is supported. Return null for malformed or unsupported requests;
// return 'unsatisfiable' for a valid range outside the file.
export function parseByteRange(
	header: string | null,
	size: number
): ByteRange | 'unsatisfiable' | null {
	if (!header || !header.startsWith('bytes=') || header.includes(',')) return null;
	const match = /^bytes=(\d*)-(\d*)$/.exec(header);
	if (!match || (match[1] === '' && match[2] === '')) return null;

	if (match[1] === '') {
		const suffix = Number(match[2]);
		if (!Number.isSafeInteger(suffix) || suffix === 0 || size === 0) return 'unsatisfiable';
		return { start: Math.max(0, size - suffix), end: size - 1 };
	}

	const start = Number(match[1]);
	const end = match[2] === '' ? size - 1 : Number(match[2]);
	if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return null;
	if (start >= size || end < start) return 'unsatisfiable';
	return { start, end: Math.min(end, size - 1) };
}
