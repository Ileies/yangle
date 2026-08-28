import type { DeckPhoto } from './types';
import { hammingDistance } from './utils';

// Greedily lays out the closest available pair first. Clustering already guarantees that every
// member is a verified match; this ordering keeps the comparison UI focused on the most alike
// choices instead of relying on incidental upload order.
export function pairDuplicatesBySimilarity(photos: DeckPhoto[]): DeckPhoto[] {
	const remaining = [...photos];
	const paired: DeckPhoto[] = [];
	while (remaining.length > 1) {
		let bestA = 0;
		let bestB = 1;
		let bestDistance = Number.POSITIVE_INFINITY;
		for (let a = 0; a < remaining.length - 1; a++) {
			for (let b = a + 1; b < remaining.length; b++) {
				const distance = hammingDistance(remaining[a].perceptualHash, remaining[b].perceptualHash);
				if (distance < bestDistance) {
					bestDistance = distance;
					bestA = a;
					bestB = b;
				}
			}
		}
		paired.push(remaining[bestA], remaining[bestB]);
		remaining.splice(bestB, 1);
		remaining.splice(bestA, 1);
	}
	if (remaining[0]) paired.push(remaining[0]);
	return paired;
}
