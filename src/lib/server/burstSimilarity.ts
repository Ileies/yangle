import { hammingDistance } from '$lib/utils';
import type { Orientation } from '$lib/types';

export const BURST_CAPTURE_WINDOW_MS = 30_000;
export const BURST_DHASH_THRESHOLD = 6;
export const BURST_SSIM_THRESHOLD = 0.62;
export const BURST_COLOR_THRESHOLD = 0.72;

export type BurstFingerprint = {
	dHash: string;
	luminance: number[];
	colorHistogram: number[];
	imageSize: number;
};

export type BurstCandidate<T> = {
	photo: T & {
		id: number;
		width: number;
		height: number;
		orientation: Orientation;
		takenAt: number | null;
	};
	fingerprint: BurstFingerprint;
};

export type BurstSimilarity = {
	dHashDistance: number;
	ssim: number;
	colorSimilarity: number;
};

function compatibleMetadata<T>(a: BurstCandidate<T>, b: BurstCandidate<T>): boolean {
	if (a.photo.orientation !== b.photo.orientation) return false;

	const aRatio = a.photo.width / Math.max(a.photo.height, 1);
	const bRatio = b.photo.width / Math.max(b.photo.height, 1);
	if (Math.abs(Math.log(aRatio / bRatio)) > 0.12) return false;

	if (a.photo.takenAt !== null && b.photo.takenAt !== null) {
		return Math.abs(a.photo.takenAt - b.photo.takenAt) <= BURST_CAPTURE_WINDOW_MS;
	}
	return true;
}

// Windowed SSIM preserves local structure while tolerating the small exposure changes common
// in a camera burst. Values are averaged across 8x8 windows of the normalized luminance image.
export function structuralSimilarity(a: BurstFingerprint, b: BurstFingerprint): number {
	if (a.imageSize !== b.imageSize || a.luminance.length !== b.luminance.length) return 0;
	const size = a.imageSize;
	const windowSize = 8;
	const c1 = (0.01 * 255) ** 2;
	const c2 = (0.03 * 255) ** 2;
	let total = 0;
	let windows = 0;

	for (let top = 0; top < size; top += windowSize) {
		for (let left = 0; left < size; left += windowSize) {
			const aValues: number[] = [];
			const bValues: number[] = [];
			for (let y = top; y < Math.min(top + windowSize, size); y++) {
				for (let x = left; x < Math.min(left + windowSize, size); x++) {
					const index = y * size + x;
					aValues.push(a.luminance[index]);
					bValues.push(b.luminance[index]);
				}
			}

			const count = aValues.length;
			const meanA = aValues.reduce((sum, value) => sum + value, 0) / count;
			const meanB = bValues.reduce((sum, value) => sum + value, 0) / count;
			let varianceA = 0;
			let varianceB = 0;
			let covariance = 0;
			for (let i = 0; i < count; i++) {
				const deltaA = aValues[i] - meanA;
				const deltaB = bValues[i] - meanB;
				varianceA += deltaA * deltaA;
				varianceB += deltaB * deltaB;
				covariance += deltaA * deltaB;
			}
			const divisor = Math.max(count - 1, 1);
			varianceA /= divisor;
			varianceB /= divisor;
			covariance /= divisor;

			total +=
				((2 * meanA * meanB + c1) * (2 * covariance + c2)) /
				((meanA ** 2 + meanB ** 2 + c1) * (varianceA + varianceB + c2));
			windows++;
		}
	}

	return windows === 0 ? 0 : total / windows;
}

export function colorHistogramSimilarity(a: BurstFingerprint, b: BurstFingerprint): number {
	if (a.colorHistogram.length !== b.colorHistogram.length) return 0;
	return a.colorHistogram.reduce(
		(sum, value, index) => sum + Math.min(value, b.colorHistogram[index]),
		0
	);
}

export function compareBurstCandidates<T>(
	a: BurstCandidate<T>,
	b: BurstCandidate<T>
): BurstSimilarity | null {
	if (!compatibleMetadata(a, b)) return null;
	const dHashDistance = hammingDistance(a.fingerprint.dHash, b.fingerprint.dHash);
	if (dHashDistance > BURST_DHASH_THRESHOLD) return null;

	const ssim = structuralSimilarity(a.fingerprint, b.fingerprint);
	const colorSimilarity = colorHistogramSimilarity(a.fingerprint, b.fingerprint);
	if (ssim < BURST_SSIM_THRESHOLD || colorSimilarity < BURST_COLOR_THRESHOLD) return null;
	return { dHashDistance, ssim, colorSimilarity };
}

// Complete-link clustering: a candidate may join a group only when it independently matches
// every member. This deliberately prevents A≈B and B≈C from silently implying A≈C.
export function buildBurstClusters<T>(candidates: BurstCandidate<T>[]): BurstCandidate<T>[][] {
	const clusters: BurstCandidate<T>[][] = [];
	for (const candidate of candidates) {
		let bestCluster: BurstCandidate<T>[] | null = null;
		let bestScore = Number.NEGATIVE_INFINITY;
		for (const cluster of clusters) {
			const similarities = cluster.map((member) => compareBurstCandidates(candidate, member));
			if (similarities.some((similarity) => similarity === null)) continue;
			const score = similarities.reduce(
				(sum, similarity) => sum + similarity!.ssim + similarity!.colorSimilarity,
				0
			);
			if (score > bestScore) {
				bestScore = score;
				bestCluster = cluster;
			}
		}
		if (bestCluster) bestCluster.push(candidate);
		else clusters.push([candidate]);
	}
	return clusters;
}
