import { describe, expect, test } from 'bun:test';
import { photoUrl } from './photoUrls';

describe('photoUrl', () => {
	test('versions a rendition URL with its content hash', () => {
		expect(photoUrl({ id: 42, contentHash: 'abc123' }, 'thumbnail')).toBe(
			'/photos/42/thumbnail?v=abc123'
		);
	});
});
