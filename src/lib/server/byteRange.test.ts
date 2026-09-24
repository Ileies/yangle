import { describe, expect, test } from 'bun:test';
import { parseByteRange } from './byteRange';

describe('parseByteRange', () => {
	test('accepts bounded, open ended, and suffix requests', () => {
		expect(parseByteRange('bytes=10-19', 100)).toEqual({ start: 10, end: 19 });
		expect(parseByteRange('bytes=95-', 100)).toEqual({ start: 95, end: 99 });
		expect(parseByteRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
		expect(parseByteRange('bytes=90-999', 100)).toEqual({ start: 90, end: 99 });
	});

	test('rejects ranges beyond the end of the file', () => {
		expect(parseByteRange('bytes=100-', 100)).toBe('unsatisfiable');
		expect(parseByteRange('bytes=20-10', 100)).toBe('unsatisfiable');
		expect(parseByteRange('bytes=-0', 100)).toBe('unsatisfiable');
	});

	test('ignores malformed and multi-range requests', () => {
		expect(parseByteRange('bytes=0-1,10-11', 100)).toBeNull();
		expect(parseByteRange('bytes=-', 100)).toBeNull();
		expect(parseByteRange('items=0-1', 100)).toBeNull();
	});
});
