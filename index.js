/*
 * BingeBang TV — TizenBrew site-modification module.
 *
 * TizenBrew re-evaluates this file on every execution context
 * (service-nextgen/service/utils/debugger.js), so it must be idempotent
 * and must not assume the body exists yet.
 */
(function () {
  'use strict';
  if (window.__bbtv) return;
  window.__bbtv = true;

  var HOST_ALT = { 'bingebang.st': 'bingebang.club', 'www.bingebang.st': 'bingebang.club' };
  var MEDIA = { 10252: 'toggle', 415: 'play', 19: 'pause', 413: 'toggle', 417: 'ffwd', 412: 'rwnd' };
  var ARROWS = { 37: 'left', 38: 'up', 39: 'right', 40: 'down' };
  var SEL = 'a[href],button,[role="button"],[tabindex]:not([tabindex="-1"]),summary,select';
  var GUARD_KEY = 'bbtv-fail';

  var CSS = [
    /* 10px root makes 15px body text; scale for a 10-foot view */
    'html{font-size:12.5px!important}',
    /* site styles focus with :focus-visible only, which Chromium 78 ignores */
    'a:focus,button:focus,[tabindex]:focus,[role="button"]:focus,input:focus,select:focus{',
    'outline:2px solid #a78bfa!important;outline-offset:2px!important;',
    'box-shadow:0 0 0 4px rgba(167,139,250,.30)!important;border-radius:6px;',
    'transform:scale(1.03);transition:transform .12s ease,box-shadow .12s ease;position:relative;z-index:5}',
    'html.bbtv-play body{overflow:hidden!important}',
    'html.bbtv-play video{width:100vw!important;height:100vh!important;object-fit:contain!important;background:#000}',
    /* cues are burned at native resolution; scale with the 12.5px root */
    'video::cue{background-color:rgba(0,0,0,.55);font-size:1.35em}'
  ].join('');

  /* TizenBrew evaluates this at executionContextCreated, where <html> may not exist yet. */
  function mountStyle() {
    if (document.getElementById('bbtv-style')) return true;
    var root = document.head || document.documentElement;
    if (!root) return false;
    var s = document.createElement('style');
    s.id = 'bbtv-style';
    s.textContent = CSS;
    root.appendChild(s);
    return true;
  }
  if (!mountStyle()) document.addEventListener('readystatechange', mountStyle);

  function onReady(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
    else fn();
  }

  /* Retry budget that survives a reload — a per-document timer resets and loops. */
  function attempts() {
    try {
      return JSON.parse(sessionStorage.getItem(GUARD_KEY) || '{}')[location.pathname] || { n: 0, t: 0 };
    } catch (e) {
      return { n: 0, t: 0 };
    }
  }

  function allowAttempt() {
    var a = attempts();
    if (Date.now() - a.t < 20000) return false;
    return a.n < 2 || Date.now() - a.t > 300000;
  }

  function noteAttempt() {
    try {
      var all = JSON.parse(sessionStorage.getItem(GUARD_KEY) || '{}');
      all[location.pathname] = { n: attempts().n + 1, t: Date.now() };
      sessionStorage.setItem(GUARD_KEY, JSON.stringify(all));
    } catch (e) {}
  }

  function reloadThrottled() {
    if (!allowAttempt()) return;
    noteAttempt();
    location.reload();
  }

  function playThen(fn) {
    try { var p = fn(); if (p && p.catch) p.catch(function () {}); } catch (e) {}
  }

  /* ---------- D-pad cursor: the TV engine's spatial nav does not reach this page ---------- */
  var FOCUS_KEY = 'bbtv-focus';
  var isPlay = /^\/[^/]+\/play\//.test(location.pathname);
  var prefX = null;      /* remembered column, so vertical moves do not drift */
  var scopeOrigin = null; /* element to refocus when a modal closes */
  var lastFocus = null;
  var keyed = false;
  var wakeAt = 0;
  var hudEl = null;
  var hudTimer = null;

  /* One rect read per element per move: geometry is the expensive part on a TV. */
  function visibleWithRect(el) {
    if (el.disabled || el.getAttribute('aria-hidden') === 'true') return null;
    var r = el.getBoundingClientRect();
    if (r.width * r.height < 600) return null;
    var cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) <= 0.05) return null;
    return r;
  }

  function visible(el) {
    return !!visibleWithRect(el);
  }

  function candidates(root) {
    return Array.prototype.filter.call((root || document).querySelectorAll(SEL), visible);
  }

  function inView(el) {
    var r = el.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth;
  }

  /* The topmost visible modal is the navigation boundary. */
  function scope() {
    var list = document.querySelectorAll('[role="dialog"],dialog[open],[aria-modal="true"]');
    var best = null;
    var bestZ = -1;
    for (var i = 0; i < list.length; i++) {
      var r = visibleWithRect(list[i]);
      if (!r || r.width * r.height < innerWidth * innerHeight * 0.08) continue;
      var z = parseInt(getComputedStyle(list[i]).zIndex, 10);
      if (isNaN(z)) z = 0;
      if (z >= bestZ) { bestZ = z; best = list[i]; }
    }
    return best;
  }

  function closeScope(s) {
    /* inside the player's drawer, Back means one level up, not close everything */
    var btn = s.querySelector('button[aria-label*="back" i],[class*="back" i],button[aria-label*="close" i],[class*="close" i]');
    if (btn && visible(btn)) btn.click();
    else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
  }

  function focusEl(el) {
    try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    var r = el.getBoundingClientRect();
    /* nearest can leave a tall card a few pixels clipped; recentre when it does */
    if (r.top < 8 || r.bottom > innerHeight - 8) el.scrollIntoView({ block: 'center', inline: 'nearest' });
  }

  function focusDefault() {
    var bound = scope();
    var all = candidates(bound);
    var cards = all.filter(function (el) {
      var r = el.getBoundingClientRect();
      return /\/watch\//.test(el.getAttribute('href') || '') && r.width * r.height > 8000 && inView(el);
    });
    var pick = cards[0] || all.filter(inView)[0] || all[0];
    prefX = null;
    if (pick) focusEl(pick);
  }

  /* Inside a drawer, land on something to choose, not on the dismiss control. */
  function focusInside(s) {
    var all = candidates(s);
    var pick = null;
    for (var i = 0; i < all.length && !pick; i++) {
      if (!/close|back|dismiss/i.test((all[i].getAttribute('aria-label') || '') + ' ' + (all[i].className || ''))) pick = all[i];
    }
    pick = pick || all[0];
    prefX = null;
    if (pick) focusEl(pick);
    return !!pick;
  }

  function move(dir) {
    var cur = document.activeElement;
    var bound = scope();
    var usable = cur && cur !== document.body && cur.matches(SEL) && visible(cur) && (!bound || bound.contains(cur));
    /* the player owns the remote on /play/: reach its own controls instead of doing nothing */
    if (!usable) return isPlay ? (bound ? focusInside(bound) : enterChrome()) : focusDefault();

    var cr = cur.getBoundingClientRect();
    var cx = cr.left + cr.width / 2;
    var cy = cr.top + cr.height / 2;
    var horizontal = dir === 'left' || dir === 'right';
    var px = prefX == null ? cx : prefX;
    var pool = [];

    Array.prototype.forEach.call((bound || document).querySelectorAll(SEL), function (el) {
      if (el === cur || el.contains(cur) || cur.contains(el)) return;
      var r = visibleWithRect(el);
      if (!r) return;
      var dx = r.left + r.width / 2 - cx;
      var dy = r.top + r.height / 2 - cy;
      var primary = dir === 'left' ? -dx : dir === 'right' ? dx : dir === 'up' ? -dy : dy;
      if (primary < 4) return;
      /* left/right stay inside the row so they never hop to another shelf */
      if (horizontal && Math.min(cr.bottom, r.bottom) - Math.max(cr.top, r.top) <= 0) return;
      pool.push({ el: el, r: r, dx: dx, dy: dy, primary: primary });
    });

    /* up/down only consider the nearest row, or a wide column offset can skip a shelf */
    if (!horizontal && pool.length) {
      var minP = Infinity;
      for (var i = 0; i < pool.length; i++) if (pool[i].primary < minP) minP = pool[i].primary;
      var limit = minP + Math.max(60, minP * 0.5);
      pool = pool.filter(function (c) { return c.primary <= limit; });
    }

    var best = null;
    var bestScore = Infinity;
    pool.forEach(function (c) {
      var score;
      if (horizontal) {
        score = c.primary + Math.abs(c.dy) * 0.5;
      } else {
        /* target the remembered column, not the nearest centre of a raggedy row */
        var hOverlap = Math.min(cr.right, c.r.right) - Math.max(cr.left, c.r.left);
        score = c.primary + Math.abs(c.r.left + c.r.width / 2 - px) * 2 - (hOverlap > 0 ? 30 : 0);
      }
      if (score < bestScore) { bestScore = score; best = c.el; }
    });

    if (best) {
      focusEl(best);
      /* remember where you ended up, so the next vertical move returns here */
      if (horizontal) prefX = best.getBoundingClientRect().left + best.getBoundingClientRect().width / 2;
    } else if (!horizontal) {
      /* a drawer is open: stop at its edge instead of dropping the cursor on the film */
      if (bound) return;
      /* leaving the control bar downwards hands the remote back to the film */
      if (isPlay) {
        lastFocus = null;
        if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      } else {
        window.scrollBy(0, dir === 'down' ? 320 : -320);
      }
    }
  }

  function activate() {
    var el = document.activeElement;
    if (!el || el === document.body) return focusDefault();
    remember();
    if (el.click) el.click();
  }

  function typing(e) {
    var t = e.target;
    return !!t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);
  }

  /* ---------- remember the focused element per URL, so Back returns to it ---------- */
  function marker(el) {
    if (!el || !el.getAttribute) return null;
    var href = el.getAttribute('href');
    if (href) return 'a:' + href;
    var label = el.getAttribute('aria-label');
    if (label) return 'l:' + label;
    var t = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    return t ? 't:' + t : null;
  }

  function remember() {
    var m = marker(document.activeElement);
    if (!m) return;
    try {
      var all = JSON.parse(sessionStorage.getItem(FOCUS_KEY) || '{}');
      all[location.pathname] = m;
      sessionStorage.setItem(FOCUS_KEY, JSON.stringify(all));
    } catch (e) {}
  }

  function restore() {
    var m = null;
    try { m = (JSON.parse(sessionStorage.getItem(FOCUS_KEY) || '{}'))[location.pathname]; } catch (e) {}
    if (!m) return false;

    var el = null;
    var val = m.slice(2).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    try {
      if (m.slice(0, 2) === 'a:') el = document.querySelector('a[href="' + val + '"]');
      else if (m.slice(0, 2) === 'l:') el = document.querySelector('[aria-label="' + val + '"]');
    } catch (e) {}
    if (!el) {
      var all = candidates();
      for (var i = 0; i < all.length; i++) {
        if (marker(all[i]) === m) { el = all[i]; break; }
      }
    }
    if (el && visible(el)) { prefX = null; focusEl(el); return true; }
    return false;
  }

  /* ---------- on-screen feedback for seek / buffering ---------- */
  function hud(text, ttl) {
    var root = document.body || document.documentElement;
    if (!root) return;
    if (!hudEl || !hudEl.parentNode) {
      hudEl = document.createElement('div');
      hudEl.id = 'bbtv-hud';
      hudEl.style.cssText = 'position:fixed;left:24px;bottom:24px;z-index:2147483000;padding:10px 18px;' +
        'border-radius:999px;background:rgba(12,12,18,.88);color:#fff;font:600 1.6rem/1.3 system-ui,sans-serif;' +
        'pointer-events:none;opacity:0;transition:opacity .15s';
      root.appendChild(hudEl);
    }
    hudEl.textContent = text || '';
    hudEl.style.opacity = text ? '1' : '0';
    clearTimeout(hudTimer);
    /* ttl 0 = sticky, leave it up until the next playing/canplay */
    if (text && ttl !== 0) hudTimer = setTimeout(function () { hud('', 0); }, ttl || 1200);
  }

  function controlFocused() {
    var a = document.activeElement;
    return !!a && a !== document.body && a.matches && a.matches(SEL);
  }

  function seek(delta) {
    var v = document.querySelector('video');
    if (!v || !isFinite(v.duration)) return false;
    v.currentTime = Math.max(0, Math.min(v.duration, v.currentTime + delta));
    hud((delta > 0 ? '\u00bb ' : '\u00ab ') + Math.abs(delta) + 's', 900);
    return true;
  }

  /* The player's controls are ordinary <button>s; nothing focuses them on a TV, and they
     are the only way to reach server, quality, subtitles and settings. */
  function enterChrome() {
    wake();
    var primary = document.querySelector('button[aria-label="Play"],button[aria-label="Pause"]');
    if (primary && visible(primary)) {
      focusEl(primary);
      return true;
    }
    var bar = Array.prototype.slice.call(document.querySelectorAll(SEL)).filter(function (el) {
      var r = visibleWithRect(el);
      return r && r.top > innerHeight * 0.6;
    });
    bar.sort(function (a, b) {
      return a.getBoundingClientRect().left - b.getBoundingClientRect().left;
    });
    if (!bar.length) return false;
    focusEl(bar[0]);
    return true;
  }

  function startBufferWatch() {
    var t1 = null;
    var t2 = null;
    function clear() {
      clearTimeout(t1);
      clearTimeout(t2);
      t1 = t2 = null;
      hud('', 0);
    }
    document.addEventListener('waiting', function (e) {
      if (!e.target || e.target.tagName !== 'VIDEO') return;
      clearTimeout(t1);
      clearTimeout(t2);
      t1 = setTimeout(function () {
        hud('Buffering\u2026', 0);
        t2 = setTimeout(function () { hud('Still buffering \u2014 Back, then pick another server', 0); }, 20000);
      }, 2000);
    }, true);
    ['playing', 'canplay'].forEach(function (name) {
      document.addEventListener(name, function (e) {
        if (e.target && e.target.tagName === 'VIDEO') clear();
      }, true);
    });
  }

  /* Players hide their OSD until they see a pointer; nudge them on every keypress. */
  function wake() {
    var now = Date.now();
    if (now - wakeAt < 400) return;
    wakeAt = now;
    document.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true, clientX: innerWidth / 2, clientY: innerHeight - 40
    }));
  }

  function startNavObserver() {
    var timer = null;
    var ranAt = 0;
    var prevScope = null;

    function run() {
      timer = null;
      ranAt = Date.now();
      var s = scope();
      if (s && s !== prevScope) {
        var a = document.activeElement;
        if (a && a !== document.body && !s.contains(a)) scopeOrigin = a;
        else if (lastFocus && !s.contains(lastFocus)) scopeOrigin = lastFocus;
        if (!s.contains(document.activeElement)) focusInside(s);
      } else if (!s && prevScope) {
        var o = scopeOrigin;
        scopeOrigin = null;
        if (o && o.isConnected && visible(o)) focusEl(o);
        else if (!controlFocused()) focusDefault();
      }
      prevScope = s;

      /* a re-render can drop the focused node; put the cursor back */
      if (keyed && (!document.activeElement || document.activeElement === document.body || !document.activeElement.isConnected)) {
        if (s) {
          /* a drawer swapped its panel: the old tile is gone, focus the new one */
          var f = candidates(s)[0];
          if (f) focusEl(f);
        } else if (lastFocus && lastFocus.isConnected && visible(lastFocus)) {
          focusEl(lastFocus);
        } else if (!isPlay) {
          focusDefault();
        }
      }
    }

    /* The player repaints its clock four times a second, so a debounce that restarts on
       every mutation never fires. Throttle instead: run once, then at most every 300 ms. */
    new MutationObserver(function () {
      if (timer) return;
      var wait = Math.max(0, 300 - (Date.now() - ranAt));
      timer = setTimeout(run, wait);
    }).observe(document.body || document.documentElement, { childList: true, subtree: true });

    document.addEventListener('focusin', function () { lastFocus = document.activeElement; });
  }

  document.addEventListener('focusin', function () { setTimeout(remember, 300); });

  window.addEventListener('keydown', function (e) {
    var code = e.keyCode || e.which;
    keyed = true;

    /* Back: close a layer, then leave a text field, then leave the page. */
    if (code === 10009) {
      var s = scope();
      if (s) {
        e.preventDefault();
        closeScope(s);
        return;
      }
      if (typing(e)) {
        e.preventDefault();
        e.target.blur();
        return;
      }
      /* inside the player's controls, Back leaves the controls, not the film */
      if (isPlay && controlFocused()) {
        e.preventDefault();
        lastFocus = null;
        document.activeElement.blur();
        return;
      }
      if (history.length > 1) {
        e.preventDefault();
        history.back();
      }
      return;
    }
    if (typing(e)) return;
    wake();

    if (ARROWS[code]) {
      var dir = ARROWS[code];
      e.preventDefault();
      e.stopPropagation();
      if (isPlay && !controlFocused()) {
        /* left/right nudge the film; up/down reveal the control bar and take focus into it */
        if (dir === 'left' || dir === 'right') {
          seek(dir === 'right' ? 15 : -15);
        } else {
          enterChrome();
        }
        return;
      }
      move(dir);
      return;
    }
    if (code === 13) {
      e.preventDefault();
      e.stopPropagation();
      if (isPlay && !controlFocused()) {
        var v = document.querySelector('video');
        if (v) {
          v.paused ? playThen(function () { return v.play(); }) : v.pause();
          return;
        }
      }
      activate();
    }
  }, true);

  /* The site never binds media keys, so they die unless we take them. */
  window.addEventListener('keydown', function (e) {
    var code = e.keyCode || e.which;
    var v = document.querySelector('video');

    wake();

    if (v && MEDIA[code]) {
      e.preventDefault();
      e.stopPropagation();
      var action = MEDIA[code];
      if (action === 'toggle') v.paused ? playThen(function () { return v.play(); }) : v.pause();
      else if (action === 'play') playThen(function () { return v.play(); });
      else if (action === 'pause') v.pause();
      else if (action === 'ffwd' && isFinite(v.duration)) v.currentTime = Math.min(v.duration, v.currentTime + 10);
      else if (action === 'rwnd') v.currentTime = Math.max(0, v.currentTime - 10);
      return;
    }

    if (code === 10009) {
      var fs = document.fullscreenElement || document.webkitFullscreenElement;
      if (fs) {
        e.preventDefault();
        (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      }
    }
  }, true);

  /* Documented failure modes: expired access pass / all servers failed. */
  function startWatchdog() {
    var debounce = null;

    /* A player page is not "failed" while something is playing or loading. */
    function broken() {
      var v = document.querySelector('video');
      return !!v && (!!v.error || v.readyState < 3 || v.paused);
    }

    function failed() {
      if (!broken()) return false;
      /* innerText, not textContent: hidden menus and hints must not count */
      var t = document.body ? document.body.innerText || '' : '';
      return /(all )?servers? failed|no (working|available) servers?|access pass (has )?expired|session (has )?expired/i.test(t);
    }

    function recover() {
      var buttons = Array.prototype.slice.call(document.querySelectorAll('button,a,[role="button"]'));
      var retry = buttons.filter(function (el) {
        return /retry|try again|reload|refresh/i.test(el.textContent || '');
      })[0];
      if (!allowAttempt()) {
        hud('Stream failing \u2014 Back, then pick another server', 0);
        return;
      }
      noteAttempt();
      if (retry) retry.click();
      else if (attempts().n === 1) location.reload();
      else hud('Stream failing \u2014 Back, then pick another server', 0);
    }

    new MutationObserver(function () {
      clearTimeout(debounce);
      debounce = setTimeout(function () { if (failed()) recover(); }, 700);
    }).observe(document.body || document.documentElement, { childList: true, subtree: true });

    document.addEventListener('error', function (e) {
      if (e.target && e.target.tagName === 'VIDEO') reloadThrottled();
    }, true);
  }

  /* The project rotates domains; recover from a dead one instead of a blank screen. */
  function checkHostFallback() {
    var alt = HOST_ALT[location.hostname];
    if (!alt) return;
    try { if (sessionStorage.getItem('bbtv-host-tried')) return; } catch (e) {}
    setTimeout(function () {
      var text = document.body ? (document.body.textContent || '').trim() : '';
      var dead = /just a moment|attention required|checking your browser/i.test(document.title + ' ' + text);
      if (!dead && text.length >= 120) return;
      try { sessionStorage.setItem('bbtv-host-tried', '1'); } catch (e) {}
      location.replace(location.protocol + '//' + alt + location.pathname + location.search);
    }, 8000);
  }

  onReady(function () {
    if (isPlay) document.documentElement.classList.add('bbtv-play');
    startWatchdog();
    startNavObserver();
    startBufferWatch();
    checkHostFallback();
    if (!isPlay) setTimeout(function () {
      if (keyed) return;
      if (restore()) return;
      if (!document.activeElement || document.activeElement === document.body) focusDefault();
    }, 800);
  });
})();
