import { describe, expect, test } from 'bun:test';
import { parseDownloadFormat, zipSourceFor } from './downloadFormat';

const heic = {
	displayName: 'IMG_0001.HEIC',
	originalPath: 'originals/abc.heic',
	compatOriginalPath: 'originals/abc.compat.jpg'
};
const jpeg = {
	displayName: 'IMG_0002.jpg',
	originalPath: 'originals/def.jpeg',
	compatOriginalPath: null
};

describe('parseDownloadFormat', () => {
	test('defaults to original for missing or unknown values', () => {
		expect(parseDownloadFormat(null)).toBe('original');
		expect(parseDownloadFormat('zip')).toBe('original');
		expect(parseDownloadFormat('compatible')).toBe('compatible');
	});
});

describe('zipSourceFor', () => {
	test('original format always ships the untouched file', () => {
		expect(zipSourceFor(heic, 'original')).toEqual({
			path: 'originals/abc.heic',
			name: 'IMG_0001.HEIC'
		});
	});

	test('compatible format swaps in the JPEG rendition and renames it', () => {
		expect(zipSourceFor(heic, 'compatible')).toEqual({
			path: 'originals/abc.compat.jpg',
			name: 'IMG_0001.jpg'
		});
		expect(zipSourceFor({ ...heic, displayName: 'noext' }, 'compatible').name).toBe('noext.jpg');
	});

	test('photos without a rendition ship as original in both formats', () => {
		expect(zipSourceFor(jpeg, 'compatible')).toEqual({
			path: 'originals/def.jpeg',
			name: 'IMG_0002.jpg'
		});
	});
});
