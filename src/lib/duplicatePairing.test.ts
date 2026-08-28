import { describe, expect, test } from 'bun:test';
import { Orientation, type DeckPhoto } from './types';
import { pairDuplicatesBySimilarity } from './duplicatePairing';

function photo(id: number, perceptualHash: string): DeckPhoto {
	return {
		id,
		perceptualHash,
		contentHash: String(id),
		displayName: `${id}.jpg`,
		width: 4000,
		height: 3000,
		orientation: Orientation.Landscape,
		duplicateGroupId: 1
	};
}

describe('pairDuplicatesBySimilarity', () => {
	test('puts the closest available photos beside each other', () => {
		const result = pairDuplicatesBySimilarity([
			photo(1, '0000000000000000'),
			photo(2, 'ffffffffffffffff'),
			photo(3, '0000000000000001'),
			photo(4, 'fffffffffffffffe')
		]);
		expect(result.map(({ id }) => id)).toEqual([1, 3, 2, 4]);
	});

	test('leaves an odd contestant as the final bye', () => {
		const result = pairDuplicatesBySimilarity([
			photo(1, '0000000000000000'),
			photo(2, '0000000000000001'),
			photo(3, 'ffffffffffffffff')
		]);
		expect(result.map(({ id }) => id)).toEqual([1, 2, 3]);
	});
});
