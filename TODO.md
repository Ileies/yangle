# Yangle — TODO / Project Plan

See `README.md` for what this app is, the stack, the data model, and setup — this file tracks
section-by-section build status, what's left, and the reasoning behind non-obvious decisions
(so gaps read as deliberate deferrals, not oversights). See `CLAUDE.md` for operational
gotchas when working in this repo.

Legend: `[x]` done, `[ ]` not started/not finished yet.

## Remaining work (quick scan)

- [ ] PWA manifest (§0)
- [ ] HEIC real-device decode-performance test, and a download UI that distinguishes
      "original (HEIC)" vs. "compatible (JPEG)" instead of silently picking one (§2)
- [ ] Swipe deck: real-device orientation test matrix (§3.3) and performance targets + full
      device test matrix (§3.9) — both need actual phones, not curl/devtools
- [ ] Sharing: `live` resolveMode for `together`-mode albums — Phase 2+, needs SSE infra (§5)
- [ ] Design language: evaluate echoing the yin-yang curve behind the swipe deck's own
      keep/delete zone indicators (optional, low priority)

Everything else below is done and verified live against a running dev server (not just
type-checked/linted — see each section's "verified"/"implementation notes" for specifics).

---

## 0. Foundation / scaffold

- [x] SvelteKit 2 + Svelte 5 (runes) + Bun, Tailwind 4 + DaisyUI 5, Drizzle/SQLite,
      `@sveltejs/adapter-node`, Nix dev shell, type-check/lint/format all clean
- [ ] PWA manifest (`static/manifest.webmanifest` + icons + `<link rel="manifest">` in
      `app.html`) — cheap to add and buys the "installed app" feel (home-screen icon, no
      browser chrome) that matters a lot for a swipe-heavy full-screen mobile UI. Not full
      offline support (there's nothing meaningful to do offline here, the app is inherently
      server-backed) — just the installability/manifest layer.

---

## 1. Auth (passwordless, magic link)

- [x] Schema (`magic_links`, `sessions`) + server helpers (`createMagicLink`,
      `consumeMagicLink`, `createSession`, `getSessionUser`, `destroySession`)
- [x] `hooks.server.ts` populates `event.locals.user` from the session cookie
- [x] `mail.ts` (nodemailer; logs the link to console when SMTP isn't configured — convenient
      for local dev, no mail server needed)
- [x] `/login` page: email input → `createMagicLink` + `sendMagicLinkEmail`. Redirects to `/`
      if already signed in; shows a "check your email" state after sending; surfaces
      `?error=missing|invalid` from the verify route as a message above the form. Also accepts
      a `redirectTo` query param (validated same-origin-path-only) so e.g. `/invite/[token]`
      can send an unauthenticated visitor to sign in and land right back where they started.
- [x] `/login/verify?token=...` route (`+server.ts` GET handler): `consumeMagicLink` → sets the
      `session` cookie (httpOnly, `sameSite: lax`, `secure` outside dev) → redirects to `/`.
      Bad/missing/reused token → redirects back to `/login?error=...` instead of erroring.
- [x] Logout action — `POST /logout` (`+server.ts`): destroys the current session, clears the
      cookie, redirects to `/login`
- [x] Rate-limit magic-link requests per email — `magic_links.createdAt` +
      `MAGIC_LINK_RESEND_COOLDOWN_MS` (1 min) check in `createMagicLink()`; returns `null` when
      a request is already in flight, which the `/login` action turns into a 429 with a
      "please wait a minute" message instead of silently resending
- [x] `/profile` — edit display name (form action, persists via `updateDisplayName()`), lists
      albums owned + albums shared with you, "log out everywhere" (`destroyAllSessions()` —
      deletes every `sessions` row for the email, not just the current cookie)

Verified end-to-end against the dev server (curl): resend cooldown returns 429 on the 2nd
request within a minute, verify token is one-time-use (reused token → redirect with
`error=invalid`), display name change persists across requests, "log out everywhere" invalidates
the session immediately.

---

## 2. Albums & upload

- [x] **HEIC/HEIF input support**: most contributors will be uploading straight from an
      iPhone, which shoots HEIC by default — and no browser can render HEIC in an `<img>` tag.
      `sharp` already links against `libheif` (confirmed via `sharp.versions` on this machine),
      so `storeUpload()` decodes it without extra setup; thumbnail/preview are always
      re-encoded to WebP already, so those were unaffected either way. For the **original**
      file (kept byte-for-byte for ZIP download, since an Apple recipient wants the real
      HEIC): `storeUpload()` also writes a JPEG compatibility rendition (`compatOriginalPath`,
      quality 92) through the same sharp/libvips pipeline whenever the source format is
      HEIC/HEIF/AVIF, so a Windows/Android recipient has something they can open without the
      sender needing to know or care. Deliberately **not** ffmpeg: most prebuilt ffmpeg
      binaries aren't compiled with `libheif` support at all (HEVC licensing), so it's both a
      second native dependency to fight NixOS/FHS issues for and a _less_ reliable HEIC path
      than the sharp/libvips pipeline already in use. Sharp also carries over the embedded ICC
      profile (iPhones shoot Display P3) when converting to JPEG, avoiding washed-out colors.
  - [ ] Still needs a real-device test: confirm `sharp`'s HEIC decode performs acceptably
        (it's slower than JPEG) under real upload volume, not just a one-off test image
  - [ ] Download UI (§6) should distinguish "original (HEIC)" vs. "compatible (JPEG)" when
        `compatOriginalPath` is set, rather than silently picking one — the ZIP download
        currently always ships the true original
- [x] **`/` (homepage)**: no real landing page for the MVP — `+page.server.ts` just redirects
      straight to `/albums` (logged in) or `/login` (logged out).
- [x] **`/albums`** — list albums the user owns or is shared on (`listAlbumsFor()` in
      `server/albums.ts`, shared with `/profile`).
- [x] **`/albums/new`** — create album (name only; decision mode defaults to `independent` and
      is changed later from album settings, §5)
- [x] **Upload flow (`/albums/[id]/upload`)**: client hashes each file (`sha256Hex()`, shared
      between client and server so both compute the same hash) **before** upload, POSTs the
      hash list to `/upload/check`, and only sends bytes for files that endpoint doesn't
      already know about. Server `storeUpload()` writes original + WebP preview + WebP
      thumbnail, computes content hash (exact dedup) and dHash (near-duplicate clustering, §3.4).
      **Name-conflict UI**: if `/upload/check` reports a content hash already in the album under
      a different file name, the page prompts to pick which name to keep — resolving POSTs to
      `/upload/resolve`, which updates `photos.displayName` and records the name not kept in
      `photo_name_variants`.
- [x] **Contributor permission check**: `canContribute(getAlbumRole(...))` enforced in both
      upload endpoints and reused by the album page to decide whether to show "Upload" at all.
- [x] **Photo serving (`/photos/[id]/[size]`)**: auth-gated file streaming (thumbnail/preview/
      original/compat) that checks album membership per request, since files live outside
      `static/` on purpose. `Cache-Control: private, max-age=31536000, immutable` since a given
      content hash's bytes never change.

Verified end-to-end: album creation; upload of two images; thumbnail grid rendering;
re-uploading the same bytes under a new name correctly surfaced as a conflict (not a silent
duplicate) and resolving it updated `displayName` while preserving the old name in
`photo_name_variants`; a second, unrelated user got `404` on the album page, `403` on both the
thumbnail endpoint and the upload endpoint.

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
      `duplicateResolved === false` in a pending cluster (those go through §3.4 first) and not
      yet decided by the current user, ordered by `uploadedAt`. Ships down a lean payload
      (`DeckPhoto` in `types.ts`) — never the DB row shape verbatim.
- [x] `src/lib/swipeDeck.svelte.ts` — session-scoped state: `queue` (remaining, in order, with
      `queue[0]` always the current card — swiped cards are spliced out, not hidden), `history`
      (bounded 20-entry undo stack, §3.6).
- [x] A decision is optimistic: splice the card out of `queue`, push to `history`, animate the
      exit, **then** fire `POST /albums/[id]/decisions` (fire-and-forget with retry-on-failure,
      not awaited before advancing). A failure after retries surfaces a small non-blocking toast
      rather than rolling the card back into the deck.
- [x] `POST /albums/[id]/decisions` accepts a **batch** (`{ photoId, status }[]`) — the client
      coalesces rapid swipes (every ~400ms or every 5 decisions, whichever first) into one
      request, so a China-latency round trip per swipe doesn't make the deck feel laggy.
- [x] End-of-deck state: once `queue.length === 0`, show a summary (N kept, N favorited, N
      deleted this session) with links to `/albums/[id]/review` and `/albums/[id]`.
- [x] Resume behavior: since `load` already filters to undecided photos, closing the tab
      mid-deck and reopening naturally resumes where you left off — no separate "session"
      concept needed server-side.

### 3.1 Component/file structure

- [x] `src/routes/albums/[id]/swipe/+page.svelte` — thin: owns the `swipeDeck` state instance,
      renders `<SwipeCard>` for `queue[0]` (+ 1-2 upcoming stacked behind it for depth, §3.2),
      the button bar, and the progress indicator
- [x] `src/lib/components/SwipeCard.svelte` — one photo: image element, gesture bindings
      (§3.1.1), zoom/pan transform (§3.1.2), decision-swipe exit animation
- [x] `src/lib/components/SwipeButtons.svelte` — delete / favorite(center) / keep, rotates
      per §3.3, dispatches the same decision path as a gesture so keyboard/tap and swipe are
      one code path, not two
- [x] `src/lib/components/DuplicateBracket.svelte` — §3.4, mounted instead of the deck when the
      album has unresolved clusters; hands off to the normal deck on completion
- [x] `src/lib/prefetchQueue.ts` — the sequencing logic from §3.2, decoupled from any component
      so it's independently testable

### 3.1.1 Gesture handling: never confuse zoom and swipe

- [x] Use a gesture library rather than hand-rolling touch math — `@use-gesture/vanilla`
      behind a thin Svelte action (`use:gesture`): framework-agnostic, no React coupling to
      strip out, its pointer-event unification already handles the mouse/touch/pen distinction
      correctly (useful for desktop testing too, even though desktop isn't a target platform).
- [x] Explicit state machine (`type GestureMode = 'idle' | 'swiping' | 'panning' | 'pinching'`
      plus current scale — not ad-hoc booleans), transitions:
  - `idle`, `scale === 1`, one-finger drag starts → `swiping`. Horizontal component dominant =
    delete/keep candidate; vertical-up component dominant = favorite candidate (§3.5).
    Direction is locked in on gesture start based on the first ~10px of movement, not
    re-evaluated mid-drag.
  - `idle`, `scale > 1`, one-finger drag starts → `panning`, moves the image within its zoomed
    bounds (clamped, §3.1.2). Swipe-dismiss does **not** re-arm until `scale` returns to
    exactly `1` — the crux of "never confuse zoom and swipe": mode is gated on scale, not on
    gesture heuristics.
  - Two-finger touch, any state → `pinching`, always wins over whatever single-finger mode was
    active (matches iOS Photos: a mid-swipe drag that gains a second finger cancels the swipe).
  - `pinching` end → back to `idle` at whatever scale the pinch left off at.
- [x] Double-tap = quick zoom to ~2.5x centered on the tap point; double-tap again while zoomed
      = zoom out to exactly 1x with the same spring-back animation as the pinch-released-past-
      bounds case (§3.1.2), so there aren't two different "return to 1x" motions.
- [x] `SWIPE_DISMISS_PX`/`SWIPE_DISMISS_VELOCITY`/`ZOOM_MIN_SCALE`/`ZOOM_MAX_SCALE` in
      `constants.ts` — still placeholder-tuned values, need validation against real devices
      (the velocity threshold needs a flick-vs-drag distinction: standard "OR" gate,
      `distance > PX || velocity > VELOCITY`).
- [x] Card rotates slightly (proportional to horizontal drag distance, clamped) while being
      dragged — the one bit of "juice" that makes this feel like a swipe deck, not a slideshow.

### 3.1.2 Zoom & pan mechanics

- [x] Transform model: `{ scale, translateX, translateY }` applied as a single
      `transform: translate3d(...) scale(...)` on the image element (one transform,
      `will-change: transform`, GPU layer) — never animate `width`/`height`/`top`/`left`.
- [x] Pinch anchors on the midpoint between the two touch points; on update, recompute
      `translateX/Y` so the point under the fingers stays under the fingers.
- [x] Pan is clamped to the image's actual bounds at the current scale; rubber-banded past the
      edge during the gesture is allowed, springs back on release.
- [x] Scale clamped to `[ZOOM_MIN_SCALE, ZOOM_MAX_SCALE]` (currently 1–4) with the same
      rubber-band/spring-back treatment at both ends.
- [x] `touch-action: none` on the image element (not `pan-y`/`pan-x`) since the gesture library
      owns all touch interpretation — avoids the browser's native scroll/zoom fighting the
      custom gesture handling (a common "swipe feels janky on iOS specifically" bug source).

### 3.2 Lazy loading, thumbnails, and global latency

**The concrete problem:** the server is in Germany. A relative in China loading full-size
originals over a congested transpacific route will get a spinner, not a swipe deck.

- [x] **Three image sizes**: thumbnail (~320px, grids + duplicate-resolution screen), preview
      (~1600px, what the swipe deck actually displays and zooms into), original (only fetched
      at final ZIP download time). Cuts the swipe-deck payload by an order of magnitude vs.
      serving originals.
- [x] **Prefetch queue, not naive `<img loading="lazy">`** (`prefetchQueue.ts`): keeps
      `PREFETCH_AHEAD_COUNT` (4) preview images ahead of the current card warmed in cache.
      `await`s the focused card's `Image().decode()` first (guarantees paint-readiness before
      relying on it), only then kicks off `fetchPriority: 'low'` fetches for the next photos
      not already cached, capped at 2 concurrent — on a poor connection, 4 simultaneous requests
      each proceed slower than 2 queued.
- [x] **Aggressive HTTP caching**: `/photos/[id]/[size]` (§2) already responds
      `Cache-Control: private, max-age=31536000, immutable`; confirmed the deck's own
      `<img>`/`Image()` usage doesn't accidentally bust it (no cache-busting query params).
- [x] **Infra-level recommendation (not app code, flag for later)**: a CDN/reverse-proxy cache
      in front of the origin (e.g. Cloudflare free tier) — the single biggest lever for the
      China round-trip problem, but an infra decision outside this repo's scope.
- [x] Serve WebP with a DPR check before requesting so a 1x display doesn't download 3x pixels.
- [x] Skeleton/blur-up placeholder: reuse the already-fetched thumbnail, scaled up and blurred
      via CSS `filter: blur(...)`, cross-fading to the sharp preview on decode.
- [x] Explicit failure state per card: a preview that fails to load (timeout/network error)
      shows a retry affordance rather than a broken-image icon or a silently stalled deck.

### 3.3 Orientation: rotate only when the device genuinely did

The tricky requirement: distinguish "the phone is physically tilted" from "the OS actually
reports a new orientation" — because if the OS's rotation lock is on, tilting the phone should
change **nothing** in the UI.

- [x] Listen to `screen.orientation`'s `change` event (not `deviceorientation`/accelerometer
      data, and not a `matchMedia` poll) — it only fires when the layout viewport orientation
      _actually_ changes, which inherently respects OS-level rotation lock. Fallback for older
      iOS Safari: `matchMedia`'s `change` event, same "only fires on genuine layout change"
      property. Wrapped in `src/lib/orientation.svelte.ts` (single reactive `angle`/
      `isLandscape`).
- [x] **Two distinct behaviors**, gated by a user-facing toggle (`allowLandscapeRotation` in
      `state.svelte.ts`):
  1. **Toggle off (default)**: layout stays fixed/portrait; only the button _glyphs_ rotate 90°
     in place (camera-app style) on a confirmed orientation change.
  2. **Toggle on**: full landscape layout, buttons re-anchor to the new physical bottom edge,
     the photo rotates to display large edge-to-edge, gestures still read screen-relative.
- [x] Toggle placement: exposed from the swipe deck's own settings, persisted in `localStorage`
      (per-session viewing preference, not an account setting).
- [ ] **Test matrix** (real acceptance criteria, needs an actual iPhone and Android — support
      differs enough between them, particularly older iOS Safari, that "works on one" isn't
      sufficient signal):
  - OS rotation lock ON, physically rotate, toggle OFF → zero UI change.
  - OS rotation lock ON, physically rotate, toggle ON → zero UI change (device never reports a
    change — the case most likely to be gotten wrong by a naive `deviceorientation`-based
    implementation, exactly why that API was ruled out above).
  - OS rotation lock OFF, physically rotate, toggle OFF → button glyphs rotate, nothing else.
  - OS rotation lock OFF, physically rotate, toggle ON → full landscape layout.

### 3.4 Near-duplicate resolution (burst shots, "20x the same photo")

Plain swiping is a bad UX for 20 near-identical shots — every one _feels_ like a "keep", so you
end up keeping most of the burst by accident. Instead, pre-resolve clusters before they ever
reach the swipe deck.

- [x] **Clustering**: `perceptualHash` (dHash, computed on upload) + `hammingDistance()` group
      photos within `DUPLICATE_HAMMING_THRESHOLD` (8) into a `duplicateGroupId`. Runs
      synchronously right after `storeUpload()` inside the upload endpoint, comparing only
      against existing **unresolved-cluster** hashes in the album — cheap enough at album scale
      (hundreds, not millions, of photos) to not need a background job for the MVP. Union-find
      (not naive pairwise grouping) merges clusters when a new photo matches two previously-
      separate ones. Note: this is O(n) per uploaded photo against the unresolved set, so a
      single batch upload of N files does O(n²) work in N — fine at hundreds of photos/album,
      revisit (background job, or an indexed approximate-match structure) if albums start
      regularly growing past roughly a thousand unresolved photos.
- [x] **Bracket data structure**: a cluster of N unresolved photos becomes a single-elimination
      bracket, computed client-side from the cluster's photo list — no new DB table, the
      bracket's _current_ state is fully derivable from which photos still have
      `duplicateResolved: false`, so a page reload mid-bracket just recomputes the same bracket.
      Odd cluster size → one random bye per round. Round 1 pairs adjacent items in upload order
      (burst shots are usually already adjacent).
- [x] **Resolution UI** (`DuplicateBracket.svelte`): split-screen, a draggable divider dragged
      toward the photo to discard; tap-to-pick on either half also works as a fallback.
      Winner advances (held client-side until the bracket completes); loser is marked `delete`
      immediately via the same decisions-write path as a normal swipe (revisable later like any
      other decision). Last-photo-standing gets `duplicateResolved: true` and flows into the
      normal swipe deck queue. Progress indicator across the whole multi-cluster resolution
      phase ("Round 2 of 3 · burst 4 of 7").
- [x] **Design language**: the divider is a gentle S-curve (SVG `<path>`/`clip-path`), not
      straight — the curve's midpoint follows the drag position, control points scale with the
      drag offset rather than degenerating into a straight line at the extremes.

### 3.5 Favorite: the third gesture

Favorite isn't "keep, but more" — it needs to be reachable without accidentally triggering
delete or keep, which rules out putting it on the same left/right axis.

- [x] Gesture: drag **up** toward a heart icon fixed at top-center of the card, which
      scales/glows as the card approaches (same approach-feedback pattern as the left/right
      swipe-dismiss). A quick tap directly on the heart also favorites (accessibility/fallback,
      same reasoning as §3.4's tap-to-pick).
- [x] Direction lock (§3.1.1) already prevents horizontal/favorite misreads — favorite is just
      a third exit direction on the same state machine, not a separate mode.
- [x] Favoriting **keeps** the photo too — `status: 'favorite'` is a distinct enum value, not
      `keep` + a boolean, so the review grid (§4) can filter/group by it directly.
- [x] Exit animation: card shrinks/flies toward the heart, visually distinct from a
      delete/keep dismissal.

### 3.6 In-deck undo

A session-scoped convenience on top of the already-fully-revisable `decisions` table, not new
persistence.

- [x] Small persistent "undo" affordance (bottom corner, visible while `history` is non-empty)
      rather than a shake gesture — shake-to-undo is easy to trigger by accident while just
      handling the phone during a swipe session, exactly the failure mode undo exists to fix.
- [x] Undo pops the last `history` entry, re-inserts that photo at `queue[0]` (immediate
      re-decide, not back into its original position), writes the reverted status via the same
      batched decisions endpoint (§3.0).
- [x] Multiple sequential undos walk back through `history`, bounded only by the 20-entry cap.
- [x] Undo button shows a one-line reminder ("Undo: deleted IMG_042.jpg") rather than a bare
      icon.

### 3.7 Progress, empty, and end states

- [x] Progress indicator (`{decided} / {total}` for this session, thin progress bar) — `total`
      from the same `load` query that hydrates the queue, decrements as `queue` shrinks.
- [x] Zero-photos-to-decide on deck open routes straight to a dedicated "nothing to swipe"
      state with a link to upload (if contributor) or review, instead of an empty deck frame.
- [x] End-of-deck (queue empties during the session): session summary + links, not an abrupt
      return to the album page.
- [x] Mid-session "someone else just added photos" isn't handled by a live update in the MVP —
      the queue is a snapshot from `load` time. Documented explicitly so it isn't mistaken for
      an oversight: re-opening the swipe deck re-queries and picks up anything new.
      Live-updating an in-progress queue is out of scope until §5's `live` resolve mode needs
      the same SSE infrastructure anyway — build it once, there.

### 3.8 Accessibility & keyboard fallback

- [x] Keyboard bindings while the deck is focused: `←` delete, `→` keep, `↑` favorite,
      `⌘/Ctrl+Z` undo (§3.6) — routed through the exact same decision path gestures use.
- [x] `SwipeButtons` are the primary accessible path — real `<button>` elements with
      `aria-label`s, not gesture-only affordances.
- [x] Each card's `<img>` gets `alt={photo.displayName}` — meaningful since album photos often
      have descriptive names.
- [x] Respects `prefers-reduced-motion`: fly-out/spring-back/rotation animations drop to a
      simple opacity cross-fade — the interaction model doesn't change, only motion styling.

### 3.9 Performance targets & device test matrix

Concrete, falsifiable targets — "feels fast" isn't testable, these are:

- [ ] Card-to-card advance (decision made → next card fully interactive) under 100ms on a
      mid-range Android when the next preview is already prefetched (§3.2) — the number that
      actually determines whether the deck "feels instant." When the next preview is _not_ yet
      prefetched (cold start, or prefetch fell behind), show the blur-up thumbnail placeholder
      immediately, never a blank frame.
- [ ] Gesture-to-visual-feedback (finger moves → card visibly tracks it) must be same-frame —
      no debounce/throttle on the drag handler itself (only the eventual decision write is
      batched, per §3.0).
- [ ] Test matrix, minimum before calling this section done:
  - Real mid-range Android + real iPhone (not devtools device emulation — doesn't reproduce
    touch-event timing quirks or genuine memory pressure).
  - Wifi and throttled mobile data (devtools network throttling is fine for this axis, since
    it's gesture-and-render latency that needs a real device, not network latency).
  - A large album (150-200+ photos, some containing multiple burst clusters) to catch memory
    growth from an unbounded prefetch cache or an unbounded `history` array (capped at 20 in
    §3.0, but verify the cap is actually enforced under load, not just documented).
  - Orientation matrix from §3.3 run on both platforms.

Implemented end-to-end and verified via `bun run check`/`bun x eslint .` (both clean) and live
testing against a running dev server: uploaded a 3-photo burst plus 2 unique photos, confirmed
clustering grouped them correctly, drove a full bracket resolution via the API (losers +
survivor), confirmed losers are marked `duplicateResolved: true` immediately on elimination (an
early bug where losers stayed perpetually "pending" was caught this way and fixed), confirmed
the swipe deck's decisions endpoint and empty/end-of-queue states respond correctly. **Not yet
verified**: real gesture interaction (pinch/pan/swipe feel, direction-lock correctness) and the
§3.3/§3.9 device test matrices — those need an actual phone in hand, not curl.

---

## 4. Decisions, undo, and the review list

- [x] Swipe writes/updates the `decisions` row for `(photoId, currentUser)` — upsert, not
      insert. The swipe deck's optimistic batched-write path (§3.0) and in-deck undo (§3.6) are
      both just callers of this same upsert.
- [x] `/albums/[id]/review` — grid/list of all photos grouped by current decision (deleted /
      kept / favorited / undecided), tap-to-flip so any prior decision (including
      duplicate-bracket losers) can be changed after the fact. This is the durable,
      cross-session undo — §3.6's in-deck undo is a same-session convenience layered on top,
      not a replacement.

Verified live (album id 2, photos 25-29): loaded `/albums/2/review`, confirmed all 5 photos
render grouped correctly by their actual `decisions` rows, flipped a photo from `delete` to
`keep` through the page's own decision endpoint, confirmed the DB row updated, flipped it back.
Both the album page and the swipe deck's end-of-session screen link here. Not built: any visual
diff beyond the badge/filter view (e.g. before/after comparison) — not asked for by this
section's scope.

---

## 5. Sharing & permissions

- [x] Invite flow: share album by email (creates `album_shares` row) or shareable link
- [x] Roles: `contributor` (can add photos) vs `viewer` (can only decide)
- [x] Album management: owner can delete an album (cascades `photos`/`decisions`/etc. via FK
      `onDelete: cascade`, plus cleans up the on-disk files under `storage/`, which the DB
      cascade doesn't touch) and revoke a specific share (deletes the `album_shares` row; that
      user's existing `decisions` rows are left alone so access can be re-granted later without
      losing their prior swipes)
- [x] `decisionMode: independent` — each sharer has their own `decisions` rows, no
      coordination; a later "merge view" could show where two people agree, but needs no new
      mechanism, just a read-only diff query over the existing table (not built, not asked for).
- [x] `decisionMode: together`, `swipe-all-then-resolve` resolveMode: both people swipe the
      whole album independently, then a conflict screen (`/albums/[id]/resolve`) shows only the
      photos where `decisions.status` differs, for a final joint call.
- [ ] `live` resolveMode (Phase 2+): as soon as person A swipes a photo, it's removed from
      person B's live queue via Server-Sent Events (SSE is enough — one-directional
      server→client push, no need for full WebSockets/a realtime service).

Implementation notes:

- New `server/albums.ts` functions: `listShares`/`listParticipants`, `addOrUpdateShare`/
  `removeShare`, `setInviteLink`/`revokeInviteLink`/`getAlbumByInviteToken`/`acceptInvite`,
  `updateDecisionSettings`, `deleteAlbum`. New `server/conflicts.ts`: `listConflicts` (the
  swipe-all-then-resolve query — a photo qualifies only once every participant has a real,
  non-`Undecided` decision and they don't all agree). `decisions.ts` gained
  `applyDecisionToAll` for the joint-resolution write (one pick overwrites every participant's
  row for that photo, which is what makes it stop showing up as a conflict).
- Routes: `/albums/[id]/settings` (owner-only: shares list, email invite, shareable link,
  decision-mode radio, delete-album danger zone), `/invite/[token]` (accept flow),
  `/albums/[id]/resolve` (conflict screen for `together` mode). API endpoints split across
  `shares/`, `invite-link/`, `decision-mode/`, `delete/`, `resolve/apply/` — deliberately never
  co-located with a `+page.svelte` in the same directory (see the route-collision gotcha in
  `CLAUDE.md`).
- Login's `redirectTo` param round-trips through the `magic_links` row (added a `redirectTo`
  column) since the email-based flow has no other way to carry state across the async email
  round-trip.
- **Real bug found and fixed while wiring this up, not just this section's new routes**: SQLite
  foreign keys were never enforced (`PRAGMA foreign_keys` was `0`) — every `onDelete: cascade`
  in `schema.ts` was silently a no-op. Fixed in `db/index.ts` by opening the `bun:sqlite`
  connection explicitly and enabling the pragma. Verified via `PRAGMA foreign_key_check` (no
  existing violations) and by deleting a throwaway album with a share row and confirming both
  the album and the share row were gone afterward.
- **Second bug, also pre-existing (not introduced by this section) and also fixed**: the
  `+page.svelte`/`+server.ts` route-collision gotcha (see `CLAUDE.md`) had silently broken
  `/albums/[id]/upload` since §2, and would have broken this section's own `/invite/[token]`,
  `/albums/[id]/resolve`, and `/albums/[id]` itself. Fixed by giving every such endpoint its
  own subpath. Caught by testing actual `GET` requests against the running dev server, not by
  type-checking or lint — invisible to both.
- Verified live: share-by-email (including inviting an address that had never signed in before
  — needs a placeholder `users` row created first, handled in `addOrUpdateShare`), shareable
  link generation + accept, decision-mode switch to `together`, a real 3-way conflict (owner
  keep, one sharer delete, one sharer keep) showing up on `/resolve`, joint resolution
  overwriting all three participants' `decisions` rows and the conflict disappearing
  afterward, and album deletion cascading `album_shares` correctly.

---

## 6. Downloads

- [x] `/albums/[id]/download` — build ZIP of all `keep`/`favorite` originals for the current
      user, stream it (don't pre-build and store the whole thing), write progress to
      `download_batches`
- [x] On completion, mark `photo_downloads` for each included photo × user
- [x] Download page shows a per-photo badge: already downloaded / newly added since last
      download / not yet decided

Implementation notes:

- New `server/downloads.ts`: `listDownloadableFor` (per-photo badge for the page — deleted
  photos excluded entirely), `photosToDownload` (the actual ZIP contents — every
  kept/favorited photo; re-downloading is always allowed, "new" is just a badge not a filter),
  `recordDownloadBatch`/`completeDownloadBatch`/`failDownloadBatch`.
- Picked `fflate` over `archiver`: pure JS, no native binary, one less thing to fight the
  NixOS/FHS problem that already bit `sharp`/`better-sqlite3`.
- Routes: `/albums/[id]/download` (page — badge list + "Download ZIP (N)" link) and
  `/albums/[id]/download/zip` (`+server.ts`, kept off the page's own directory — same
  route-collision gotcha as §5). The zip endpoint streams: `fflate`'s `Zip` class emits
  compressed chunks via callback, piped straight into a `ReadableStream`, so the full archive
  is never buffered in memory. Each original is still read fully off disk one at a time before
  being added (not itself streamed), fine at this app's scale (hundreds, not thousands, of
  photos per album). The `download_batches` row is written `pending` before streaming starts
  and flipped to `ready` (with `photo_downloads` stamped) only after the whole archive has
  been generated — a client disconnect mid-stream leaves the batch `pending` rather than
  falsely marking photos downloaded.
- Duplicate display names within one ZIP (two different content hashes can legitimately share
  a file name, §2) get the photo id appended before the extension so the archive never
  silently overwrites one entry with another.
- Verified live (album id 2, 1 `keep` + 1 `favorite` + 3 `delete`d photos): download page
  listed exactly the 2 non-deleted photos as `new`; `/download/zip` returned a valid ZIP
  (`unzip -t` clean) containing exactly those 2 originals; `download_batches` went
  `pending` → `ready` with `readyAt` set, `photo_downloads` got one row per included photo;
  reloading the page then showed both as `downloaded`. Deleted photos never appeared anywhere
  in this flow.

---

## Design language: yin-yang motifs, used sparingly

The core interaction (binary keep-or-delete decision) is already a yin-yang metaphor, so a few
deliberate visual nods reinforce it without turning the UI kitschy:

- [x] The duplicate-resolution split-screen divider (§3.4) is a curved S-line, not straight —
      literally the yin-yang boundary shape.
- [ ] Consider echoing the same curve as a subtle background element behind the swipe deck's
      keep/delete zone indicators (e.g. two soft curved regions instead of a hard left/right
      split when the user starts a drag) — low priority, evaluate only if it's cheap once
      real-device testing (§3.9) is otherwise done.
- Deliberately kept to just these two spots for the MVP — no yin-yang imagery in navigation
  chrome, icons, or the logo; that's a branding decision for once the app has a shape, not
  before.

---

## Explicitly out of scope for the MVP

Listed so gaps read as deliberate deferrals, not oversights:

- **Video support** — photos only, as scoped from the start
- **Storage garbage collection** — deleting an album/photo removes DB rows (cascades) and,
  since §5/§6, the on-disk files for full album/photo deletion; a periodic "sweep files with no
  matching DB row" job as a defense-in-depth backstop is a reasonable later addition once real
  usage shows it's needed, not before
- **Automated tests** — no vitest/playwright setup yet. Worth adding once the swipe-deck
  gesture logic (§3.1) stabilizes, since that's the part most likely to regress silently
- **Production process management** (PM2 config, systemd unit, reverse-proxy config) — sibling
  projects use `pm2.config.cjs`; add the equivalent once there's an actual deploy target
- **Admin/moderation tooling** — not needed at family-and-friends scale; revisit only if that
  changes
- **Accessibility pass** (screen reader support for the swipe deck, reduced-motion mode beyond
  §3.8's `prefers-reduced-motion` handling) — a real gap for a gesture-heavy UI, but
  deliberately deferred past MVP given the target audience
