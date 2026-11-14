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
  var lastReload = 0;

  var CSS = [
    /* 10px root makes 15px body text; scale for a 10-foot view */
    'html{font-size:12.5px!important}',
    /* site styles focus with :focus-visible only, which Chromium 78 ignores */
    'a:focus,button:focus,[tabindex]:focus,[role="button"]:focus,input:focus,select:focus{',
    'outline:2px solid #a78bfa!important;outline-offset:2px!important;',
    'box-shadow:0 0 0 4px rgba(167,139,250,.30)!important;border-radius:6px;',
    'transform:scale(1.03);transition:transform .12s ease,box-shadow .12s ease;position:relative;z-index:5}',
    'html.bbtv-play body{overflow:hidden!important}',
    'html.bbtv-play video{width:100vw!important;height:100vh!important;object-fit:contain!important;background:#000}'
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

  function reloadThrottled() {
    var now = Date.now();
    if (now - lastReload < 15000) return;
    lastReload = now;
    location.reload();
  }

  function playThen(fn) {
    try { var p = fn(); if (p && p.catch) p.catch(function () {}); } catch (e) {}
  }

  /* ---------- D-pad cursor: the TV engine's spatial nav does not reach this page ---------- */
  function visible(el) {
    if (el.disabled || el.getAttribute('aria-hidden') === 'true') return false;
    var r = el.getBoundingClientRect();
    if (r.width * r.height < 600) return false;
    var cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && parseFloat(cs.opacity) > 0.05;
  }

  function candidates() {
    return Array.prototype.filter.call(document.querySelectorAll(SEL), visible);
  }

  function inView(el) {
    var r = el.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth;
  }

  function focusEl(el) {
    try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    var r = el.getBoundingClientRect();
    /* nearest can leave a tall card a few pixels clipped; recentre when it does */
    if (r.top < 8 || r.bottom > innerHeight - 8) el.scrollIntoView({ block: 'center', inline: 'nearest' });
  }

  function focusDefault() {
    var all = candidates();
    var cards = all.filter(function (el) {
      var r = el.getBoundingClientRect();
      return /\/watch\//.test(el.getAttribute('href') || '') && r.width * r.height > 8000 && inView(el);
    });
    var pick = cards[0] || all.filter(inView)[0] || all[0];
    if (pick) focusEl(pick);
  }

  function move(dir) {
    var cur = document.activeElement;
    if (!cur || cur === document.body || !cur.matches(SEL) || !visible(cur)) return focusDefault();

    var cr = cur.getBoundingClientRect();
    var cx = cr.left + cr.width / 2;
    var cy = cr.top + cr.height / 2;
    var horizontal = dir === 'left' || dir === 'right';
    var best = null;
    var bestScore = Infinity;

    candidates().forEach(function (el) {
      if (el === cur || el.contains(cur) || cur.contains(el)) return;
      var r = el.getBoundingClientRect();
      var dx = r.left + r.width / 2 - cx;
      var dy = r.top + r.height / 2 - cy;
      var primary = dir === 'left' ? -dx : dir === 'right' ? dx : dir === 'up' ? -dy : dy;
      if (primary < 4) return;

      if (horizontal) {
        /* stay inside the row so left/right never hop to another shelf */
        if (Math.min(cr.bottom, r.bottom) - Math.max(cr.top, r.top) <= 0) return;
        var score = primary + Math.abs(dy) * 0.5;
      } else {
        var hOverlap = Math.min(cr.right, r.right) - Math.max(cr.left, r.left);
        var score = primary + Math.abs(dx) * 2 - (hOverlap > 0 ? 30 : 0);
      }
      if (score < bestScore) { bestScore = score; best = el; }
    });

    if (best) focusEl(best);
    else if (!horizontal) window.scrollBy(0, dir === 'down' ? 320 : -320);
  }

  function activate() {
    var el = document.activeElement;
    if (!el || el === document.body) focusDefault();
    else if (el.click) el.click();
  }

  function typing(e) {
    var t = e.target;
    return !!t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);
  }

  window.addEventListener('keydown', function (e) {
    if (typing(e)) return;
    var code = e.keyCode || e.which;

    if (ARROWS[code]) {
      e.preventDefault();
      e.stopPropagation();
      move(ARROWS[code]);
      return;
    }
    if (code === 13) {
      e.preventDefault();
      e.stopPropagation();
      activate();
      return;
    }
    if (code === 10009 && history.length > 1) {
      e.preventDefault();
      history.back();
    }
  }, true);

  /* The site never binds media keys, so they die unless we take them. */
  window.addEventListener('keydown', function (e) {
    var code = e.keyCode || e.which;
    var v = document.querySelector('video');

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

    function failed() {
      var t = document.body ? document.body.textContent || '' : '';
      return /(all )?servers? failed|access pass (has )?expired|session (has )?expired|try another server/i.test(t);
    }

    function recover() {
      var buttons = Array.prototype.slice.call(document.querySelectorAll('button,a,[role="button"]'));
      var retry = buttons.filter(function (el) {
        return /retry|try again|reload|refresh|another server/i.test(el.textContent || '');
      })[0];
      if (retry) retry.click();
      else reloadThrottled();
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
    var isPlay = /^\/[^/]+\/play\//.test(location.pathname);
    if (isPlay) document.documentElement.classList.add('bbtv-play');
    startWatchdog();
    checkHostFallback();
    if (!isPlay) setTimeout(function () {
      if (!document.activeElement || document.activeElement === document.body) focusDefault();
    }, 800);
  });
})();
