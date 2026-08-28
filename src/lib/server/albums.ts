import { db } from './db';
import { albums, albumShares, photos, users } from './db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import { randomToken } from '$lib/utils';
import { AlbumRole, DecisionMode, ResolveMode } from '$lib/types';
import type { Album, AlbumShare, AlbumWithCover } from '$lib/types';

const COVER_PHOTOS_PER_ALBUM = 3;

// Evenly spaced picks across the full upload timeline, rather than just the first n - a
// burst of near-identical shots uploaded back to back would otherwise fill every cover
// slot with what's effectively the same photo.
function spreadSample<T>(items: T[], count: number): T[] {
	if (items.length <= count) return items;
	if (count <= 1) return [items[0]];
	const picked: T[] = [];
	for (let i = 0; i < count; i++) {
		picked.push(items[Math.round((i * (items.length - 1)) / (count - 1))]);
	}
	return picked;
}

// Up to 3 photos per album, spread across its upload timeline, used for the "spread on a
// table" cover stack wherever albums are listed as cards. Returns a Map so callers can
// look up by album id in O(1).
async function coverPhotosFor(albumIds: number[]): Promise<Map<number, number[]>> {
	if (albumIds.length === 0) return new Map();
	const rows = await db.query.photos.findMany({
		where: inArray(photos.albumId, albumIds),
		orderBy: (photo, { asc }) => asc(photo.uploadedAt)
	});
	const byAlbum = new Map<number, number[]>();
	for (const row of rows) {
		const ids = byAlbum.get(row.albumId) ?? [];
		ids.push(row.id);
		byAlbum.set(row.albumId, ids);
	}
	const covers = new Map<number, number[]>();
	for (const [albumId, ids] of byAlbum) {
		covers.set(albumId, spreadSample(ids, COVER_PHOTOS_PER_ALBUM));
	}
	return covers;
}

// Albums owned by, and albums shared with, this user - the two lists used everywhere
// an account needs to see "your albums" (profile, /albums).
export async function listAlbumsFor(
	email: string
): Promise<{ owned: AlbumWithCover[]; shared: AlbumWithCover[] }> {
	const shares = await db.query.albumShares.findMany({ where: eq(albumShares.email, email) });
	const sharedAlbumIds = shares.map((share) => share.albumId);

	const [owned, shared] = await Promise.all([
		db.query.albums.findMany({ where: eq(albums.ownerEmail, email) }),
		sharedAlbumIds.length
			? db.query.albums.findMany({ where: inArray(albums.id, sharedAlbumIds) })
			: Promise.resolve([])
	]);

	const covers = await coverPhotosFor([...owned, ...shared].map((album) => album.id));
	const withCover = (album: (typeof owned)[number]): AlbumWithCover => ({
		...album,
		coverPhotoIds: covers.get(album.id) ?? []
	});
	return { owned: owned.map(withCover), shared: shared.map(withCover) };
}

// The owner always has full (contributor-equivalent) rights, even without an albumShares row.
export async function getAlbumRole(albumId: number, email: string): Promise<AlbumRole | null> {
	const album = await db.query.albums.findFirst({ where: eq(albums.id, albumId) });
	if (!album) return null;
	if (album.ownerEmail === email) return AlbumRole.Owner;

	const share = await db.query.albumShares.findFirst({
		where: and(eq(albumShares.albumId, albumId), eq(albumShares.email, email))
	});
	return share?.role ?? null;
}

export function canContribute(role: AlbumRole | null): boolean {
	return role === AlbumRole.Owner || role === AlbumRole.Contributor;
}

// Shared "does this user have access" gate for every album-scoped route - fetches the album and
// the caller's role in one place so every route gets consistent 404-for-bad-id/missing-album vs.
// 403-for-no-access behavior instead of each repeating (and subtly diverging on) the same
// boilerplate. Throws via SvelteKit's `error()`, so callers can just await it and use the result.
export async function requireAlbumAccess(
	albumId: number,
	email: string
): Promise<{ album: Album; role: AlbumRole }> {
	if (!Number.isInteger(albumId)) error(404, 'Album not found');

	const album = await db.query.albums.findFirst({ where: eq(albums.id, albumId) });
	if (!album) error(404, 'Album not found');

	const role = await getAlbumRole(albumId, email);
	if (!role) error(403, 'No access to this album');

	return { album, role };
}

export async function createAlbum(ownerEmail: string, name: string): Promise<Album> {
	const [album] = await db
		.insert(albums)
		.values({ ownerEmail, name, decisionMode: DecisionMode.Independent, createdAt: Date.now() })
		.returning();
	return album;
}

