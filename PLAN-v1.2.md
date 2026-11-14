# v1.2.0 implementation plan — remote-navigation polish

**Goal.** Make the module feel like a native TV app on the pages the site already renders, without touching the site's own markup or proxying anything. Everything lands in `index.js` (single file, no deps) plus tests.

**Non-goals.** No built-in player, no custom UI chrome beyond a small HUD pill, no home-page injection, no proxy, no Turnstile workaround. No framework, no build step, no new runtime dependency.

**Baseline.** `master` at `6551e62` (v1.1.0). Functions live at `index.js:61-139` (`visible`, `candidates`, `inView`, `focusEl`, `focusDefault`, `move`, `activate`, `typing`), arrow/Enter/Back handler at `index.js:141`, media-key handler at `index.js:164`, watchdog at `index.js:190`, boot at `index.js:232`.

Verification harness already exists: mock site `/tmp/tvprobe/mock/server.js` (port 8822), `nav.js` (11/11), `realnav.js` (live 11-stop trail). Regressions = `nav.js` all pass and `realnav.js` still visits 11 stops.

---

## Step 0 — extend the harness first (tests must fail before code changes)

- `/tmp/tvprobe/mock/server.js` gains routes:
  - `/ragged` — header, one row of 5 posters, one row of 10 posters (ragged right edge), poster anchors 180x270 with nested 45x45 icon anchors.
  - `/dialog` — 9 cards + button `#open` that appends `<div role="dialog" aria-modal="true">` with 2 buttons and one `[aria-label="Close"]`; dialog is `position:fixed`, 60% viewport, `z-index:50`.
  - `/many` — 600 cards in 10 rows (perf budget).
  - `/play/m1-0` — `<video>` stub with `duration=100`, `paused` toggling, plus buttons that dispatch `waiting`/`playing` events.
- `/tmp/tvprobe/v12.js` — new test file, same shape as `nav.js` (installs `index.js` in a `page.addInitScript`, dispatches real `keydown` with `keyCode`).

**Verify:** `node v12.js` reports every new test failing against current `index.js` for the right reason (not a harness error).

## Step 1 — preferred-X memory (`index.js:96-128`)

- Module state `var prefX = null;` next to the other nav state.
- `focusEl(el, horizontal)` sets `prefX = centerX(el)` when `horizontal` is true.
- `move()` up/down scores against `prefX == null ? cx : prefX` instead of `cx`, keeping the current `|dx| * 2 - 30` weighting; left/right keeps `cx`.

**Verify:** on `/ragged`: right×3 from card 0, then down → focused card's center is within 24px of the remembered x; up returns to the original column; a short row that has no candidate near `prefX` still moves (nearest wins, no dead end).

## Step 2 — one layout snapshot per keypress + perf budget (`index.js:69-128`)

- Replace the per-element `candidates()` + `getBoundingClientRect()` + `getComputedStyle()` walk in `move()` with a single `snapshot()` that reads all `SEL` matches once into `{el, r}` and rejects hidden elements cheaply first (`el.getClientRects().length`, `offsetParent`), falling back to `visible()` only for survivors.
- Left/right filters the snapshot to the current row band before scoring (the existing overlap rule, just earlier).
- Keep `visible()` for `focusDefault()` and external calls.

**Deliberately deferred:** the `WeakMap` + DOM-version candidate cache from stellar-tv. Only add it if the budget test fails.

**Verify:** on `/many`, 40 synthetic keydowns, p95 of `performance.now()` deltas < 40 ms (desktop Chrome; TV is ~4–8× slower, so this is the proxy bar). Cached-vs-fresh correctness: appending 12 cards mid-test makes them reachable without a reload.

## Step 3 — modal scope (`new`, near `move`)

- `scope()` returns the topmost visible `[role="dialog"], dialog[open], [aria-modal="true"], [class*="modal"]` — or a `position:fixed` element covering > 25% of the viewport with `z-index >= 10` — picking the highest computed z-index.
- `move()`, `focusDefault()` and `activate()` operate inside `scope() || document`.
- Track `origin = document.activeElement` when a scope first appears, and on scope removal refocus `origin` if still visible, else `focusDefault()`.

**Verify:** `/dialog`: arrows never leave the dialog; with the dialog open, `focusDefault()` picks the dialog's first button, not a poster; after close, focus is back on `#open`.

## Step 4 — Back order (`index.js:141-162`)

Back (10009) becomes, in order: close the active scope (click its close control, `preventDefault`) → blur a focused text field → `history.back()` when `history.length > 1` → otherwise leave the key alone so TizenBrew/Tizen exits. Media handler's fullscreen-exit branch stays first for play pages.

