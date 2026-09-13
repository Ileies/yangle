# Yangle — instructions for Claude Code

Read `README.md` first for what this app is, the stack, and the data model. Read `TODO.md` for
current status and what's left. This file is operational guidance for working _in_ this repo —
gotchas and conventions that aren't obvious from the code itself.

## Before you start a session

Use Bun >= 1.3.14 for `Bun.Image`, including for production. The Nix dev shell is optional and
no image-specific `LD_LIBRARY_PATH` is needed. HEIC/HEIF and AVIF decoding is unavailable on
Linux with this API; see `README.md` for platform limitations.

Always run the dev server as `bun run dev` (→ `bun --bun vite dev`), never plain `vite dev` —
Node's ESM loader doesn't understand the `bun:sqlite` import scheme `drizzle-orm/bun-sqlite`
relies on.

## Testing changes

There's no automated test suite yet (see `TODO.md`'s "explicitly out of scope" section — worth
adding once the swipe-deck gesture logic stabilizes). Until then:

- `bun run check` and `bun run lint` catch type errors and style issues, but **not** routing
  bugs — SvelteKit's route-collision behavior (below) is invisible to both.
- Before calling any route-touching change done, hit it with `curl` against a running dev
  server, including as a _second_ test user where permission checks matter (album membership,
  contributor vs. viewer role, ownership). A 200 in the browser for the happy path doesn't
  confirm a 403/404 fires for someone who shouldn't have access.
- Use throwaway test data (a scratch album/user), and clean it up afterward — `sqlite3 local.db
"DELETE FROM ..."` for rows, remove any test files you wrote under `storage/`. Don't leave
  test artifacts in the real `local.db` the user's own dev server is pointed at.
- Run manual checks on a separate throwaway dev server on a different port. Never alter the
  user's running dev server process to test a change.

## Route structure: the +page/+server collision gotcha

A directory with both a `+page.svelte`/`+page.server.ts` and a `+server.ts` gets _every_ HTTP
method captured by `+server.ts`. A `+server.ts` that only exports `POST` makes `GET` to that
same path 405 instead of falling through to the page — this has caused real, silent breakage
here before (see `TODO.md` §5's writeup). Never co-locate an API endpoint with a page in the
same route directory; give the endpoint its own subpath (`albums/[id]/shares/+server.ts`
alongside `albums/[id]/+page.svelte`, not replacing it).

## SQLite

Foreign keys are enabled explicitly (`PRAGMA foreign_keys = ON` in `server/db/index.ts`) —
`bun:sqlite` does not enforce them by default. If you ever touch how the `db` client is
constructed, keep that pragma; without it every `onDelete: cascade` in `schema.ts` silently
becomes a no-op instead of an error, which is a much worse failure mode (orphaned rows, not a
crash) to debug later.

Schema changes go through Drizzle migrations: edit `src/lib/server/db/schema.ts`, then
`bun run db:generate` (writes a new file under `drizzle/`) and `bun run db:migrate` (applies
it) — never hand-edit `local.db`'s schema directly.

## Conventions already established in this codebase

- **Decisions are never destructive.** A photo "delete" is a `decisions` row with
  `status: 'delete'`, never a row deletion — this is deliberate and is what several features
  (in-deck undo, the review list, independent-vs-together sharing) are built on top of for
  free. Don't introduce a second, actually-destructive delete path for photo _decisions_
  (permanent photo deletion via `deletePhotos` in `photos.ts` is a different, intentionally
  destructive operation — contributors/owners removing a photo from the album entirely, not a
  per-user decision).
- **Lean wire payloads for the swipe deck.** `DeckPhoto` (in `types.ts`) ships only what the
  client needs, not the full DB row — the swipe deck's `load` can be shipping a few hundred
  photos in one response, so this matters.
- **One state file per reactive scope**, not one global grab-bag: `state.svelte.ts` is
  app-wide, `swipeDeck.svelte.ts` only exists while the deck is mounted. Follow this split
  rather than adding unrelated state to either file.
- **Commit style**: small, thematic commits (`feat: add album creation and listing`, one
  concern per commit), matching existing `git log` history — not one large commit per session.

## Things intentionally not built yet

Don't "fix" these without checking `TODO.md` first — they're deliberate MVP scope cuts, not
oversights: video support, disk garbage collection for deleted photos/albums, automated tests,
production process management (systemd/PM2), admin/moderation tooling, an accessibility pass,
and the `live` (SSE-based) resolve mode for `together`-mode sharing (the `swipe-all-then-resolve`
mode is built; `live` needs realtime infra this app doesn't have yet).