export async function listShares(albumId: number): Promise<AlbumShare[]> {
	return db.query.albumShares.findMany({ where: eq(albumShares.albumId, albumId) });
}

// Every email with any access to the album - owner plus every share - used wherever a
// "together" decision needs to fan out to (or be compared across) all participants.
export async function listParticipants(albumId: number): Promise<string[]> {
	const album = await db.query.albums.findFirst({ where: eq(albums.id, albumId) });
	if (!album) return [];
	const shares = await listShares(albumId);
	return [album.ownerEmail, ...shares.map((share) => share.email)];
}

// Upsert - inviting someone already shared with just changes their role, it doesn't create a
// second row (the schema's unique(albumId, email) would reject that anyway).
export async function addOrUpdateShare(
	albumId: number,
	email: string,
	role: AlbumRole
): Promise<void> {
	// `album_shares.email` has an FK on `users.email` - inviting someone who's never signed in
	// needs a placeholder row first (same shape `consumeMagicLink` creates on first login; it
	// just fills in for real once they actually verify a magic link).
	const normalizedEmail = email.trim().toLowerCase();

	const existingUser = await db.query.users.findFirst({ where: eq(users.email, normalizedEmail) });
	if (!existingUser) {
		await db.insert(users).values({
			email: normalizedEmail,
			displayName: normalizedEmail.split('@')[0],
			createdAt: Date.now()
		});
	}

	await db
		.insert(albumShares)
		.values({ albumId, email: normalizedEmail, role, invitedAt: Date.now() })
		.onConflictDoUpdate({ target: [albumShares.albumId, albumShares.email], set: { role } });
}

export async function removeShare(albumId: number, email: string): Promise<void> {
	await db
		.delete(albumShares)
		.where(and(eq(albumShares.albumId, albumId), eq(albumShares.email, email)));
}

// Regenerates the shareable link, invalidating any previously issued one (there's only ever
// one active link per album, at a fixed role chosen when it's (re)created).
export async function setInviteLink(albumId: number, role: AlbumRole): Promise<string> {
	const inviteToken = randomToken(16);
	await db.update(albums).set({ inviteToken, inviteRole: role }).where(eq(albums.id, albumId));
	return inviteToken;
}

export async function revokeInviteLink(albumId: number): Promise<void> {
	await db
		.update(albums)
		.set({ inviteToken: null, inviteRole: null })
		.where(eq(albums.id, albumId));
}

export async function getAlbumByInviteToken(token: string): Promise<Album | null> {
	const album = await db.query.albums.findFirst({ where: eq(albums.inviteToken, token) });
	return album ?? null;
}

// Joining via a link is always additive - it never downgrades an existing share (e.g. a
// contributor clicking a viewer-role link stays a contributor). The owner already has full
// access and isn't affected either way.
export async function acceptInvite(token: string, email: string): Promise<Album | null> {
	const album = await getAlbumByInviteToken(token);
	if (!album || !album.inviteRole) return null;
	if (album.ownerEmail === email) return album;

	const existing = await db.query.albumShares.findFirst({
		where: and(eq(albumShares.albumId, album.id), eq(albumShares.email, email))
	});
	if (!existing || (existing.role === AlbumRole.Viewer && album.inviteRole !== AlbumRole.Viewer)) {
		await addOrUpdateShare(album.id, email, album.inviteRole);
	}
	return album;
}

export async function updateDecisionSettings(
	albumId: number,
	decisionMode: DecisionMode,
	resolveMode: ResolveMode | null
): Promise<void> {
	await db
		.update(albums)
		.set({
			decisionMode,
			resolveMode: decisionMode === DecisionMode.Together ? resolveMode : null
		})
		.where(eq(albums.id, albumId));
}

// Removes every photo's disk files, then the album row itself - `photos`/`album_shares`/
// `decisions`/`download_batches` all cascade via FK on delete, but the files under `storage/`
// don't, so those have to go first while we still have the rows to read paths from. Imports
// `storage.ts` lazily (it pulls in `sharp`, a native module) so that every other page routed
// through this file - the album list, settings, sharing, invites - doesn't need `sharp`'s
// native binary loadable just to render.
export async function deleteAlbum(albumId: number): Promise<void> {
	const { deleteStoredFiles } = await import('./storage');
	const albumPhotos = await db.query.photos.findMany({ where: eq(photos.albumId, albumId) });
	await Promise.all(albumPhotos.map((photo) => deleteStoredFiles(photo)));
	await db.delete(albums).where(eq(albums.id, albumId));
}
