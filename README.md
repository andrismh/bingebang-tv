# BingeBang TV

A [TizenBrew](https://github.com/reisxd/TizenBrew) site-modification module that makes `bingebang.st`
usable with a Samsung TV remote and a 10-foot viewing distance.

## What it patches

| Problem | Fix |
|---|---|
| Every visible focus style is `:focus-visible`, which Tizen 6.0's Chromium 78 ignores → only a 1px UA ring remains | Injects a `:focus` ring (2px `#a78bfa`, 4px glow, 1.03 scale) |
| The site implements no arrow-key navigation, so a remote can open the page but not move around it | Own D-pad cursor: geometry-scored focus (row-locked left/right, nearest-row up/down), Enter clicks, Back goes back, first element auto-focused on load |
| Layout sized for a laptop: 15px body, 13.5px card titles at 1080p | Root font-size 10px → 12.5px (body 18.75px, titles ~17px) |
| Player sits in the page chrome | On `/movie/play/*` and `/tv/play/*`: video forced to `100vw/100vh`, page scroll locked |
| Site never binds media keys (0 occurrences in the bundle) | `MediaPlayPause/Play/Pause/Stop/FastForward/Rewind` routed to the `<video>` |
| "All servers failed" / expired access pass | Detects the text, clicks Retry, else reloads once per 15s; also recovers from `video` error |
| Domain rotation (`bingebang.st` ↔ `bingebang.club`) | Swaps host once on a dead/Cloudflare page instead of showing a blank screen |

## Install

TizenBrew loads modules through jsDelivr, so the repo must be **public** and at the root.

1. Push this directory to a public GitHub repo, e.g. `yourname/bingebang-tv`.
2. On the TV: TizenBrew → Modules → **+** → **GitHub** → enter `yourname/bingebang-tv`.
3. Launch it from the module list. It opens `https://bingebang.st` with the script injected on every page load.

## Editing

jsDelivr caches hard. After a change, bump `version` in `package.json`, commit, tag (`git tag v1.0.1 && git push --tags`),
then reference `yourname/bingebang-tv@v1.1.0` in TizenBrew — or purge the cache at
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
