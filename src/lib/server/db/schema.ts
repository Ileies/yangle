import {
	AlbumRole,
	DecisionMode,
	DecisionStatus,
	DownloadBatchStatus,
	Orientation,
	ResolveMode
} from '../../types';
import { integer, real, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
	email: text('email').notNull().primaryKey(),
	displayName: text('display_name').notNull(),
	createdAt: integer('created_at').notNull()
});

// One-time login links, emailed to the user. Consumed on first visit, then dead.
export const magicLinks = sqliteTable('magic_links', {
	token: text('token').notNull().primaryKey(),
	email: text('email').notNull(),
	createdAt: integer('created_at').notNull(),
	expiresAt: integer('expires_at').notNull(),
	consumedAt: integer('consumed_at'),
	// Where to send the browser after this link is consumed (e.g. back to an album invite),
	// instead of always landing on "/". Validated as a same-origin path before use.
	redirectTo: text('redirect_to')
});

// Server-side sessions so a login can be revoked (e.g. "log out everywhere").
export const sessions = sqliteTable('sessions', {
	token: text('token').notNull().primaryKey(),
	email: text('email')
		.references(() => users.email, { onDelete: 'cascade' })
		.notNull(),
	createdAt: integer('created_at').notNull(),
	expiresAt: integer('expires_at').notNull()
});

export const albums = sqliteTable('albums', {
	id: integer('id').primaryKey({ autoIncrement: true }).notNull(),
	ownerEmail: text('owner_email')
		.references(() => users.email, { onDelete: 'cascade' })
		.notNull(),
	name: text('name').notNull(),
	// How co-decision works when the album is shared with `decisionMode: together`.
	decisionMode: text('decision_mode')
		.$type<DecisionMode>()
		.default(DecisionMode.Independent)
		.notNull(),
	resolveMode: text('resolve_mode').$type<ResolveMode>(),
	// Shareable-link invite: anyone holding this token can join with `inviteRole`. Null means
	// no active link. Regenerating (or revoking) just overwrites/clears these - old links die
	// immediately since there's no separate invites table to leave stale rows in.
	inviteToken: text('invite_token').unique(),
	inviteRole: text('invite_role').$type<AlbumRole>(),
	createdAt: integer('created_at').notNull()
});

export const albumShares = sqliteTable(
	'album_shares',
	{
		id: integer('id').primaryKey({ autoIncrement: true }).notNull(),
		albumId: integer('album_id')
			.references(() => albums.id, { onDelete: 'cascade' })
			.notNull(),
		email: text('email')
			.references(() => users.email, { onDelete: 'cascade' })
			.notNull(),
		// Contributor can add photos, Viewer can only decide (keep/delete/favorite) on existing ones.
		role: text('role').$type<AlbumRole>().default(AlbumRole.Viewer).notNull(),
		invitedAt: integer('invited_at').notNull()
	},
	(t) => [unique().on(t.albumId, t.email)]
);

export const photos = sqliteTable(
	'photos',
	{
		id: integer('id').primaryKey({ autoIncrement: true }).notNull(),
		albumId: integer('album_id')
			.references(() => albums.id, { onDelete: 'cascade' })
			.notNull(),
		// sha256 of the file content. Uploading the same bytes twice (even under a different
		// name) resolves to the existing row instead of creating a duplicate.
		contentHash: text('content_hash').notNull(),
		// Perceptual hash (dHash), used to cluster visually-similar-but-not-identical photos
		// (e.g. a 20-shot burst) so they can be pre-resolved before entering the swipe deck.
		perceptualHash: text('perceptual_hash'),
		duplicateGroupId: integer('duplicate_group_id'),
		duplicateResolved: integer('duplicate_resolved', { mode: 'boolean' }).default(false).notNull(),
		displayName: text('display_name').notNull(),
		originalPath: text('original_path').notNull(),
		// JPEG rendition of the original, set only for HEIC/HEIF uploads - offered as the
		// download fallback for recipients whose device can't open HEIC directly.
		compatOriginalPath: text('compat_original_path'),
		thumbnailPath: text('thumbnail_path').notNull(),
		previewPath: text('preview_path').notNull(),
		width: integer('width').notNull(),
		height: integer('height').notNull(),
		orientation: text('orientation').$type<Orientation>().notNull(),
		fileSize: integer('file_size').notNull(),
		// EXIF capture time (epoch ms), when present in the file. Falls back to uploadedAt for display.
		takenAt: integer('taken_at'),
		// EXIF GPS coordinates, when present in the file.
		latitude: real('latitude'),
		longitude: real('longitude'),
		uploadedBy: text('uploaded_by')
			.references(() => users.email)
			.notNull(),
		uploadedAt: integer('uploaded_at').notNull()
	},
	(t) => [unique().on(t.albumId, t.contentHash)]
);

// Alternate file names seen for the same content hash (dedup name-conflict resolution).
export const photoNameVariants = sqliteTable('photo_name_variants', {
	id: integer('id').primaryKey({ autoIncrement: true }).notNull(),
	photoId: integer('photo_id')
		.references(() => photos.id, { onDelete: 'cascade' })
		.notNull(),
	name: text('name').notNull(),
	seenAt: integer('seen_at').notNull()
});

// Per-user decision on a photo. Never destructive - always editable, which is what makes
// "undo a delete" and independent-vs-together sharing modes work off the same table.
export const decisions = sqliteTable(
	'decisions',
	{
		id: integer('id').primaryKey({ autoIncrement: true }).notNull(),
		photoId: integer('photo_id')
			.references(() => photos.id, { onDelete: 'cascade' })
			.notNull(),
		email: text('email')
			.references(() => users.email, { onDelete: 'cascade' })
			.notNull(),
		status: text('status').$type<DecisionStatus>().default(DecisionStatus.Undecided).notNull(),
		decidedAt: integer('decided_at').notNull()
	},
	(t) => [unique().on(t.photoId, t.email)]
);

export const downloadBatches = sqliteTable('download_batches', {
	id: integer('id').primaryKey({ autoIncrement: true }).notNull(),
	albumId: integer('album_id')
		.references(() => albums.id, { onDelete: 'cascade' })
		.notNull(),
	email: text('email')
		.references(() => users.email, { onDelete: 'cascade' })
		.notNull(),
	status: text('status')
		.$type<DownloadBatchStatus>()
		.default(DownloadBatchStatus.Pending)
		.notNull(),
	zipPath: text('zip_path'),
	requestedAt: integer('requested_at').notNull(),
	readyAt: integer('ready_at')
});

export const downloadBatchPhotos = sqliteTable(
	'download_batch_photos',
	{
		id: integer('id').primaryKey({ autoIncrement: true }).notNull(),
		batchId: integer('batch_id')
			.references(() => downloadBatches.id, { onDelete: 'cascade' })
			.notNull(),
		photoId: integer('photo_id')
			.references(() => photos.id, { onDelete: 'cascade' })
			.notNull()
	},
	(t) => [unique().on(t.batchId, t.photoId)]
);

// Per-user "already downloaded" mark, independent of which batch it first came from.
export const photoDownloads = sqliteTable(
	'photo_downloads',
	{
		id: integer('id').primaryKey({ autoIncrement: true }).notNull(),
		photoId: integer('photo_id')
			.references(() => photos.id, { onDelete: 'cascade' })
			.notNull(),
		email: text('email')
			.references(() => users.email, { onDelete: 'cascade' })
			.notNull(),
		downloadedAt: integer('downloaded_at').notNull()
	},
	(t) => [unique().on(t.photoId, t.email)]
);
