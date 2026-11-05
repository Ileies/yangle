# Yangle: instructions for Claude Code

Read `README.md` first for what this app is, how it works, the stack, and the data model. Read
`TODO.md` for what is still open. This file is operational guidance for working _in_ this repo:
gotchas and conventions that aren't obvious from the code itself.

## Before you start a session

- Use Bun >= 1.4.0 (`engines` in `package.json`), including in production. `Bun.Image` does all
  image processing, so there is no native image addon, no Nix dev shell and no `LD_LIBRARY_PATH`
  to set up. HEIC/HEIF and AVIF decoding is unavailable on Linux; see `README.md`. JPEG EXIF
  orientation is applied automatically, PNG/WebP orientation is not.
- Always run the dev server as `bun run dev` (`bun --bun vite dev`), never plain `vite dev`:
  Node's ESM loader doesn't understand the `bun:sqlite` import scheme that
  `drizzle-orm/bun-sqlite` relies on. The same goes for `build` and `preview`, use the scripts.
- This is SvelteKit 3: import project files via `#lib/...` (a `package.json` `imports` entry, the
  successor of `$lib`), read env vars via `$app/env/private` / `$app/env/public`, and declare
  every new variable in `src/env.ts`. Don't reintroduce SvelteKit 2 patterns.
- All persistent data (`local.db`, originals, previews, thumbnails, ZIPs) lives under `DATA_DIR`
  (default `storage/`, `data/` in the dev `.env`). Only `data/` is in `.gitignore`: never
  commit either one. Don't hardcode `storage/` or `local.db` paths, resolve them via `storageConfig.ts`.

## Testing changes

- `bun run check` (types) and `bun run lint` (prettier + eslint) must be clean.
- `bun test` runs the unit tests (`*.test.ts` next to the code: burst similarity, duplicate
  pairing, byte ranges, download format, image names, photo URLs, storage directories). They
  only cover pure logic. Add one when you touch that kind of code. Nothing automated covers
  routes, the database, or swipe-deck gestures yet (see `TODO.md`).
- `check` and `lint` do **not** catch routing bugs: SvelteKit's route-collision behavior (below)
  is invisible to both. Before calling any route-touching change done, hit it with `curl`
  against a running dev server, including as a _second_ test user where permission checks matter
  (album membership, contributor vs. viewer role, ownership). A 200 in the browser for the happy
  path doesn't confirm a 403/404 fires for someone who shouldn't have access.
- Gesture feel, orientation behavior and performance can only be verified on a real phone. Say so
  instead of claiming a swipe-deck change works because it type-checks.
- Use throwaway test data (a scratch album/user) and clean it up afterward: `sqlite3
<DATA_DIR>/local.db "DELETE FROM ..."` for rows, and remove any files you wrote under the data
  directory. Don't leave test artifacts in the database the user's own dev server is using.
- Run manual checks on a separate throwaway dev server on a different port (e.g.
  `bun run dev --port 5174`). Never alter the user's running dev server to test a change.
- Don't run `bun run deploy` unless asked: it builds, stops and restarts the production service
  and replaces the production database.

## Route structure: the +page/+server collision gotcha

A directory with both a `+page.svelte`/`+page.server.ts` and a `+server.ts` gets _every_ HTTP
method captured by `+server.ts`. A `+server.ts` that only exports `POST` makes `GET` to that
same path 405 instead of falling through to the page. This has caused real, silent breakage
here before (it once broke the upload page and the invite flow). Never co-locate an API endpoint with a page in the same route directory; give the endpoint its
own subpath (`albums/[id]/shares/+server.ts` alongside `albums/[id]/+page.svelte`, not replacing
it).

## SQLite

Foreign keys are enabled explicitly (`PRAGMA foreign_keys = ON` in `server/db/index.ts`):
`bun:sqlite` does not enforce them by default. If you ever touch how the `db` client is
constructed, keep that pragma; without it every `onDelete: cascade` in `schema.ts` silently
becomes a no-op instead of an error, which is a much worse failure mode (orphaned rows, not a
crash) to debug later. Cascades only cover rows, not files: removing photos or albums must also
delete their files on disk via `deleteStoredFiles` in `storage.ts` (as `deletePhotos` and
`deleteAlbum` do).

Schema changes go through Drizzle migrations: edit `src/lib/server/db/schema.ts`, then
`bun run db:generate` (writes a new file under `drizzle/`) and `bun run db:migrate` (applies
it). Never hand-edit the database's schema directly. Deployment applies the checked-in
migrations to a copy of the production database, so every schema change must ship as a migration
file.

## Conventions already established in this codebase

- **Decisions are never destructive.** A photo "delete" is a `decisions` row with
  `status: 'delete'`, never a row deletion. This is deliberate and is what several features
  (in-deck undo, the review list, independent-vs-together sharing) are built on top of for
  free. Don't introduce a second, actually-destructive delete path for photo _decisions_
  (permanent photo deletion via `deletePhotos` in `photos.ts` is a different, intentionally
  destructive operation: contributors/owners removing a photo from the album entirely, not a
  per-user decision).
- **Lean wire payloads for the swipe deck.** `DeckPhoto` (in `types.ts`) ships only what the
  client needs, not the full DB row. The swipe deck's `load` can ship a few hundred photos in
  one response, so this matters.
- **One state file per reactive scope**, not one global grab-bag: `state.svelte.ts` is
  app-wide, `swipeDeck.svelte.ts` only exists while the deck is mounted. Follow this split
  rather than adding unrelated state to either file.
- **Validate request input.** Album endpoints parse JSON bodies via `jsonBody.ts` and
  `/upload/submit` checks its file fields; malformed input must return a clean 400, never a 500.
- **Commit style**: small, thematic commits (`feat: add album creation and listing`, one
  concern per commit), matching existing `git log` history, not one large commit per session.
- **Docs follow code**: when a feature changes, update the matching part of `README.md`. Keep
  `TODO.md` limited to open work, move finished items into the README.

## Things intentionally not built yet

Don't "fix" these without checking `TODO.md` first, they're deliberate MVP scope cuts, not
oversights: video support, disk garbage collection for orphaned files, route/database/browser
tests (only pure-logic unit tests exist), process/reverse-proxy configuration in this repo (production runs as
a systemd service defined in the NixOS config, deployed with `bun run deploy`), admin/moderation
tooling, a full accessibility pass, and the `live` (SSE-based) resolve mode for `together`-mode
sharing (`swipe-all-then-resolve` is built; `live` needs realtime infra this app doesn't have
yet).
