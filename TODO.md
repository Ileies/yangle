# Yangle: open work

Everything that is built is documented in `README.md` (features, design, data model). This file
only tracks what is still open, plus deliberate deferrals so gaps read as decisions, not
oversights. See `CLAUDE.md` for operational gotchas when working in this repo.

## Open: verification

- [ ] **Bun.Image migration checks**: duplicate grouping across colour profiles, portrait
      orientation, preview/thumbnail generation, and compatibility (JPEG) downloads. General
      Bun.Image functionality has been tested by the user, these targeted cases have not.
- [ ] **HEIC decode performance** on a supported macOS/Windows host under real upload volume.
- [ ] **Swipe deck on real devices** (a mid-range Android and an iPhone; devtools emulation does not
      reproduce touch timing quirks or memory pressure). Only API-level behavior has been verified
      so far, never real gesture feel (pinch/pan/swipe, direction lock).
  - Orientation matrix, on both platforms:
    - OS rotation lock ON, rotate, landscape toggle OFF: zero UI change.
    - OS rotation lock ON, rotate, landscape toggle ON: zero UI change (the case a naive
      `deviceorientation` implementation gets wrong).
    - OS rotation lock OFF, rotate, toggle OFF: only button glyphs rotate.
    - OS rotation lock OFF, rotate, toggle ON: full landscape layout.
  - Performance targets:
    - Card-to-card advance under 100ms on a mid-range Android when the next preview is prefetched
      (otherwise the blur-up thumbnail shows immediately, never a blank frame).
    - Gesture-to-visual feedback is same-frame (no debounce/throttle on the drag handler).
  - Test conditions: wifi and throttled mobile data; a large album (150-200+ photos, several
    burst clusters) to confirm the prefetch cache and the 20-entry `history` cap do not grow
    unbounded under load.
  - Tune `SWIPE_DISMISS_PX`, `SWIPE_DISMISS_VELOCITY`, `ZOOM_MIN_SCALE` and `ZOOM_MAX_SCALE` in
    `constants.ts`: still placeholder values.

## Open: features and platform gaps

- [ ] **HEIC/HEIF and AVIF uploads on Linux**: restore once Bun ships a suitable codec (currently
      macOS/Windows only; Linux gives a per-file error asking for JPEG/PNG).
- [ ] **`live` resolve mode** for `together`-mode albums (Phase 2+): when person A swipes a photo
      it leaves person B's queue via Server-Sent Events (one-directional push is enough, no
      WebSockets). The same SSE infrastructure would also enable live-updating an in-progress
      swipe queue when someone else adds photos (the queue is currently a load-time snapshot), so
      build it once for both.
- [ ] **CDN/reverse-proxy cache** in front of the origin (e.g. Cloudflare free tier): the biggest
      lever for the Germany-to-China latency problem. Infra decision, outside this repo.
- [ ] **Design language** (optional, low priority): echo the yin-yang curve as soft curved
      regions behind the swipe deck's keep/delete zone indicators instead of a hard left/right
      split. Only if cheap once real-device testing is done. Keep yin-yang imagery out of
      navigation, icons and the logo until the app has a branding direction.

## Ideas, not asked for

- Read-only "merge view" for `independent` albums showing where participants agree (a diff query
  over `decisions`, no new mechanism).
- Before/after comparison in the review list beyond the current badge/filter view.

## Deliberately out of scope for the MVP

- **Video support**: photos only.
- **Storage garbage collection**: deleting an album/photo already removes DB rows and on-disk
  files. A periodic "sweep files with no matching DB row" job is a possible backstop once real
  usage shows it is needed.
- **Route, database and browser tests**: `bun test` only covers pure logic (burst similarity,
  duplicate pairing, byte ranges, etc.). Add playwright or similar once the swipe-deck gesture
  logic stabilizes, since it is the most likely part to regress silently.
- **Production process management**: the deploy script assumes an existing systemd service
  `yangle`; add process and reverse-proxy configuration once those settings are settled.
- **Admin/moderation tooling**: not needed at family-and-friends scale.
- **Accessibility pass** beyond what is built (keyboard, labelled buttons, reduced motion): proper
  screen reader support for the swipe deck is a real gap for a gesture-heavy UI, deferred past
  the MVP given the target audience.
