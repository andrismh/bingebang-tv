# BingeBang TV

A [TizenBrew](https://github.com/reisxd/TizenBrew) site-modification module that makes `bingebang.st`
usable with a Samsung TV remote and a 10-foot viewing distance.

## What it patches

| Problem | Fix |
|---|---|
| Every visible focus style is `:focus-visible`, which Tizen 6.0's Chromium 78 ignores → only a 1px UA ring remains | Injects a `:focus` ring (2px `#a78bfa`, 4px glow, 1.03 scale) |
| The site implements no arrow-key navigation, so a remote can open the page but not move around it | Own D-pad cursor: geometry-scored focus, row-locked left/right, nearest-row up/down with a remembered column, Enter clicks, first element auto-focused on load |
| Ragged shelves (wide "spotlight" rows) make a naive nearest-centre up/down drift a column | The column you pressed left/right to reach is remembered, so up/down always returns to it |
| Back leaves the page even when a dialog is open, or a search field is focused | Back order: close the topmost modal → leave a text field → history back. Focus returns to the element that opened the dialog |
| Coming back from a detail page dumps focus at the top of the grid again | The focused element is remembered per URL in `sessionStorage`; Back lands on the card you left |
| Dialogs do not trap the cursor: arrows can wander onto the page behind | The topmost visible `[role=dialog]` / `[aria-modal]` becomes the navigation boundary |
| On the player, left/right do nothing and Enter does nothing | ←/→ seek ±15s (clamped, with an on-screen `» 15s`), Enter toggles play/pause — only when no control is focused, so the site keeps priority |
| The player's own buttons (server, quality, subtitles, settings) are plain `<button>`s that nothing ever focuses, so a remote can only skip and pause | ↑/↓ move the cursor into the control bar and focus Play/Pause; ←/→ then walk the bar (Back 10s → Forward 10s → Mute → Quality → Subtitles → Server → Settings → Fullscreen), Enter activates, ↓ hands the remote back to the film |
| The settings drawer is a `role=dialog` that redraws its panel when you pick a category, dropping focus on the floor | The drawer becomes the navigation boundary, its first real choice gets focus, and a re-render puts the cursor back on the new panel instead of the page |
| A stalled stream looks like a frozen screen; players that hide their controls until a mouse moves never show them | `Buffering…` pill after 2s (plus a "pick another server" hint at 20s), synthetic throttled `mousemove` on every keypress to wake the OSD |
| Subtitles are sized for desktop | `video::cue` at 1.35em with a dark scrim (only if the page uses a native track — the live player draws subtitles in its own `.pl-cues` layer at ~43px, which needs no help) |
| Layout sized for a laptop: 15px body, 13.5px card titles at 1080p | Root font-size 10px → 12.5px (body 18.75px, titles ~17px) |
| Player sits in the page chrome | On `/movie/play/*` and `/tv/play/*`: video forced to `100vw/100vh`, page scroll locked |
| Site never binds media keys (0 occurrences in the bundle) | `MediaPlayPause/Play/Pause/Stop/FastForward/Rewind` routed to the `<video>` |
| "All servers failed" / expired access pass | Acts only when a `<video>` is genuinely stalled **and** the visible text is a terminal error; retries once, then shows `Stream failing — Back, then pick another server`. Budget of 2 actions per URL per 5 min, persisted in `sessionStorage`, so it cannot loop or reload-storm |
| Domain rotation (`bingebang.st` ↔ `bingebang.club`) | Swaps host once on a dead/Cloudflare page instead of showing a blank screen |

## Install

TizenBrew loads modules through jsDelivr, so the repo must be **public** and at the root.

1. Push this directory to a public GitHub repo, e.g. `yourname/bingebang-tv`.
2. On the TV: TizenBrew → Modules → **+** → **GitHub** → enter `yourname/bingebang-tv`.
3. Launch it from the module list. It opens `https://bingebang.st` with the script injected on every page load.

## Editing

jsDelivr caches hard. After a change, bump `version` in `package.json`, commit, tag (`git tag v1.3.0 && git push --tags`),
then reference `yourname/bingebang-tv@v1.3.0` in TizenBrew — or purge the cache at
`https://cdn.jsdelivr.net/gh/yourname/bingebang-tv/`.

Fast loop without republishing: open the site in desktop Chrome and paste the contents of `index.js` into the console.

## What it cannot do

- **No home-screen tile.** Modules run inside TizenBrew. A `.wgt` app would get a tile but cannot inject script into a
  cross-origin page, so it would lose every patch above.
- **Cannot pass the Turnstile gate.** If your connection is seen as VPN/proxy/CGNAT, the play route shows "Quick check
  before you watch" and no script can solve that — only a clean IP can.
- **Cannot fix the CDN.** Playback still goes through their hls.js + cross-origin stream host; if that host refuses your
  network, nothing here changes it.

## Verified

Desktop Chrome (as a Chromium-78 proxy) against a mock and the live site: root font 12.5px, body 18.75px,
focus ring `2px solid rgb(167,139,250)`, single injected `<style>` after double injection, `bbtv-play` class only on play
routes, video 1920×1080, media-key ordering `["play","pause","play"]`, watchdog clicks Retry, zero page errors on
`bingebang.st` with all 176 home cards still rendering.

Navigation: 11/11 assertions on a mock (auto-focus, right/left inside a row, down/up between shelves, row scroll,
`Enter` navigates, Back navigates) and an 11-stop trail on the live site that stays in the viewport with a visible ring
everywhere: logo → `Play` → `Add to watchlist` → `More info` → `This Week` → hero arrow → shelf arrow → poster card.
Not verified on real TV hardware.

v1.2 additions, 23/23 assertions on the mock: the remembered column survives a wide 2-card row (712 → 484 → 712, where
a naive nearest-centre move lands at 516), modal cursor confinement, Back closes a dialog without navigating and refocuses
its opener, per-URL focus restore after a detail-page round trip (`/movie/watch/m1-3` in and out), ±15s seek clamped to
`[0, duration]` with a ``» 15s`` HUD that clears itself, Enter toggling `paused` both ways, buffering pill appearing after
2s and clearing on `playing`, exactly one synthetic `mousemove` for five rapid keypresses, and the `video::cue` rule.

Live player, WARP off, 1920x1080: server resolves in 3.5s (`Loading streaming servers…` → `Loading server Aldebaran…`),
the stream reaches `readyState 4` and climbs 1s per second, ArrowRight seeks +15.8s and ArrowLeft -14.2s (scroll included),
Enter pauses and resumes, Back returns to `/movie/watch/<slug>` with the Play button refocused and a 2px ring, one
navigation, zero page errors, and the watchdog stays silent for the whole session. The live player draws subtitles in its
own `.pl-cues` layer (43px at 1080p), not through a `<video>` track, so the `::cue` rule is inert there.

v1.3.0 player controls, measured on the live player: ↑ from the film focuses `Pause` at [39,981,75,75] with the 2px ring, then
seven → presses walk `Back 10 seconds → Forward 10 seconds → Mute → Quality → Subtitles → Server → Settings → Fullscreen`
(geometry jumps the gap in the middle of the bar), ↓ returns to the film, and ↑ comes back to `Pause`. `Enter` on
Settings opens the drawer (`role=dialog .pl-gate-sheet`, 688x477) with focus on the first real choice; picking the
Subtitles category re-renders the panel to `Back / Close / Off / OpenSubtitles / Upload / Options` (688x328) and focus lands
on the new panel 150ms later instead of the page behind it; Back closes a level and returns focus to the `Settings` button.
The re-render fix was a real bug in the observer: the player repaints its clock four times a second, so the 300ms
debounce never fired — replacement is a throttle that always runs once. Regression after the change: 23/23 mock
assertions, 11/11 navigation assertions, 14-press live home trail with nothing out of view.
Arrow keys over 600 cards: p95 4.3 ms per keypress. Live: a 14-press down-trail from the hero to the footer keeps every
stop inside the viewport with the ring drawn, ends at `scrollY 4261`, and logs no page errors.

v1.2.1 fixes a reload storm the 1.2.0 watchdog caused: a player page whose visible text includes a hint like "try another
server" matched the failure regex on every mutation, and the reload throttle lived in a variable that a reload resets, so
the page reloaded every ~1.6s (measured: 5 navigations in 8s on a mock picker page). The regex now only accepts terminal
failure text, matching runs against `innerText` so hidden menus cannot trigger it, the player must actually be stalled,
and the retry budget is persisted per URL. Re-measured: picker mock 1 navigation / 0 clicks, failure mock exactly 1 Retry
click then a stable hint. Gate page behind the VPN wall: 1 navigation in 20s.
