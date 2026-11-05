# Yangle

Mobile-first, swipe-based photo triage app. Upload an album, swipe through the photos like
vocabulary flashcards (delete / keep / favorite), optionally share the album with someone else
to decide solo or jointly, then download the surviving photos as a ZIP.

Named after Yang (my girlfriend) + "angle"/"untangle" — also a nod to the yin-yang duality the
core swipe decision (keep vs. delete) mirrors, which shows up in a couple of deliberate visual
touches (see [Design language](#design-language)).

No i18n (English only), no hosted database, no S3 — this is a small, self-hosted, single-file
SQLite app that keeps uploaded photos on local disk.

## Features

- **Passwordless auth** - magic-link email sign-in with a 6-digit code alternative (for signing in
  on a different device than the one the email is read on), revocable sessions.
- **Albums**: create, upload (drag/pick files or a whole folder), share. HEIC/HEIF and AVIF
  decoding requires a supported macOS/Windows host; Linux uploads must use JPEG, PNG or WebP.
- **Dedup on upload** — content-hash based, so re-uploading the same photo (even renamed) never
  creates a duplicate; a name conflict on the same content prompts you to pick which name to
  keep.
- **Burst/near-duplicate resolution** — photos from one upload are gated by capture metadata,
  then verified with dHash, structural similarity, and color similarity. Confirmed bursts are
  resolved via a single-elimination bracket before they reach the swipe deck.
- **The swipe deck** — full-screen, gesture-driven keep/delete/favorite triage with pinch-zoom,
  prefetching, orientation handling, in-deck undo, and a durable review list for changing your
  mind later. See [How it works](#how-it-works) for the design.
- **Sharing** — invite by email or shareable link, `contributor` (can upload) vs. `viewer`
  (can only decide) roles, independent or joint (`together`) decision modes. In `together` mode,
  everyone swipes independently and a resolve screen surfaces only the photos where decisions
  disagree, for one final joint call.
- **Downloads**: a resumable ZIP of everything you kept/favorited, with per-photo badges for
  already-downloaded / new-since-last-download / not-yet-decided.

## Tech stack

- **SvelteKit 3** + **Svelte 5** (runes) on **Bun**
- **Tailwind CSS 4** + **DaisyUI 5**
- **Drizzle ORM** over **SQLite** (`bun:sqlite` at runtime — no native `better-sqlite3` build
  needed; see [NixOS notes](#nixos-notes))
- **`@sveltejs/adapter-bun`** — self-hosted on Bun, matching the "storage is local disk" design
- **`Bun.Image`** for thumbnails, previews and JPEG compatibility renditions on supported hosts;
  **`pngjs`** reads the small generated PNGs used for duplicate fingerprints (pure JavaScript).
  **`fflate`** handles streamed ZIP downloads.
- `bun test` for unit tests of pure logic; no route, database or gesture tests yet, see `TODO.md`
- Installable PWA (`static/manifest.webmanifest` + icons). No offline support: the app is
  inherently server-backed, only the installability layer is provided.

## Getting started

### Prerequisites

- [Bun >= 1.4.0](https://bun.com/docs/installation), including in production (`bun run start`).
- A SQLite-capable environment; see [NixOS notes](#nixos-notes) below.

### Setup

```sh
bun install
cp .env.example .env   # then fill in SMTP_* if you want real emails; see below
bun run db:migrate
bun run dev
```

Open the printed URL (default `http://localhost:5173`). Sign in with any email — with no SMTP
configured, the magic link is logged to the console instead of actually emailed, which is the
easiest way to develop locally.

### Environment variables (`.env`)

| Variable                                                            | Purpose                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATA_DIR`                                                          | Root for all persistent data: `local.db`, originals, previews, thumbnails and ZIPs. Defaults to `storage/`. Relative to the working directory, or an absolute path such as `/var/lib/yangle`.                                                                       |
| `ORIGIN`                                                            | Public app origin used to build absolute links in emails; defaults to `http://localhost:5173` in development                                                                                                                                                        |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | SMTP creds for sending real magic-link emails. Leave blank in dev — see above. `SMTP_FROM`'s domain must have SPF/DKIM authorization on that SMTP account, or receiving providers will silently spam-filter or drop the mail even though your server "accepted" it. |

The app, Drizzle CLI and deployment database backups all use the same `DATA_DIR`.
The directory is created automatically. To separate data from code, set this in `.env`:

```dotenv
DATA_DIR=/var/lib/yangle
```

When upgrading an existing installation, stop the app, move the old root-level `local.db`
into the storage directory (including any `local.db-wal`, `local.db-shm` or `local.db-journal`
sidecars), and remove `DATABASE_URL` from the environment. It is no longer used. To change
`DATA_DIR` later, move the entire data directory to the new location before restarting;
stored photo paths are relative to it. Run `bun run db:migrate` after configuring the path.

### Scripts

| Command               | What it does                                                                  |
| --------------------- | ----------------------------------------------------------------------------- |
| `bun run dev`         | Dev server (must be `bun --bun vite dev`, wired in already — see NixOS notes) |
| `bun run build`       | Production build                                                              |
| `bun run deploy`      | Build here, rsync artifacts, migrate and restart the systemd service          |
| `bun run preview`     | Preview a production build                                                    |
| `bun run check`       | `svelte-kit sync` + `svelte-check`                                            |
| `bun run lint`        | `prettier --check` + `eslint`                                                 |
| `bun run format`      | `prettier --write`                                                            |
| `bun run db:generate` | Generate a Drizzle migration from schema changes                              |
| `bun run db:migrate`  | Apply pending migrations                                                      |
| `bun run db:studio`   | Drizzle Studio (browse/edit the SQLite DB)                                    |

The source checkout on the server lives at `/projects/private/yangle`. Production runs from
`/var/www/yangle/index.js`; the contents of `build/` are synced directly into that directory.
The adapter build leaves production dependencies external, so deployment also syncs `package.json`
and `bun.lock` and runs `bun install --production --frozen-lockfile` on the target. The target
needs Bun and rsync, but no Git checkout or PM2. Install source dependencies with
`bun install --frozen-lockfile` before building.

`bun run deploy` builds on the machine where it is invoked. On `pronix` it deploys directly;
elsewhere it uses SSH host `ros`. Use `bun run deploy --local` to force direct deployment,
`bun run deploy --host user@server` for another SSH destination, or add `--dry-run` to build
and preview the file sync without stopping or modifying the deployed service.

The target must have Bun 1.4 or newer and `yangle.service` configured to run `bun ./index.js` with
working directory `/var/www/yangle`. Activate the updated NixOS configuration before the first deployment.
Run as root or grant passwordless sudo for `systemctl stop yangle.service` and
`systemctl restart yangle.service`. SSH deployments also need write access to the target.

Production environment variables can be configured in `.env` in the runtime directory or in
the target NixOS systemd service; service variables take precedence. Deployment updates generated
runtime files, dependency manifests, and production dependencies, preserving uploads, databases,
and backups.
Deployment transfers a separate temporary database copy for local migration. Relative `DATA_DIR` paths resolve inside
`/var/www/yangle`; use an absolute path to keep all data outside the deployment directory.
The script builds before stopping the service, creates a consistent SQLite snapshot on the
server, downloads it into a private temporary directory, and applies the checkout's Drizzle
migrations locally. After integrity and foreign key checks, it uploads the migrated database,
syncs the build, validates the uploaded database, and atomically replaces the production DB
while preserving its ownership and permissions. It then restarts systemd and checks HTTP on
port 3007. The service stays stopped throughout the database round trip to prevent lost writes.
Production does not receive migration scripts or the `drizzle/` directory.

Database paths use the target service's `DATA_DIR`, falling back to the runtime `.env` and
then `storage/`. The original snapshot remains at
`DATA_DIR/.deploy-<deployment-id>/original.db`; deployment prints its absolute path after
installation. Local temporary copies are removed on success or failure. A failed download,
migration or upload leaves the production database untouched and attempts to restart the
service. If deployment fails during build sync or after database installation, inspect the
service before retrying; code and database replacement are separate operations. Retained
snapshots require manual cleanup when no longer needed. Restore a snapshot only with the
service stopped and SQLite WAL state handled safely.

## NixOS notes

Image processing uses Bun's built-in codecs, without a native npm image addon or a custom
`LD_LIBRARY_PATH`. The flake provides Bun; update its nixpkgs input once Bun >= 1.4.0 is
available there. No system or flake-input update is performed as part of the migration.

[`Bun.Image`](https://bun.com/docs/runtime/image) supports JPEG, PNG and WebP on Linux.
HEIC/HEIF and AVIF decoding requires supported OS codecs on macOS/Windows. JPEG EXIF orientation
is applied automatically; PNG/WebP EXIF orientation is not. Output preserves ICC profiles.
Duplicate fingerprints use the decoded colour values, without the former explicit sRGB conversion.

- **`better-sqlite3`** (the natural `drizzle-kit` CLI driver): needs to compile from source via
  node-gyp, not set up out of the box here. Swapped for `@libsql/client` (ships prebuilt napi
  bindings), used **only** by the `drizzle-kit` CLI, never at runtime.

Also: `vite dev`/`vite build` must run as `bun --bun vite dev` (already wired into
`package.json`), not plain `vite dev` — otherwise Vite's SSR module loader falls back to
Node's ESM loader, which doesn't understand the `bun:sqlite` import scheme used by
`drizzle-orm/bun-sqlite`. Production also runs on Bun via `bun run start`.

## How it works

### Auth

- `magic_links` + `sessions` tables, helpers in `server/auth.ts`; `hooks.server.ts` fills
  `event.locals.user` from the `session` cookie (httpOnly, `sameSite: lax`, `secure` outside dev).
- `/login` takes an email, creates a link and sends it via `mail.ts` (logged to the console when
  SMTP is unconfigured). A bad, missing or reused token redirects to `/login?error=...`.
- Each link row also holds a 6-digit `code`, emailed next to the link, for signing in on another
  device. Only the newest live link per email is eligible and link and code are consumed
  together. `code_attempts` is incremented atomically _before_ comparing and the code dies after
  5 wrong guesses.
- Requests per email are rate-limited (1 minute cooldown, answered with a 429).
- `redirectTo` (same-origin paths only) round-trips through a `magic_links` column, so e.g.
  `/invite/[token]` can send a visitor through sign-in and back.
- `POST /logout` ends the current session. `/profile` edits the display name, lists owned and
  shared albums, and offers "log out everywhere" (`destroyAllSessions()`).

### Albums and upload

- `/` redirects to `/albums` or `/login`. `/albums` lists owned and shared albums,
  `/albums/new` creates one (name only; decision mode is changed later in settings).
- **Upload** (`/albums/[id]/upload`): the client computes a `sha256Hex()` per file (same helper
  on client and server), POSTs the hashes to `/upload/check` and only sends bytes the server
  doesn't know yet. `storeUpload()` writes the original, a ~1600px WebP preview and a ~320px WebP
  thumbnail, and computes the content hash (exact dedup) and dHash (near-duplicate clustering).
  Request bodies and file fields are validated; malformed input returns a clean 400.
- **Name conflicts**: the same content under a different name prompts which name to keep
  (`/upload/resolve`), the other lands in `photo_name_variants`.
- **Permissions**: `canContribute(getAlbumRole(...))` guards both upload endpoints and the
  "Upload" button.
- **HEIC/HEIF input**: decodable only on supported macOS/Windows hosts; Linux returns a per-file
  error asking for JPEG or PNG. Supported hosts also produce a quality-92 JPEG compatibility
  rendition next to the preserved original. Previously stored originals and renditions stay
  downloadable everywhere.
- **Photo serving** (`/photos/[id]/[size]`): auth-gated streaming of thumbnail/preview/original/
  compat with a per-request album membership check (files live outside `static/`).
  `Cache-Control: private, max-age=31536000, immutable`, since the bytes for a content hash never
  change.

### The swipe deck

The make-or-break screen; everything else feeds photos into it. The acceptance bar:

1. Zoom and swipe are never confused (no phantom swipe while pinching, no stuck panning).
2. The current card is interactive the instant the deck opens or advances (no spinner on a
   cached photo).
3. Rotating the phone with the OS rotation lock on changes nothing in the UI.
4. A burst of 20 near-identical shots takes one bracket pass, not 20 judgment calls.
5. Every decision is revisable: nothing here is more permanent than an UPDATE to one `decisions`
   row.

**Data flow.** `albums/[id]/swipe/+page.server.ts` ships the user's undecided photos (excluding
those in unresolved duplicate clusters) ordered by `uploadedAt`, as lean `DeckPhoto` payloads.
`swipeDeck.svelte.ts` holds the session state: `queue` (`queue[0]` is the current card, swiped
cards are spliced out) and a 20-entry `history` undo stack. Decisions are optimistic: the card
leaves immediately and `POST /albums/[id]/decisions` fires afterwards as a batch (coalesced every
~400ms or 5 decisions), with retry and a non-blocking toast on final failure. Reopening the deck
resumes where you left off, since `load` filters to undecided photos. The queue is a snapshot:
photos added by others appear on the next open (live updates belong with the SSE work in
`TODO.md`).

**Components.** `+page.svelte` (owns the deck state, renders `queue[0]` plus 1-2 cards stacked
behind), `SwipeCard` (gestures, zoom/pan, exit animation), `SwipeButtons` (same decision path as
gestures), `DuplicateBracket`, and `prefetchQueue.ts` (sequencing logic, independent of any
component).

**Gestures.** `@use-gesture/vanilla` behind a `use:gesture` action, with an explicit state machine
(`idle | swiping | panning | pinching` plus scale):

- One finger at `scale === 1` starts `swiping`; the direction (horizontal = delete/keep, up =
  favorite) locks after the first ~10px. At `scale > 1` it starts `panning`; swipe-dismiss only
  re-arms once scale is exactly 1. Mode is gated on scale, not heuristics.
- Two fingers always win and cancel any swipe in progress (like iOS Photos).
- Double-tap zooms to ~2.5x at the tap point, and out to 1x with the same spring as a
  pinch released out of bounds.
- Dismissal uses `distance > SWIPE_DISMISS_PX || velocity > SWIPE_DISMISS_VELOCITY`; the card
  tilts proportionally to drag distance. Thresholds live in `constants.ts`.
- Zoom model: a single `translate3d(...) scale(...)` on the image (GPU layer, never animating
  width/height/top/left), pinch anchored at the finger midpoint, pan clamped to image bounds with
  rubber-band and spring-back, scale clamped to 1-4 with the same treatment. `touch-action: none`
  on the image, because the gesture library owns all touch interpretation.

**Favorite** is a third exit direction: drag up toward a heart at top-center (it scales and glows
on approach), or tap the heart. `favorite` is its own enum value, not `keep` plus a flag, so the
review grid can filter by it. The card shrinks toward the heart on exit.

**Latency (server in Germany, viewers possibly in China).** Three image sizes (thumbnail, preview,
original; originals only at ZIP time). `prefetchQueue.ts` decodes the focused card first, then
warms `PREFETCH_AHEAD_COUNT` (4) upcoming previews with `fetchPriority: 'low'`, at most 2
concurrent. A DPR check avoids fetching 3x pixels on 1x displays. The cached thumbnail, blurred
via CSS, serves as the blur-up placeholder until the preview decodes. A failed preview shows a
retry affordance. A CDN/reverse-proxy cache in front of the origin is the biggest remaining lever
for the transpacific route, but an infra decision outside this repo.

**Orientation.** `orientation.svelte.ts` listens to `screen.orientation`'s `change` event
(fallback: `matchMedia`), which only fires on a genuine layout change and therefore respects the
OS rotation lock (accelerometer-based `deviceorientation` was ruled out for that reason). The
`allowLandscapeRotation` toggle (deck settings, `localStorage`) selects between portrait layout
with rotating button glyphs (default, camera-app style) and a full landscape layout with
re-anchored buttons.

**Undo.** A persistent bottom-corner affordance, not shake-to-undo (too easy to trigger by
accident), with a one-line reminder ("Undo: deleted IMG_042.jpg"). It pops the last `history`
entry, re-inserts the photo at `queue[0]` and writes the reverted status through the same batched
endpoint.

**Progress and end states.** `{decided} / {total}` with a thin bar; a dedicated "nothing to swipe"
state (link to upload for contributors, else review) when the deck opens empty; an end-of-deck
summary (kept/favorited/deleted) linking to review and the album.

**Accessibility.** Keyboard: `←` delete, `→` keep, `↑` favorite, `⌘/Ctrl+Z` undo, through the same
decision path as gestures. `SwipeButtons` are real `<button>`s with `aria-label`s, card images get
`alt={displayName}`, and `prefers-reduced-motion` reduces fly-out/spring/rotation to an opacity
cross-fade.

### Near-duplicate (burst) resolution

Plain swiping is poor for 20 near-identical shots (each feels like a "keep"), so clusters are
resolved before reaching the deck.

- **Clustering** is scoped to the photos of one upload request, so an old album photo is never
  reopened by a later scene with a similar layout. EXIF capture time (when both exist),
  orientation and aspect ratio gate candidates; dHash is a cheap prefilter; windowed SSIM over
  normalized luminance and a colour-histogram intersection must both pass. Complete-link
  clustering requires every pair to match, preventing `A ≈ B ≈ C` bridge chains. O(n²) within one
  upload, fine at the intended sizes.
- **Bracket**: a cluster of N becomes a single-elimination bracket computed client-side, with no
  new table: its state is derivable from which photos still have `duplicateResolved: false`, so a
  reload recomputes the same bracket. Odd sizes get one bye per round; rounds greedily pair the
  closest dHash fingerprints.
- **UI** (`DuplicateBracket.svelte`): a split-screen with a draggable divider (drag toward the
  photo to discard; tap on either half also works). Losers get a `delete` decision immediately
  via the normal decisions path (revisable later), the last survivor gets
  `duplicateResolved: true`. Progress spans the phase ("Round 2 of 3 · burst 4 of 7"), and
  "keep both" is supported.
- **Handoff**: resolved survivors and "keep both" pairs are appended to the live deck queue
  without a reload.

### Decisions and the review list

Swiping upserts the `decisions` row for `(photoId, currentUser)`; the batched deck writes and
in-deck undo are both callers of that one upsert. `/albums/[id]/review` groups all photos by
current decision (deleted / kept / favorited / undecided) and lets any decision, including
bracket losers, be flipped after the fact. This is the durable, cross-session undo; in-deck undo
is a same-session convenience on top.

### Sharing and permissions

- Invite by email (`album_shares` row; unknown addresses get a placeholder `users` row) or by
  shareable link (`/invite/[token]`). Roles: `contributor` (add photos) and `viewer` (decide only).
- `/albums/[id]/settings` (owner only): shares list, email invite, invite link, decision-mode
  radio, delete-album danger zone. Deleting an album cascades through the FKs and also removes its
  files under `storage/`. Revoking a share leaves that user's `decisions` alone so access can be
  re-granted without losing their swipes.
- `independent` mode: everyone has their own `decisions` rows, no coordination.
- `together` mode with `swipe-all-then-resolve`: everyone swipes independently, then
  `/albums/[id]/resolve` (`server/conflicts.ts#listConflicts`) shows only photos where every
  participant has a real decision and they don't all agree. One pick overwrites every
  participant's row (`applyDecisionToAll`), which removes it from the conflict list.
- API endpoints live under dedicated subpaths (`shares/`, `invite-link/`, `decision-mode/`,
  `delete/`, `resolve/apply/`), never beside a page (see the route-collision gotcha below).

### Downloads

- `/albums/[id]/download` lists the user's kept/favorited photos (deleted ones are excluded) with
  per-photo badges (already downloaded / new since last download / not yet decided). The user
  picks `?format=original|compatible` when a HEIC compatibility rendition exists.
- `/download/zip` builds a ZIP with `fflate` (pure JS, no native binary), writing chunks to a temp
  file under `storage/zips`, renaming it into place and redirecting to the stable
  `/download/zip/[batchId]`. That route supports `HEAD`, `Range` and `If-Range` with a known
  `Content-Length` and `ETag`, so interrupted downloads resume, and checks album membership and
  batch ownership. Originals are read from disk one at a time.
- `download_batches` goes `pending` → `ready`; on ready, `photo_downloads` is marked for each
  photo × user. This does not confirm the client received every byte. Re-downloading is always
  allowed ("new" is a badge, not a filter).
- Duplicate display names within one ZIP get the photo id appended before the extension.

## Data model

The core design decision: nothing is ever deleted from the database when a user "deletes" a
photo from their own perspective — `decisions` just gets a row with `status: delete`, keyed per
`(photo, user)`. That single choice is what makes in-deck undo, the durable review list, and
independent-vs-together sharing all fall out of the same table for free, instead of needing
separate mechanisms.

| Table                                        | Purpose                                                                                           |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `users`                                      | keyed by email                                                                                    |
| `magic_links`                                | one-time login tokens + 6-digit codes (5 guesses max), 15 min TTL                                 |
| `sessions`                                   | revocable server-side sessions, 30 day TTL                                                        |
| `albums`                                     | owner, name, invite link/role, `decisionMode` (independent/together), `resolveMode`               |
| `album_shares`                               | who an album is shared with + role (`contributor` can add photos, `viewer` can only decide)       |
| `photos`                                     | one row per **unique** image (dedup'd by content hash) per album                                  |
| `photo_name_variants`                        | alternate file names seen for the same content hash                                               |
| `decisions`                                  | **per (photo, user)** status: undecided/keep/delete/favorite — never destructive, always editable |
| `download_batches` / `download_batch_photos` | ZIP generation jobs and their contents                                                            |
| `photo_downloads`                            | per (photo, user) "already downloaded" mark                                                       |

Full schema lives in `src/lib/server/db/schema.ts` (the single source of truth for the data
model).

## Project structure

```
src/
  lib/
    constants.ts        — app-wide constants (timeouts, image sizes, gesture thresholds)
    types.ts             — shared enums/types (DecisionStatus, AlbumRole, ...)
    utils.ts              — small pure helpers used across client+server (hashing, formatting)
    state.svelte.ts     — app-wide shared reactive state (Svelte 5 runes)
    swipeDeck.svelte.ts — swipe-deck-scoped reactive state (queue/history/undo)
    prefetchQueue.ts      — preview-image prefetch sequencing for the swipe deck
    orientation.svelte.ts — device-rotation-vs-lock detection
    components/          — Svelte components (SwipeCard, SwipeButtons, DuplicateBracket, ...)
    server/
      db/
        schema.ts        — Drizzle schema
        index.ts          — `db` export (drizzle client, opens `bun:sqlite`, enables FK pragma)
      auth.ts              — magic-link + session helpers
      mail.ts               — sends magic-link/share emails (falls back to console.log in dev)
      storage.ts            — local-disk upload storage, thumbnail/preview generation, hashing
      albums.ts              — role/permission checks, album CRUD, sharing, invites
      photos.ts               — photo CRUD, dedup-by-hash lookup, duplicate clustering
      decisions.ts             — per-user decision upserts
      conflicts.ts              — `together` mode's swipe-all-then-resolve conflict query
      downloads.ts               — ZIP download batches + per-photo download tracking
  routes/                — SvelteKit routes (pages + API endpoints)
  hooks.server.ts        — reads session cookie → `event.locals.user`
storage/ (or DATA_DIR)   - data directory (local.db, originals/previews/thumbnails/zips); `data/` is gitignored
drizzle/                 — generated SQL migrations
```

One SvelteKit gotcha worth knowing before adding routes: a directory containing both a
`+page.svelte`/`+page.server.ts` **and** a `+server.ts` gets _every_ HTTP method captured by
`+server.ts` — if it only exports `POST`, a `GET` to that same path 405s instead of falling
through to render the page. This project avoids it by never co-locating an API endpoint with a
page in the same directory (API endpoints live in a dedicated subpath, e.g.
`albums/[id]/shares/+server.ts` next to `albums/[id]/+page.svelte`, not inside it).

## Design language

The core interaction (binary keep-or-delete decision) is a yin-yang metaphor, so a couple of
deliberate visual nods reinforce it without turning the UI kitschy: the near-duplicate
resolution screen's split-screen divider is a curved S-line (literally the yin-yang boundary
shape), not a straight one; its midpoint follows the drag and its control points scale with the
drag offset instead of flattening at the extremes. Deliberately kept to just this one spot for the
MVP: no yin-yang imagery in navigation, icons or the logo, which is a branding decision for later.

## Status / roadmap

All planned MVP features are built. `TODO.md` lists what is still open (device testing, platform
gaps, deferred scope).
