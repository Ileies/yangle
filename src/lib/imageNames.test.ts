import { describe, expect, test } from 'bun:test';
import { flattenImageName, uniqueImageName } from './imageNames';

describe('flattenImageName', () => {
	test('removes Unix and Windows directory paths', () => {
		expect(flattenImageName('holiday/day-one/photo.jpg')).toBe('photo.jpg');
		expect(flattenImageName('holiday\\day-one\\photo.jpg')).toBe('photo.jpg');
	});
});

describe('uniqueImageName', () => {
	test('keeps the original name when it is unused', () => {
		expect(uniqueImageName('folder/photo.jpg', new Set())).toBe('photo.jpg');
	});

	test('increments suffixes before the extension', () => {
		const used = new Set(['photo.jpg', 'photo_1.jpg', 'photo_2.jpg']);
		expect(uniqueImageName('folder/photo.jpg', used)).toBe('photo_3.jpg');
	});

	test('adds another suffix instead of counting past 999', () => {
		const used = new Set(Array.from({ length: 1000 }, (_, i) => `photo${i ? `_${i}` : ''}.jpg`));
		expect(uniqueImageName('photo.jpg', used)).toBe('photo_999_1.jpg');
		expect(uniqueImageName('photo_1000.jpg', new Set(['photo_1000.jpg']))).toBe('photo_1000_1.jpg');
	});
});
