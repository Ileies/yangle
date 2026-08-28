import { describe, expect, test } from 'bun:test';
import { Orientation } from '$lib/types';
import {
	buildBurstClusters,
	colorHistogramSimilarity,
	compareBurstCandidates,
	structuralSimilarity,
	type BurstCandidate,
	type BurstFingerprint
} from './burstSimilarity';

function fingerprint(dHash: string, luminance = 100, colorBin = 0): BurstFingerprint {
	const colorHistogram = Array<number>(64).fill(0);
	colorHistogram[colorBin] = 1;
	return { dHash, luminance: Array<number>(64).fill(luminance), colorHistogram, imageSize: 8 };
}

function candidate(
	id: number,
	fp: BurstFingerprint,
	takenAt: number | null = 1_000
): BurstCandidate<{
	id: number;
	width: number;
	height: number;
	orientation: Orientation;
	takenAt: number | null;
}> {
	return {
		photo: { id, width: 4000, height: 3000, orientation: Orientation.Landscape, takenAt },
		fingerprint: fp
	};
}

describe('burst similarity', () => {
	test('identical normalized images have full structural and color similarity', () => {
		const fp = fingerprint('0000000000000000');
		expect(structuralSimilarity(fp, fp)).toBeCloseTo(1);
		expect(colorHistogramSimilarity(fp, fp)).toBe(1);
	});

	test('rejects differently colored flat images even when dHash is identical', () => {
		const green = candidate(1, fingerprint('0000000000000000', 182, 12));
		const blue = candidate(2, fingerprint('0000000000000000', 18, 3));
		expect(compareBurstCandidates(green, blue)).toBeNull();
	});

	test('rejects visually matching photos outside the capture-time window', () => {
		const fp = fingerprint('0000000000000000');
		expect(compareBurstCandidates(candidate(1, fp, 1_000), candidate(2, fp, 32_000))).toBeNull();
	});

	test('does not create a transitive bridge cluster', () => {
		const common = { luminance: 100, colorBin: 0 };
		const a = candidate(1, fingerprint('0000000000000000', common.luminance, common.colorBin));
		const b = candidate(2, fingerprint('f000000000000000', common.luminance, common.colorBin));
		const c = candidate(3, fingerprint('ff00000000000000', common.luminance, common.colorBin));
		expect(
			buildBurstClusters([a, b, c]).map((cluster) => cluster.map(({ photo }) => photo.id))
		).toEqual([[1, 2], [3]]);
	});
});
