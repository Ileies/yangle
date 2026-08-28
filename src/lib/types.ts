export enum AlbumRole {
	Owner = 'owner',
	Contributor = 'contributor',
	Viewer = 'viewer'
}

export enum DecisionMode {
	Independent = 'independent',
	Together = 'together'
}

export enum ResolveMode {
	Live = 'live',
	SwipeAllThenResolve = 'swipe-all-then-resolve'
}

export enum DecisionStatus {
	Undecided = 'undecided',
	Keep = 'keep',
	Delete = 'delete',
	Favorite = 'favorite'
}

export enum Orientation {
	Portrait = 'portrait',
	Landscape = 'landscape'
}

export enum DownloadBatchStatus {
	Pending = 'pending',
	Ready = 'ready',
	Failed = 'failed'
}

export type User = {
	email: string;
	displayName: string;
	createdAt: number;
};

export type Album = {
	id: number;
	ownerEmail: string;
	name: string;
	decisionMode: DecisionMode;
	resolveMode: ResolveMode | null;
	inviteToken: string | null;
	inviteRole: AlbumRole | null;
	createdAt: number;
};

export type AlbumShare = {
	id: number;
	albumId: number;
	email: string;
	role: AlbumRole;
	invitedAt: number;
};

// Album plus its earliest-uploaded photos (up to 3), used wherever albums are listed as
// cards (profile, /albums) - a "spread on a table" stack. Empty for albums with no photos.
export type PhotoUrlRef = { id: number; contentHash: string };

export type AlbumWithCover = Album & { coverPhotos: PhotoUrlRef[] };

// Lean wire payload for the swipe deck (see TODO.md 3.0) - never the full DB row shape, kept
// small since an album's whole undecided queue ships down in one `load` call.
export type DeckPhoto = {
	id: number;
	contentHash: string;
	displayName: string;
	width: number;
	height: number;
	orientation: Orientation;
	duplicateGroupId: number | null;
};

export type Photo = {
	id: number;
	albumId: number;
	contentHash: string;
	perceptualHash: string | null;
	duplicateGroupId: number | null;
	duplicateResolved: boolean;
	displayName: string;
	originalPath: string;
	compatOriginalPath: string | null;
	thumbnailPath: string;
	previewPath: string;
	width: number;
	height: number;
	orientation: Orientation;
	fileSize: number;
	takenAt: number | null;
	latitude: number | null;
	longitude: number | null;
	uploadedBy: string;
	uploadedAt: number;
};
