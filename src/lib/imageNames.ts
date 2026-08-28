export function flattenImageName(name: string): string {
	const normalized = name.replaceAll('\\', '/');
	return normalized.slice(normalized.lastIndexOf('/') + 1) || 'image';
}

export function uniqueImageName(name: string, usedNames: ReadonlySet<string>): string {
	const flattened = flattenImageName(name);
	if (!usedNames.has(flattened)) return flattened;

	const dot = flattened.lastIndexOf('.');
	const hasExtension = dot > 0;
	const extension = hasExtension ? flattened.slice(dot) : '';
	let stem = hasExtension ? flattened.slice(0, dot) : flattened;

	while (usedNames.has(`${stem}${extension}`)) {
		const suffix = stem.match(/_(\d+)$/);
		const suffixNumber = suffix ? Number(suffix[1]) : Number.NaN;

		if (suffix && suffixNumber < 999) {
			stem = `${stem.slice(0, -suffix[0].length)}_${suffixNumber + 1}`;
		} else {
			stem = `${stem}_1`;
		}
	}

	return `${stem}${extension}`;
}
