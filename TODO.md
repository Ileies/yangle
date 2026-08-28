# Yangle — TODO / Project Plan

Mobile-first, swipe-based photo triage app. Upload an album, swipe through photos like
vocabulary flashcards (delete / keep / favorite), share albums with someone else (e.g.
solo-decide or decide-together), then download the surviving set as a ZIP. Named after Yang
(my girlfriend) + "angle"/"untangle" — also a nod to the yin-yang duality that the core swipe
decision (keep vs. delete) mirrors, which we lean into visually (see Design language below).

No i18n — English only. SQLite is a local file (`local.db`, no Turso/hosted DB). Uploaded
photos live on local disk (no S3), served by the app itself.

Legend: `[x]` done in this session's scaffold, `[ ]` not started yet.

---

## 0. Foundation / scaffold (this session)

- [x] SvelteKit 2 + Svelte 5 (runes) + Bun, scaffolded via `sv create`
- [x] Tailwind 4 + DaisyUI 5 (`light`/`dark`, follows `prefers-color-scheme`)
- [x] `@sveltejs/adapter-node` (self-hosted, matches "local disk storage" requirement)
- [x] Drizzle ORM, SQLite dialect
  - Runtime driver: `drizzle-orm/bun-sqlite` (native to Bun, zero extra native deps)
  - `drizzle-kit` CLI driver: `@libsql/client` (dev-only; `better-sqlite3` fails to build on
    NixOS without extra toolchain — see Nix note below)
- [x] Initial migration generated & applied (`drizzle/0000_*.sql` → `local.db`, 11 tables)
- [x] File structure (see below)
- [x] `flake.nix` + `.envrc` (`use flake`) dev shell — see Nix note below
- [x] Type-check, lint, format, and a dev-server smoke test all pass clean
- [ ] PWA manifest (`static/manifest.webmanifest` + icons + `<link rel="manifest">` in
      `app.html`) — cheap to add and buys the "installed app" feel (home-screen icon, no
      browser chrome) that matters a lot for a swipe-heavy full-screen mobile UI. Not full
      offline support (there's nothing meaningful to do offline here, the app is inherently
      server-backed) — just the installability/manifest layer.

### NixOS note (flag for future friction)

Two native-binary npm packages hit the classic NixOS non-FHS problem:

- **`sharp`** (image resizing/thumbnailing): its prebuilt binary `dlopen()`s `libstdc++.so.6`
  at runtime, which isn't on the default library path outside FHS distros. Fixed by the
  project's `flake.nix`, which sets `LD_LIBRARY_PATH` to include `stdenv.cc.cc.lib`. **Always
  run this project inside the flake dev shell** (`direnv allow`, or `nix develop`) or `sharp`
  will crash with `ERR_DLOPEN_FAILED`.
