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

- **Passwordless auth** — magic-link email sign-in, revocable sessions.
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
  mind later. See `TODO.md` §3 for the full design rationale.
- **Sharing** — invite by email or shareable link, `contributor` (can upload) vs. `viewer`
  (can only decide) roles, independent or joint (`together`) decision modes. In `together` mode,
  everyone swipes independently and a resolve screen surfaces only the photos where decisions
  disagree, for one final joint call.
- **Downloads**: a resumable ZIP of everything you kept/favorited, with per-photo badges for
  already-downloaded / new-since-last-download / not-yet-decided.

## Tech stack

- **SvelteKit 2** + **Svelte 5** (runes) on **Bun**
- **Tailwind CSS 4** + **DaisyUI 5**
- **Drizzle ORM** over **SQLite** (`bun:sqlite` at runtime — no native `better-sqlite3` build
  needed; see [NixOS notes](#nixos-notes))
- **`@sveltejs/adapter-node`** — self-hosted, matches the "storage is local disk" design
- **`Bun.Image`** for thumbnails, previews and JPEG compatibility renditions on supported hosts;
  **`pngjs`** reads the small generated PNGs used for duplicate fingerprints (pure JavaScript).
  **`fflate`** handles streamed ZIP downloads.
- No test runner yet — see `TODO.md`

## Getting started

### Prerequisites

- [Bun >= 1.3.14](https://bun.com/blog/bun-v1.3.14), including in production (`bun run start`).
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
| `DATABASE_URL`                                                      | Path to the SQLite file (e.g. `local.db`)                                                                                                                                                                                                                           |
| `STORAGE_DIR`                                                       | Where uploaded originals/previews/thumbnails/ZIPs are written on disk                                                                                                                                                                                               |
| `APP_URL`                                                           | Used to build absolute links in magic-link emails                                                                                                                                                                                                                   |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | SMTP creds for sending real magic-link emails. Leave blank in dev — see above. `SMTP_FROM`'s domain must have SPF/DKIM authorization on that SMTP account, or receiving providers will silently spam-filter or drop the mail even though your server "accepted" it. |

### Scripts

| Command               | What it does                                                                  |
| --------------------- | ----------------------------------------------------------------------------- |
| `bun run dev`         | Dev server (must be `bun --bun vite dev`, wired in already — see NixOS notes) |
| `bun run build`       | Production build                                                              |
| `bun run preview`     | Preview a production build                                                    |
| `bun run check`       | `svelte-kit sync` + `svelte-check`                                            |
| `bun run lint`        | `prettier --check` + `eslint`                                                 |
| `bun run format`      | `prettier --write`                                                            |
| `bun run db:generate` | Generate a Drizzle migration from schema changes                              |
| `bun run db:migrate`  | Apply pending migrations                                                      |
| `bun run db:studio`   | Drizzle Studio (browse/edit the SQLite DB)                                    |

## NixOS notes

Image processing uses Bun's built-in codecs, without a native npm image addon or a custom
`LD_LIBRARY_PATH`. The flake provides Bun; update its nixpkgs input once Bun >= 1.3.14 is
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

## Data model

The core design decision: nothing is ever deleted from the database when a user "deletes" a
photo from their own perspective — `decisions` just gets a row with `status: delete`, keyed per
`(photo, user)`. That single choice is what makes in-deck undo, the durable review list, and
independent-vs-together sharing all fall out of the same table for free, instead of needing
separate mechanisms.

| Table                                        | Purpose                                                                                           |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `users`                                      | keyed by email                                                                                    |
| `magic_links`                                | one-time login tokens, 15 min TTL                                                                 |
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
storage/                 — gitignored, local disk storage (originals/previews/thumbnails/zips)
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
shape), not a straight one. Deliberately kept to just this one spot for the MVP.

## Status / roadmap

See `TODO.md` for what's built, what's left, and the reasoning behind non-obvious decisions.