**Verify:** `/dialog` — one Back closes the dialog and does not navigate; second Back navigates. On a text field, Back blurs instead of navigating.

## Step 5 — focus memory per URL (`focusin` + `sessionStorage`)

- `marker(el)` = `href` when present, else `aria-label`, else first 40 chars of text.
- On `focusin`, debounced 300 ms, write `sessionStorage['bbtv-focus'] = JSON.stringify({ [pathname]: marker })`, capped at the 20 most recent paths (LRU array).
- On boot, after the existing 800 ms pass, if a marker exists for `location.pathname` and no key has been pressed yet, `querySelector` it (`a[href="…"]` first) and `focusEl(…, true)`.

**Verify:** `/ragged` — focus card #7, click through to the detail mock, `goBack()` → card #7 is focused and scrolled into view; pressing a key before the restore window elapses cancels the restore.

## Step 6 — play-route seek + Enter (`index.js:141-162`, uses Step 8 HUD)

- On `/^\/[^/]+\/play\//` with `document.activeElement === body` (no control focused): left/right seek `±15 s` clamped to `[0, duration]`, HUD shows `« 15 s` / `15 s »`; Enter toggles playback.
- Guard: only when a `<video>` exists and the key is not already consumed by a focused player control.

**Verify:** `/play/m1-0`: right → `currentTime === 15`; left → `0`; at `duration` clamps; Enter flips `paused`; HUD text appears and clears after 1.2 s.

## Step 7 — wake hidden controls (`new`, called from both key handlers)

- Throttled to 400 ms: `document.dispatchEvent(new MouseEvent('mousemove', {bubbles: true, clientX: innerWidth / 2, clientY: innerHeight - 40}))` after any handled key.

**Verify:** mock counts `mousemove` on `document`: ≥ 1 after a keypress, ≤ 2 after five rapid keypresses (throttle), and focus does not change as a result.

## Step 8 — HUD pill (`new`, single helper)

- `hud(text, ttlMs)` creates/reuses `#bbtv-hud`: `position:fixed; left:24px; bottom:24px; z-index:2147483000; padding:10px 16px; border-radius:999px; background:rgba(10,10,10,.85); color:#fff; font:600 1.1rem/1.2 system-ui`.
- Buffering: on `waiting` start a 2 s timer → `Buffering…`; after 20 s more, text becomes `Still buffering — Back, then pick another server`; `playing`/`canplay` clears it.
- Reused by Steps 6 and the existing watchdog (message instead of silent reload).

**Verify:** `/play/m1-0`: `waiting` → pill appears within 2.2 s; `playing` → pill gone; a 25 s `waiting` shows the server hint; no pill on non-play pages except seek feedback.

## Step 9 — subtitle sizing (`mountStyle`, `index.js:32-43`)

- Add `video::cue { background-color: rgba(0,0,0,.55); font-size: 1.35em; }` and inside `.bbtv-play` the same rule scoped.

**Verify:** stylesheet assertion in `v12.js` (`document.styleSheets` contains the `::cue` rule after boot). Note for the device pass: if the site renders subtitles as its own DOM overlay instead of a `<track>`, add that container's class — unknown until the play page is inspectable off the datacenter IP.

## Step 10 — release

- `package.json` → `1.2.0`; README: table row for pref-X / focus restore / modal scope / seek / HUD, and a "verified" line with the new test counts.
- Commit `v1.2.0: …` on `master`.
- **Push + tag `v1.2.0` only with explicit approval** — v1.1.0 is still unpushed and TV installs pin a tag.

---

## Regression suite

| check | command | bar |
|---|---|---|
| nav core | `node /tmp/tvprobe/nav.js` | 11/11 |
| v1.2 features | `node /tmp/tvprobe/v12.js` | all pass |
| perf | inside `v12.js` | p95 < 40 ms on 600 cards |
| live site | `node /tmp/tvprobe/realnav.js` | 11-stop trail, album in view, 0 page errors |
| live visual | screenshot at 1.25× root font | no layout breakage |

## Risks

- **Site binds arrows on the play page** — unverified (Turnstile gate blocks inspection from this IP). If it does, Step 6 only fires with `activeElement === body`, so the site keeps priority; worst case the seek never triggers.
- **`sessionStorage` marker mismatch** — href-based markers survive reloads; text markers can collide on cards with image-only titles. Fallback is the existing `focusDefault()`.
- **Observer cost on a 40k-title list page** — Steps 3/5 add a debounced `MutationObserver` (already one exists in the watchdog); both are debounced and read-only.
- **HUD over the site's OSD** — bottom-left is the site's control bar area; move it to bottom-right if it collides during the device pass.
