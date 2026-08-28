export function flattenImageName(name: string): string {
	const normalized = name.replaceAll('\\', '/');
	return normalized.slice(normalized.lastIndexOf('/') + 1) || 'image';
}

function compareNaturalText(a: string, b: string): number {
	const aParts = a.toLocaleLowerCase('en').match(/\d+|\D+/g) ?? [];
	const bParts = b.toLocaleLowerCase('en').match(/\d+|\D+/g) ?? [];
	for (let i = 0; i < Math.min(aParts.length, bParts.length); i++) {
		const aPart = aParts[i];
		const bPart = bParts[i];
		if (aPart === bPart) continue;

		if (/^\d+$/.test(aPart) && /^\d+$/.test(bPart)) {
			const aSignificant = aPart.replace(/^0+/, '') || '0';
			const bSignificant = bPart.replace(/^0+/, '') || '0';
			if (aSignificant.length !== bSignificant.length) {
				return aSignificant.length - bSignificant.length;
			}
			if (aSignificant !== bSignificant) return aSignificant < bSignificant ? -1 : 1;
		}

		return aPart < bPart ? -1 : 1;
	}
	return aParts.length - bParts.length;
}

// Directory uploads used to persist the browser-supplied relative path in displayName. Compare
// the basename first so those legacy prefixes do not split one camera roll across the gallery.
export function compareImageNames(a: string, b: string): number {
	const basenameComparison = compareNaturalText(flattenImageName(a), flattenImageName(b));
	return basenameComparison || compareNaturalText(a, b);
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