- **`better-sqlite3`** (would've been the natural drizzle-kit CLI driver): needs to compile
  from source via node-gyp, which isn't set up out of the box. Swapped for `@libsql/client`
  (ships prebuilt napi bindings) — used **only** by the `drizzle-kit` CLI, not at runtime.

Also: `vite dev` / `vite build` must run as `bun --bun vite dev` (see `package.json`), not
plain `vite dev` — otherwise Vite's SSR module loader falls back to Node's ESM loader, which
doesn't understand the `bun:sqlite` import scheme used by `drizzle-orm/bun-sqlite`.

### File structure

```
src/
  lib/
    constants.ts        — app-wide constants (timeouts, image sizes, gesture thresholds)
    types.ts             — shared enums/types (DecisionStatus, AlbumRole, ...)
    utils.ts              — small pure helpers used across client+server (hashing, formatting)
    state.svelte.ts     — app-wide shared reactive state (`$state`, one object, Svelte 5 runes)
    server/
      db/
        schema.ts        — Drizzle schema (single source of truth for the data model)
        index.ts          — `db` export (drizzle client)
      auth.ts              — magic-link + session helpers
      mail.ts               — sends magic-link emails (falls back to console.log in dev)
      storage.ts            — local-disk upload storage, thumbnail/preview generation, hashing
      albums.ts              — role/permission checks, owned+shared album queries, create
      photos.ts               — photo CRUD, dedup-by-hash lookup, name-variant bookkeeping
    components/          — (not yet created) Svelte components
  routes/                — SvelteKit routes (pages + API endpoints)
  hooks.server.ts        — reads session cookie → `event.locals.user`
storage/                 — gitignored, local disk storage
  originals/  previews/  thumbnails/  zips/
drizzle/                 — generated SQL migrations
```

**Why one `state.svelte.ts` file:** mirrors the pattern from `adhd-tasker` (a sibling project) —
a single reactive object avoids scattered stores and makes it obvious where "current user" /
"is rotation allowed" / etc. live. If the swipe-session queue state (Phase 2) turns out to need
its own file for size reasons, split it out explicitly rather than letting it creep in here.

### Data model (implemented in `schema.ts`)

| Table                                        | Purpose                                                                                           |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `users`                                      | keyed by email                                                                                    |
| `magic_links`                                | one-time login tokens, 15 min TTL                                                                 |
| `sessions`                                   | revocable server-side sessions, 30 day TTL                                                        |
| `albums`                                     | owner, name, `decisionMode` (independent/together), `resolveMode` (live/swipe-all-then-resolve)   |
| `album_shares`                               | who an album is shared with + role (contributor can add photos, viewer can only decide)           |
| `photos`                                     | one row per **unique** image (dedup'd by content hash) per album                                  |
| `photo_name_variants`                        | alternate file names seen for the same content hash                                               |
| `decisions`                                  | **per (photo, user)** status: undecided/keep/delete/favorite — never destructive, always editable |
| `download_batches` / `download_batch_photos` | ZIP generation jobs and their contents                                                            |
| `photo_downloads`                            | per (photo, user) "already downloaded" mark                                                       |

The core design decision: nothing is ever deleted from the DB when a user "deletes" a photo —
`decisions` just gets a row with `status: delete`. This is what makes "undo a delete
afterwards" and independent-vs-together sharing modes fall out of the same table for free.

---

## 1. Auth (passwordless, magic link)

- [x] Schema (`magic_links`, `sessions`) + server helpers (`createMagicLink`,
      `consumeMagicLink`, `createSession`, `getSessionUser`, `destroySession`)
- [x] `hooks.server.ts` populates `event.locals.user` from the session cookie
- [x] `mail.ts` (nodemailer; logs the link to console when SMTP isn't configured — convenient
      for local dev, no mail server needed)
- [x] `/login` page: email input → `createMagicLink` + `sendMagicLinkEmail`. Redirects to `/`
      if already signed in; shows a "check your email" state after sending; surfaces
      `?error=missing|invalid` from the verify route as a message above the form.
- [x] `/login/verify?token=...` route (`+server.ts` GET handler): `consumeMagicLink` → sets the
      `session` cookie (httpOnly, `sameSite: lax`, `secure` outside dev) → redirects to `/`.
      Bad/missing/reused token → redirects back to `/login?error=...` instead of erroring.
- [x] Logout action — `POST /logout` (`+server.ts`): destroys the current session, clears the
      cookie, redirects to `/login`
- [x] Rate-limit magic-link requests per email — `magic_links.createdAt` (added in migration
      `0002`) + a `MAGIC_LINK_RESEND_COOLDOWN_MS` (1 min) check in `createMagicLink()`; returns
      `null` when a request is already in flight, which the `/login` action turns into a 429
      with a "please wait a minute" message instead of silently resending
- [x] `/profile` — edit display name (form action, persists via `updateDisplayName()`), lists
      albums owned + albums shared with you (queries `albums`/`album_shares` directly; no join
      helpers/relations set up yet since Albums (2) isn't built - revisit with a proper
      `db/relations.ts` once that's needed elsewhere too), "log out everywhere"
      (`destroyAllSessions()` — deletes every `sessions` row for the email, not just the
      current cookie)

All of the above tested end-to-end against the dev server (curl): resend cooldown returns 429
on the 2nd request within a minute, verify token is one-time-use (reused token → redirect with
`error=invalid`), display name change persists across requests, and "log out everywhere"
invalidates the session immediately (subsequent `/profile` request redirects to `/login`).

---

## 2. Albums & upload

- [x] **HEIC/HEIF input support**: most contributors will be uploading straight from an
      iPhone, which shoots HEIC by default — and no browser can render HEIC in an `<img>` tag.
      `sharp` already links against `libheif` (confirmed via `sharp.versions` on this machine),
      so `storeUpload()` decodes it without extra setup; thumbnail/preview are always
      re-encoded to WebP already, so those were unaffected either way. For the **original**
      file (kept byte-for-byte for ZIP download, since an Apple recipient wants the real
      HEIC): `storeUpload()` now also writes a JPEG compatibility rendition
      (`compatOriginalPath`, quality 92) through the same sharp/libvips pipeline whenever the
      source format is HEIC/HEIF/AVIF, so a Windows/Android recipient has something they can
      open without the sender needing to know or care. Deliberately **not** ffmpeg: most
      prebuilt ffmpeg binaries aren't compiled with `libheif` support at all (HEVC licensing),
      so it's both a second native dependency to fight NixOS/FHS issues for (see Nix note
      above) and a _less_ reliable HEIC path than the sharp/libvips we already use — no reason
      to introduce it just to duplicate a conversion sharp already does in the same pipeline
      call. Sharp also carries over the embedded ICC profile (iPhones shoot Display P3) when
      converting to JPEG, avoiding washed-out colors.
  - [ ] Still needs a real-device test: confirm `sharp`'s HEIC decode performs acceptably
        (it's slower than JPEG) under real upload volume, not just a one-off test image
  - [ ] Download UI should distinguish "original (HEIC)" vs. "compatible (JPEG)" when
        `compatOriginalPath` is set, rather than silently picking one

- [x] **`/` (homepage)**: no real landing page for the MVP — `+page.server.ts` just redirects
      straight to `/albums` (logged in) or `/login` (logged out). `+page.svelte` is
      unreachable dead weight kept only because SvelteKit requires one alongside
      `+page.server.ts`.

- [x] **`/albums`** — list albums the user owns or is shared on. Logic (`listAlbumsFor()`)
      lives in `src/lib/server/albums.ts` so `/profile` can reuse the same owned/shared
      lists instead of duplicating the query.
- [x] **`/albums/new`** — create album (name only for now; decision mode defaults to
      `independent` and is changed later from album settings once sharing (Section 5) exists)
- [x] **Upload flow (`/albums/[id]/upload`)**:
  - Client hashes each file (`sha256Hex()` in `$lib/utils.ts`, shared between client and
    server so both sides compute the exact same hash) **before** upload, POSTs the hash list
    to `/albums/[id]/upload/check`, and only sends bytes for files that endpoint doesn't
    already know about — bandwidth-friendly for large albums re-synced from a phone
  - Server: `storeUpload()` (already implemented) → writes original + WebP preview + WebP
    thumbnail, computes content hash (exact dedup) and dHash (near-duplicate clustering)
  - **Name-conflict UI**: if `/upload/check` reports a content hash already in the album
    under a different file name, the page shows "keep `IMG_002.jpg` or `Strand.jpg`?" —
    resolving POSTs to `/upload/resolve`, which updates `photos.displayName` and records the
    name not kept in `photo_name_variants` so it isn't lost
- [x] **Contributor permission check**: `canContribute(getAlbumRole(...))` in
      `src/lib/server/albums.ts`, enforced in both upload endpoints and reused by the album
      page to decide whether to show the "Upload" button at all
- [x] **Photo serving (`/photos/[id]/[size]`)**: not in the original plan but needed before
      an album page can show anything — auth-gated file streaming (thumbnail/preview/
      original/compat) that checks album membership per request, since files live outside
      `static/` on purpose (see intro). `Cache-Control: private, max-age=31536000, immutable`
      since a given content hash's bytes never change.

Tested end-to-end against a running dev server: album creation; upload of two images;
thumbnail grid rendering; re-uploading the same bytes under a new name correctly surfaced as
a conflict (not a silent duplicate) and resolving it updated `displayName` while preserving
the old name in `photo_name_variants`; a second, unrelated user got `404` on the album page,
`403` on both the thumbnail endpoint and the upload endpoint — confirming permission checks
are enforced per-request, not just hidden in the UI.

---

## 3. The swipe deck (the hard part)

This is the make-or-break UX of the whole app — everything else in this project exists to
feed photos into this screen and record what happens here. Needs real device testing, not
just desktop Chrome devtools throttling — test on an actual mid-range Android and an iPhone,
on real mobile data, not just wifi.

**Definition of "perfect" for this feature** (the acceptance bar, not just a checklist):

1. Zoom and swipe are never confused, on any device, at any scale — no "phantom swipe" while
   trying to pinch, no "stuck panning" that eats a swipe gesture.
2. The current card is always ready to interact with the instant the deck opens or advances —
   no spinner-then-pop-in on a cached photo, ever.
3. Rotating the phone with the OS rotation lock **on** produces zero UI change. This is the
   literal acceptance test for 3.3, not a nice-to-have.
4. A burst of 20 near-identical shots takes one bracket pass, not 20 individual "is this a
   keep?" judgment calls.
5. Every decision made here (including duplicate-bracket losses) is revisable — nothing this
   screen does is more permanent than an UPDATE to one `decisions` row.

### 3.0 Client-side data flow & state

The deck needs to feel instant (no server round-trip between cards), so it works off a
client-side queue hydrated once from the server, not a decision-per-navigation model.

- [x] `src/routes/albums/[id]/swipe/+page.server.ts` `load`: fetch the album's photos not yet
      `duplicateResolved === false` in a pending cluster (those go through 3.4 first) and not
      yet decided by the current user (`decisions.status === 'undecided'` or no row), ordered
      by `uploadedAt`. Ship down `{ id, thumbnailPath-derived URL, previewPath-derived URL,
width, height, orientation }` per photo — never the DB row shape verbatim, keep the
      wire payload lean since this can be a few hundred photos.
- [x] `src/lib/swipeDeck.svelte.ts` (new, session-scoped — **not** the same file as the
      app-wide `state.svelte.ts`, this state only exists while the deck is mounted):
  ```ts
  type DeckState = {
  	queue: DeckPhoto[]; // remaining, in order
  	index: number; // always 0 in practice — swiped cards are spliced out, not
  	// hidden — keeps `queue[0]` = current card an invariant everywhere else reads
  	history: { photo: DeckPhoto; previousStatus: DecisionStatus; nextStatus: DecisionStatus }[];
  	// ^ bounded (last 20) undo stack, see 3.6
  };
  ```
- [x] A decision is optimistic: splice the card out of `queue`, push to `history`, animate the
      exit, **then** fire `POST /albums/[id]/decisions` (fire-and-forget with retry-on-failure,
      not awaited before advancing — the UI must never block on network for the core loop). If
      the request ultimately fails after retries, surface a small non-blocking toast ("couldn't
      save 3 decisions, retrying...") rather than rolling back the card into the deck — losing
      your place in a 200-photo album because of a flaky network is worse than a rare missed
      write that a background retry will fix.
- [x] `POST /albums/[id]/decisions` accepts a **batch** (`{ photoId, status }[]`), not one
      call per swipe — the client coalesces rapid swipes (every ~400ms or every 5 decisions,
      whichever first) into one request. This matters a lot on the China-latency path: one
      round trip per swipe would make the deck feel laggy even though the UI itself never
      waits on it.
- [x] End-of-deck state: once `queue.length === 0`, show a summary (N kept, N favorited, N
      deleted this session) with links to `/albums/[id]/review` and `/albums/[id]` — not a
      dead end.
- [x] Resume behavior: since the `load` query already filters to undecided photos, closing the
      tab mid-deck and reopening `/albums/[id]/swipe` naturally resumes where you left off —
      no separate "session" concept needed server-side.

### 3.1 Component/file structure

- [x] `src/routes/albums/[id]/swipe/+page.svelte` — thin: owns the `swipeDeck` state instance,
      renders `<SwipeCard>` for `queue[0]` (+ 1-2 upcoming stacked behind it for depth, see
      3.2), the button bar, and the progress indicator
- [x] `src/lib/components/SwipeCard.svelte` — one photo: image element, gesture bindings
      (3.1.1), zoom/pan transform (3.1.2), decision-swipe exit animation
- [x] `src/lib/components/SwipeButtons.svelte` — delete / favorite(center) / keep, rotates
      per 3.3, dispatches the same decision path as a gesture so keyboard/tap and swipe are
      one code path, not two
- [x] `src/lib/components/DuplicateBracket.svelte` — 3.4, mounted instead of the deck when the
      album has unresolved clusters; hands off to the normal deck on completion
- [x] `src/lib/prefetchQueue.ts` — the sequencing logic from 3.2, decoupled from any component
      so it's independently testable

### 3.1.1 Gesture handling: never confuse zoom and swipe

- [x] Use a gesture library rather than hand-rolling touch math — `@use-gesture/vanilla`
      behind a thin Svelte action (`use:gesture`) is the better fit of the two candidates:
      framework-agnostic, no React coupling to strip out, and its pointer-event unification
      already handles the mouse/touch/pen distinction correctly (useful for desktop testing
      too, even though desktop isn't a target platform — devtools touch emulation lies often
      enough that testing with a real trackpad/mouse as a secondary sanity check is worth
      keeping open).
- [x] Explicit state machine (a `type GestureMode = 'idle' | 'swiping' | 'panning' | 'pinching'`
      plus current scale — not ad-hoc booleans), transitions:
  - `idle`, `scale === 1`, one-finger drag starts → `swiping`. Horizontal component dominant =
    delete/keep candidate; vertical-up component dominant = favorite candidate (see 3.5).
    Direction is locked in on gesture start based on the first ~10px of movement, not
    re-evaluated mid-drag — prevents a diagonal drag from feeling like it "fights" the user.
  - `idle`, `scale > 1`, one-finger drag starts → `panning`, moves the image within its zoomed
    bounds (clamped, see 3.1.2). Swipe-dismiss does **not** re-arm until `scale` returns to
    exactly `1` (either via double-tap-out or a pinch back down) — this is the crux of "never
    confuse zoom and swipe": the mode is gated on scale, not on gesture heuristics.
  - Two-finger touch, any state → `pinching`, always wins over whatever single-finger mode was
    active (a mid-swipe drag that gains a second finger cancels the swipe and starts a pinch —
    match iOS Photos exactly here, don't invent different behavior).
  - `pinching` end → back to `idle` at whatever scale the pinch left off at (not forced back to
    the swipe-armed `scale === 1` — if the user pinches to 1.8x and lets go, they're now
    panning-mode until they explicitly zoom back out).
- [x] Double-tap = quick zoom to ~2.5x centered on the tap point (not the image center — pinch
      convention), double-tap again at any point while zoomed = zoom out to exactly 1x with the
      same spring-back animation used for the pinch-released-past-bounds case (3.1.2), so there
      aren't two different "return to 1x" motions in the app.
- [x] Tune `SWIPE_DISMISS_PX`/`SWIPE_DISMISS_VELOCITY`/`ZOOM_MIN_SCALE`/`ZOOM_MAX_SCALE`
      (already in `constants.ts`, currently placeholder guesses) against real devices — the
      velocity threshold in particular needs a flick-vs-drag distinction: a fast short flick
      should dismiss even if it doesn't cross `SWIPE_DISMISS_PX`, a slow drag that does cross
      it should still dismiss. Standard "OR" gate: `distance > PX || velocity > VELOCITY`.
- [x] Card rotates slightly (a few degrees, proportional to horizontal drag distance, clamped)
      while being dragged — the one bit of "juice" that makes a swipe deck feel like a swipe
      deck instead of a slideshow; skipping this is the single easiest way to make this screen
      feel cheap.

### 3.1.2 Zoom & pan mechanics

- [x] Transform model: track `{ scale, translateX, translateY }` in the card's local state,
      applied as a single `transform: translate3d(...) scale(...)` on the image element (not
      separate wrapper divs per transform — one transform, `will-change: transform`, GPU
      layer). Never animate `width`/`height`/`top`/`left` — those aren't composited and will
      visibly stutter on mid-range Android.
- [x] Pinch anchors on the midpoint between the two touch points, not the image center —
      standard pinch-to-zoom expectation. On pinch update, recompute `translateX/Y` so the
      point under the fingers stays under the fingers (the actual math: convert the anchor
      point to image-local coordinates before the scale change, then re-derive the translate
      that keeps that same image-local point under the same screen coordinate after scaling).
- [x] Pan is clamped to the image's actual bounds at the current scale — never let the user pan
      the image fully off-screen into empty space. When a pinch/pan ends outside bounds
      (rubber-banded past the edge, which should be allowed _during_ the gesture for a natural
      feel), spring back into bounds with a short eased animation on release.
- [x] Scale is clamped to `[ZOOM_MIN_SCALE, ZOOM_MAX_SCALE]` (currently 1–4) with the same
      rubber-band-during-gesture, spring-back-on-release treatment at both ends.
- [x] `touch-action: none` on the image element (not `pan-y`/`pan-x`) since the gesture library
      owns all touch interpretation here — letting the browser's native scroll/zoom compete
      with the custom gesture handling is a common source of "swipe feels janky on iOS
      specifically" bugs.

### 3.2 Lazy loading, thumbnails, and global latency

**The concrete problem:** the server is in Germany. A relative in China loading full-size
originals over a congested transpacific route will get a spinner, not a swipe deck. The fix
is architectural, not "just add a loading spinner":

- [x] **Three image sizes, already modeled**: thumbnail (~320px, grids + duplicate-resolution
      screen), preview (~1600px, what the swipe deck actually displays and zooms into — NOT
      the multi-megapixel original), original (only fetched once, at final ZIP download time).
      This alone cuts the swipe-deck payload by an order of magnitude vs. serving originals.
- [x] **Prefetch queue, not naive `<img loading="lazy">`** (`src/lib/prefetchQueue.ts`): keep
      `PREFETCH_AHEAD_COUNT` (4) preview images ahead of the current card warmed in the browser
      cache. Concrete algorithm, driven off `queue[0]` changing:
  1. Cancel/deprioritize any in-flight prefetch for a photo that's no longer within the
     current window (it fell behind because of a delete, or the window shifted).
  2. `await` the focused card's `Image().decode()` — decode, not just `load`, since `decode()`
     is what guarantees the browser has done the (potentially expensive) bitmap decode off
     the main thread before you rely on the image being paint-ready.
  3. Only after that resolves, kick off fetches for the next `PREFETCH_AHEAD_COUNT` photos not
     already cached, as `Image()` objects with `fetchPriority: 'low'` (the focused card's own
     load, when it happens, uses `fetchPriority: 'high'`).
  4. Cap concurrent prefetches (e.g. 2) rather than firing all 4 at once — on a poor
     connection, 4 simultaneous requests each proceed slower than 2 queued, and the _next_
     card (index 1) should finish before index 4 even starts.
  - `<link rel="prefetch">` doesn't give this control (no way to sequence/cancel/prioritize) —
    hence the hand-rolled queue instead of relying on browser-native prefetch hints.
- [x] **Aggressive HTTP caching**: `/photos/[id]/[size]` (already built, Section 2) responds
      `Cache-Control: private, max-age=31536000, immutable` since content-hash-derived files
      never change — already correct, no further work here, just confirming the swipe deck's
      `<img>`/`Image()` usage doesn't accidentally bust it (no cache-busting query params).
- [x] **Infra-level recommendation (not app code, flag for later)**: a CDN/reverse-proxy cache
      in front of the origin — e.g. Cloudflare free tier — even though storage stays
      local-disk. This is the single biggest lever for the China round-trip problem, since a
      cache hit at a nearby PoP beats any client-side trick, but it's an infra decision outside
      this repo's scope, not something to build now.
- [x] Serve WebP (already the storage format) with `srcset`/`sizes` or a manual DPR check
      before requesting, so a 1x display doesn't download 3x pixels it can't show. Practically:
      since preview is capped at 1600px already, this mostly matters for the thumbnail grid
      (Section 2) on high-DPR phones, less so inside the deck where the preview is already
      sized for "one photo, full screen."
- [x] Skeleton/blur-up placeholder while the preview loads: reuse the already-fetched
      **thumbnail** (tiny, near-instant even on a bad connection) scaled up and blurred via CSS
      `filter: blur(...)` as the placeholder, cross-fading to the sharp preview on decode —
      free, since the thumbnail is already being loaded for prefetch bookkeeping anyway, no
      need for a separate base64-inline placeholder mechanism.
- [x] Explicit failure state per card: if a preview fails to load (timeout/network error, not
      hypothetical on a bad China route), show a retry affordance on that card rather than a
      broken-image icon or a deck that silently stalls waiting on a `decode()` that will never
      resolve.

### 3.3 Orientation: rotate only when the device genuinely did

The tricky requirement: distinguish "the phone is physically tilted" from "the OS actually
reports a new orientation" — because if the OS's rotation lock is on, tilting the phone should
change **nothing** in the UI. This is achievable and actually simpler than it sounds:

- [x] Listen to `screen.orientation`'s `change` event (not `deviceorientation`/accelerometer
      data, and not a `matchMedia('(orientation: landscape)')` poll). `screen.orientation`
      only fires when the browser's layout viewport orientation _actually_ changes — which
      inherently respects the OS-level rotation lock, since a locked screen never re-renders
      the viewport in the first place. No manual "is rotation locked?" detection needed; this
      event _is_ that detection.
  - Fallback for older iOS Safari (patchy `screen.orientation` support): `matchMedia`'s
    `change` event is a reasonable proxy there, with the same "only fires on genuine layout
    change" property.
  - Wrap both behind one `src/lib/orientation.svelte.ts` helper exposing a single reactive
    `angle`/`isLandscape`, so `SwipeCard`/`SwipeButtons` don't each need feature-detection
    branches.
- [x] **Two distinct behaviors**, gated by a user-facing toggle (`allowLandscapeRotation` in
      `state.svelte.ts`, already scaffolded):
  1. **Toggle off (default)**: layout stays fixed/portrait. On a confirmed orientation
     change, only the button _glyphs_ rotate 90° in place — camera-app style — to indicate
     "up" without moving anything. Swipe axis and layout are untouched.
  2. **Toggle on**: full landscape layout. Buttons re-anchor to the new physical bottom edge,
     the photo itself rotates to display large edge-to-edge, and swipe gestures still read as
     screen-relative left/right (so the gesture feel never changes, only the chrome around it).
     A landscape-oriented _source photo_ (already known from `photos.orientation` at upload
     time, Section 2) should already display large without needing device rotation at all —
     device-rotation mode is really for **portrait photos viewed with the phone held
     sideways**, not for making landscape photos bigger.
- [x] Toggle placement: exposed from the swipe deck's own settings (not buried in `/profile`)
      since it's a per-session viewing preference, not an account setting — persist it in
      `localStorage` so it survives a reload but isn't tied to the account.
- [ ] Test matrix (the actual acceptance criteria, not optional polish):
  - OS rotation lock ON, physically rotate the phone, toggle OFF → zero UI change.
  - OS rotation lock ON, physically rotate the phone, toggle ON → zero UI change (device never
    reports a change, so neither behavior should fire — this is the case most likely to be
    gotten wrong by a naive `deviceorientation`-based implementation, which is exactly why that
    API was ruled out above).
  - OS rotation lock OFF, physically rotate, toggle OFF → button glyphs rotate, nothing else.
  - OS rotation lock OFF, physically rotate, toggle ON → full landscape layout as described.
  - Run this on both an iPhone and an Android — `screen.orientation` support/quirks differ
    enough between them (particularly older iOS Safari, hence the `matchMedia` fallback) that
    "works on one" isn't sufficient signal.

### 3.4 Near-duplicate resolution (burst shots, "20x the same photo")

Plain swiping is a bad UX for 20 near-identical shots — every one of them _feels_ like a
"keep", so you end up keeping most of the burst by accident. Instead, pre-resolve clusters
before they ever reach the swipe deck.

- [x] **Clustering**: `perceptualHash` (dHash, already computed on upload in `storage.ts`) +
      `hammingDistance()` (already in `utils.ts`) group photos within `DUPLICATE_HAMMING_THRESHOLD`
      (8) into a `duplicateGroupId`. Run this synchronously right after `storeUpload()` inside
      the upload endpoint (Section 2), comparing the new photo's hash against existing
      **unresolved-cluster** hashes in the album only (resolved singles don't need
      re-comparison) — cheap enough at album scale (hundreds, not millions, of photos) to not
      need a background job/queue for the MVP.
  - Union-find (not naive pairwise grouping) if a new photo matches two previously-separate
    clusters — merge them rather than leaving the photo ambiguously attached to one.
- [x] **Bracket data structure**: a cluster of N unresolved photos becomes a single-elimination
      bracket. Model it as a plain array-based binary tree computed client-side from the
      cluster's photo list (no new DB table needed — the bracket's _current_ state is fully
      derivable from which photos in the cluster still have `duplicateResolved: false`, so a
      page reload mid-bracket just recomputes the same bracket from remaining candidates): - Odd cluster size → one random bye per round (advances automatically, no comparison
      needed) — standard tournament-bracket handling, not a special case to hand-roll. - Round order given to the user: pair adjacent items in upload order for round 1 (burst
      shots are usually already adjacent in upload order, so this naturally pits genuinely
      similar-looking pairs against each other first) — random pairing for hypothetical
      future rounds isn't necessary since brackets here are shallow (log2(20) ≈ 5 rounds max
      for a big burst).
- [x] **Resolution UI** (`DuplicateBracket.svelte`, 3.1): split-screen, two photos side by
      side, a draggable divider the user drags toward the photo they want to discard (drag
      left → left photo loses). Tap-to-pick on either half also works as a fallback/
      accessibility path — the divider drag shouldn't be the _only_ way to resolve a pair.
  - Winner advances (held client-side until the bracket for this cluster completes); loser is
    marked `delete` immediately via the same decisions-write path as a normal swipe (revisable
    later like any other decision — nothing here is more "final" than a normal swipe).
  - When one photo remains in the cluster, it gets `duplicateResolved: true` and flows into
    the normal swipe deck's queue alongside singleton photos — the bracket doesn't
    auto-decide the survivor's fate, it just removes the "which of these 20" problem before
    the real keep/delete/favorite judgment call.
  - Progress indicator across the whole multi-cluster resolution phase ("Round 2 of 3 · burst
    4 of 7"), since an album can have several independent bursts to get through before the
    deck itself even opens.
- [x] **Design language**: the divider line in this split-screen is a **gentle S-curve**
      (a yin-yang-style sigmoid via an SVG `<path>` or `clip-path: path(...)`), not a straight
      vertical line — see Design language below. The curve's midpoint follows the drag
      position; the S-shape itself stays proportionally consistent as it's dragged rather than
      degenerating into a straight line at the extremes (i.e. the control points scale with
      the drag offset, not just the anchor points).

### 3.5 Favorite: the third gesture

Favorite isn't "keep, but more" — it needs to be reachable without accidentally triggering
delete or keep, which rules out putting it on the same left/right axis.

- [x] Gesture: drag **up**, toward a heart icon fixed at top-center of the card (the "tap
      heart in the middle" from the original brief, generalized into a drag target rather than
      a static tap zone — dragging _toward_ a visible target reads more clearly on a live card
      than a tap that has no motion feedback). The heart icon scales/glows as the card
      approaches it, giving continuous feedback before release, same as the left/right
      swipe-dismiss's own approach-feedback (card rotation, opacity change).
  - A quick tap directly on the heart icon (no drag) also favorites — accessibility/fallback
    path, same reasoning as duplicate-bracket's tap-to-pick fallback in 3.4.
- [x] Direction lock (3.1.1) already prevents a horizontal swipe from being misread as
      favorite and vice versa — no additional disambiguation logic needed beyond what the
      gesture state machine already does; favorite is just a third exit direction on the same
      state machine, not a separate mode.
- [x] Favoriting **keeps** the photo too — `status: 'favorite'` is a distinct enum value
      (already modeled in `DecisionStatus`), not `keep` + a separate boolean, so the review
      grid (Section 4) can filter/group by it directly without a compound condition.
- [x] Exit animation: card shrinks/flies toward the heart rather than off-screen left/right —
      visually distinct from a delete/keep dismissal so the three outcomes never look the same
      out of the corner of your eye.

### 3.6 In-deck undo

Swiping is fast and occasionally a misfire (wrong direction, finger slipped) — a full trip to
`/albums/[id]/review` to fix one accidental delete breaks flow. This is a _session-scoped
convenience_ on top of the already-fully-revisable `decisions` table, not new persistence.

- [x] Small persistent "undo" affordance (bottom corner, always visible while `history` is
      non-empty) rather than a shake gesture — shake-to-undo is easy to trigger by accident
      while just handling the phone during a swipe session, which is exactly the failure mode
      undo exists to fix; don't introduce a new one.
- [x] Undo pops the last `history` entry, re-inserts that photo at `queue[0]` (not back into
      its original position — you want to immediately re-decide the photo you just undid, not
      lose it back into the shuffle), and writes the reverted status via the same batched
      decisions endpoint (3.0).
- [x] Multiple sequential undos walk back through `history` — no arbitrary "undo once only"
      limitation, bounded only by the 20-entry history cap already noted in 3.0.
- [x] Undo button shows a one-line reminder of what it'll undo ("Undo: deleted IMG_042.jpg")
      rather than a bare icon — cheap to build (the data's already in `history`) and removes
      any hesitation about tapping it.

### 3.7 Progress, empty, and end states

A deck of unknown length with no feedback feels aimless; a deck that's actually empty
(nothing left to decide) needs to say so rather than rendering nothing.

- [x] Progress indicator (`{decided} / {total}` for this session, plus a thin progress bar) —
      pull `total` from the same `load` query that hydrates the queue (3.0), decrement as
      `queue` shrinks. Keep it unobtrusive (small, top-of-screen) — the photo is the point, the
      counter is orientation, not the main event.
- [x] Zero-photos-to-decide on deck open (either a brand new album with nothing uploaded yet,
      or everything's already been decided): don't show an empty deck frame — route straight
      to a dedicated "nothing to swipe" state with a link to upload (Section 2, if contributor)
      or review (Section 4).
- [x] End-of-deck (queue empties out during the session, per 3.0): session summary + links,
      not an abrupt return to the album page.
- [x] Mid-session "someone else just added photos" isn't handled by a live update in the MVP —
      the queue is a snapshot from `load` time. Acceptable for now (documented here explicitly
      so it isn't mistaken for an oversight): re-opening the swipe deck re-queries and picks
      up anything new. Live-updating an in-progress queue is out of scope until Section 5's
      `live` resolve mode needs the same SSE infrastructure anyway — build it once, there.

### 3.8 Accessibility & keyboard fallback

Gestures are the primary interaction, but nothing here should be gesture-_only_ — both for
genuine accessibility and because it makes desktop testing during development far less
painful than simulating touch for every check.

- [x] Keyboard bindings while the deck is focused: `←` delete, `→` keep, `↑` favorite, `⌘/Ctrl
  - Z`undo (3.6) — routed through the exact same decision path gestures use (per 3.1's`SwipeButtons` note: one code path for "how a decision gets made", multiple ways to
    trigger it).
- [x] `SwipeButtons` (the on-screen delete/favorite/keep buttons) are the primary accessible
      path — real `<button>` elements with `aria-label`s, not gesture-only affordances, and
      already required by the original brief's "buttons rotate like a camera app" behavior
      (3.3), so no extra work, just don't let it regress once gestures are built on top.
- [x] Each card's `<img>` gets `alt={photo.displayName}` — meaningful since album photos often
      do have descriptive names (Section 2's whole name-conflict UI exists because people name
      their photos), not decorative filler alt text.
- [x] Respect `prefers-reduced-motion`: card fly-out/spring-back/rotation animations (3.1.1,
      3.1.2, 3.5) drop to a simple opacity cross-fade — the swipe deck's _interaction model_
      doesn't change (still tap/keyboard-drivable), only the motion styling does.

### 3.9 Performance targets & device test matrix

Concrete, falsifiable targets — "feels fast" isn't testable, these are:

- [ ] Card-to-card advance (decision made → next card fully interactive) under 100ms on a
      mid-range Android when the next preview is already prefetched (3.2) — this is the number
      that actually determines whether the deck "feels instant."
  - When the next preview is _not_ yet prefetched (cold start, or prefetch fell behind on a
    bad connection): show the blur-up thumbnail placeholder (3.2) immediately, never a blank
    frame, while the preview finishes loading.
- [ ] Gesture-to-visual-feedback (finger moves → card visibly tracks it) must be same-frame —
      no debounce/throttle on the drag handler itself (only the eventual decision write is
      batched, per 3.0 — the visual response is never delayed for network reasons).
- [ ] Test matrix, minimum before calling this section done:
  - Real mid-range Android + real iPhone (not just devtools device emulation, which doesn't
    reproduce touch-event timing quirks or genuine memory pressure).
  - Wifi and throttled mobile data (devtools network throttling is fine for _this_ axis, since
    it's the gesture-and-render latency that needs a real device, not the network latency).
  - A large album (150-200+ photos, some containing multiple burst clusters) to catch memory
    growth from an unbounded prefetch cache or an unbounded `history` array (already capped at
    20 in 3.0, but verify the cap is actually enforced under load, not just documented).
  - Orientation matrix from 3.3 run on both platforms.

Implemented end-to-end: clustering (`clusterOnUpload`, union-find-by-canonical-id) wired into
the upload endpoint; `swipeDeck.svelte.ts` (optimistic queue/history/batched writes),
`prefetchQueue.ts`, `orientation.svelte.ts`, `SwipeCard.svelte` (gesture state machine via
`@use-gesture/vanilla`, transform-origin-based pinch anchoring, swipe/favorite/zoom-pan),
`SwipeButtons.svelte`, `DuplicateBracket.svelte` (bracket derivation, S-curve divider,
tap-to-pick fallback), and `/albums/[id]/swipe` tying it together with progress/empty/end
states, in-deck undo, and keyboard bindings. `POST /albums/[id]/decisions` (batch upsert) and
`POST /albums/[id]/duplicates/resolve` (flip a photo out of its pending cluster - called for
both the bracket survivor and, per photo, each eliminated loser) are live.

Verified via `bun run check`/`bun x eslint .` (both clean) and live end-to-end testing against
a running dev server: uploaded a 3-photo burst plus 2 unique photos, confirmed clustering
grouped them correctly (`duplicate_group_id`, `perceptual_hash` in the DB), drove a full
bracket resolution via the API (losers + survivor), confirmed losers are marked
`duplicateResolved: true` immediately on elimination (an early bug where losers stayed
perpetually "pending" was caught this way and fixed), and confirmed the swipe deck's own
decisions endpoint and empty/end-of-queue states respond correctly. **Not yet verified**: real
gesture interaction (pinch/pan/swipe feel, direction-lock correctness) and the 3.3/3.9 device
test matrices - those need an actual phone in hand, not curl.

---

## 4. Decisions, undo, and the review list

- [ ] Swipe writes/updates the `decisions` row for `(photoId, currentUser)` — upsert, not
      insert, so re-deciding a photo is just a normal update. The swipe deck's own optimistic
      batched-write path (3.0) and in-deck undo (3.6) are both just callers of this same
      upsert — this section is about the persistent semantics, not a separate mechanism.
- [ ] `/albums/[id]/review` — a grid/list view of all photos grouped by current decision
      (deleted / kept / favorited / undecided), with tap-to-flip so any prior decision (including
      duplicate-bracket losers) can be changed after the fact. This is the durable, cross-session
      undo — 3.6's in-deck undo is a same-session convenience layered on top of it, not a
      replacement for it.

---

## 5. Sharing & permissions

- [ ] Invite flow: share album by email (creates `album_shares` row) or shareable link
- [ ] Roles: `contributor` (can add photos) vs `viewer` (can only decide)
- [ ] Album management: owner can delete an album (cascades `photos`/`decisions`/etc. via FK
      `onDelete: cascade` — already modeled in the schema; still needs the disk files under
      `storage/` cleaned up, since those aren't tracked by the DB's cascade) and revoke a
      specific share (deletes the `album_shares` row; that user's existing `decisions` rows are
      left alone so access can be re-granted later without losing their prior swipes)
- [ ] `decisionMode: independent` — each sharer has their own `decisions` rows, no
      coordination; a later "merge view" can show where two people agree, but this needs no
      new mechanism, it's a read-only diff query over the existing table.
- [ ] `decisionMode: together`, two `resolveMode`s:
  - **`swipe-all-then-resolve`** (build this one first — no realtime infra needed): both
    people swipe the whole album independently, then a conflict screen shows only the photos
    where their `decisions.status` differs, for a final joint call
  - **`live`** (Phase 2+): as soon as person A swipes a photo, it's removed from person B's
    live queue via Server-Sent Events (SSE is enough here — one-directional server→client
    push, no need for full WebSockets/a realtime service)

---

## 6. Downloads

- [ ] `/albums/[id]/download` — build ZIP of all `keep`/`favorite` originals for the current
      user, stream it (don't pre-build and store the whole thing) using e.g. `archiver` or
      `fflate`, write progress to `download_batches`
- [ ] On completion, mark `photo_downloads` for each included photo × user
- [ ] Download page shows a per-photo badge: already downloaded / newly added since last
      download / not yet decided

---

## Design language: yin-yang motifs, used sparingly

The core interaction (binary keep-or-delete decision) is already a yin-yang metaphor, so a few
deliberate visual nods reinforce it without turning the UI kitschy:

- [ ] The duplicate-resolution split-screen divider (3.4) is a curved S-line, not straight —
      literally the yin-yang boundary shape. Implement as an SVG path or `clip-path`, draggable
      by updating the curve's control point instead of a straight `translateX`.
- [ ] Consider echoing the same curve as a subtle background element behind the swipe deck's
      keep/delete zone indicators (e.g. two soft curved regions instead of a hard left/right
      split when the user starts a drag) — evaluate once the swipe deck exists, don't
      over-invest here before the core mechanic is proven.
- [ ] Keep it to these two spots for the MVP. Don't reach for yin-yang imagery in navigation
      chrome, icons, or the logo yet — that's a branding decision to make once the app has a
      shape, not before.

---

## Explicitly out of scope for the MVP

Listed so gaps read as deliberate deferrals, not oversights:

- **Video support** — photos only, as scoped from the start
- **Storage garbage collection** — deleting an album/photo removes DB rows (cascades) but not
  the on-disk file yet (see 5. Album management); a periodic "sweep files with no matching DB
  row" job is a reasonable later addition once real usage shows it's needed
- **Automated tests** — no vitest/playwright setup yet. Worth adding once the swipe-deck
  gesture logic (3.1) stabilizes, since that's the part most likely to regress silently
- **Production process management** (PM2 config, systemd unit, reverse-proxy config) — sibling
  projects use `pm2.config.cjs`; add the equivalent once there's an actual deploy target
- **Admin/moderation tooling** — not needed at family-and-friends scale; revisit only if that
  changes
- **Accessibility pass** (screen reader support for the swipe deck, reduced-motion mode) — a
  real gap for a gesture-heavy UI, but deliberately deferred past MVP given the target audience

---

## Suggested build order

1. Auth (`/login`, `/login/verify`, logout) — small, unblocks everything behind a login wall
2. Albums CRUD + upload (incl. hashing/dedup/name-conflict UI)
3. Swipe deck v1: gesture state machine + zoom, on preview images, **no** prefetching or
   duplicate-resolution yet — get the core feel right on a real phone first
4. Lazy-load/prefetch layer (3.2) — retrofit onto the working swipe deck
5. Orientation handling (3.3)
6. Review/undo list (4)
7. Duplicate-cluster resolution screen (3.4)
8. Sharing: independent mode first, then swipe-all-then-resolve, then live (5)
9. Downloads (6)
