/* ronn.cc audio player — tracks.json driven, R2-friendly */
(function () {
  "use strict";

  const audio = new Audio();
  audio.preload = "auto";
  audio.volume = 0.85;

  const els = {
    hero: document.getElementById("hero-player"),
    heroArt: document.getElementById("hero-art"),
    heroTitle: document.getElementById("hero-title"),
    heroSub: document.getElementById("hero-sub"),
    heroKicker: document.getElementById("hero-kicker"),
    play: document.getElementById("play-btn"),
    playIcon: document.getElementById("play-icon"),
    prev: document.getElementById("prev-btn"),
    next: document.getElementById("next-btn"),
    seek: document.getElementById("seek"),
    seekWrap: document.getElementById("seek-wrap"),
    seekFill: document.getElementById("seek-fill"),
    seekBuffer: document.getElementById("seek-buffer"),
    seekKnob: document.getElementById("seek-knob"),
    seekCurrent: document.getElementById("time-current"),
    seekDuration: document.getElementById("time-duration"),
    volume: document.getElementById("volume"),
    mute: document.getElementById("mute-btn"),
    list: document.getElementById("track-list"),
    listCount: document.getElementById("track-count"),
    mini: document.getElementById("mini"),
    miniArt: document.getElementById("mini-art"),
    miniTitle: document.getElementById("mini-title"),
    miniSub: document.getElementById("mini-sub"),
    miniProgress: document.getElementById("mini-progress"),
    miniPlay: document.getElementById("mini-play"),
    miniPlayIcon: document.getElementById("mini-play-icon"),
    miniNext: document.getElementById("mini-next"),
    status: document.getElementById("player-status"),
  };

  const ICONS = {
    play: '<path d="M8 5.14v13.72a1 1 0 0 0 1.52.85l11-6.86a1 1 0 0 0 0-1.7l-11-6.86A1 1 0 0 0 8 5.14z"/>',
    pause: '<path d="M7 5h3.2v14H7V5zm6.8 0H17v14h-3.2V5z"/>',
    volume: '<path d="M4 9.5h3.2L12 5.2v13.6L7.2 14.5H4v-5zm12.1 1.1a3.2 3.2 0 0 1 0 2.8l1.3 1.1a5 5 0 0 0 0-5l-1.3 1.1zM16 6.7v2.1a6.8 6.8 0 0 1 0 6.4v2.1a9 9 0 0 0 0-10.6z"/>',
    mute: '<path d="M4 9.5h3.2L12 5.2v13.6L7.2 14.5H4v-5zm12.3 1.2 1.4-1.4 1.1 1.1 1.1-1.1 1.4 1.4-1.1 1.1 1.1 1.1-1.4 1.4-1.1-1.1-1.1 1.1-1.4-1.4 1.1-1.1-1.1-1.1z"/>',
    eq: '<span class="eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span>',
  };

  const EQ_HTML = '<span class="eq row__eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span>';

  const state = {
    tracks: [],
    index: -1,
    base: "",
    seeking: false,
    ready: false,
    suppressEnded: false,
    healedSeekable: false,
    lastSeekAt: 0,
    streamSrc: "",
  };

  function noteSeek() {
    state.suppressEnded = true;
    state.lastSeekAt = Date.now();
  }

  function seekableCollapsed() {
    try {
      if (!audio.seekable || audio.seekable.length === 0) return true;
      const start = audio.seekable.start(0);
      const end = audio.seekable.end(audio.seekable.length - 1);
      return end <= start;
    } catch (_) {
      return true;
    }
  }

  /* Some hosts (Cloudflare Workers assets, some caches) ignore Range and
     leave media.seekable stuck at [0, 0]. Chrome then rejects currentTime
     seeks and the scrubber snaps back to 0. Reloading src does not help.
     Seeking falls back to a blob URL so the whole file is in memory. */
  const blobCache = new Map();
  const blobUrls = new Map();
  let seekSwapBusy = false;
  let pendingSeek = null;
  let seekGen = 0;

  function blobUrlFor(src) {
    if (!blobCache.has(src)) {
      const p = fetch(src)
        .then((r) => {
          if (!r.ok) throw new Error("HTTP " + r.status);
          return r.blob();
        })
        .then((b) => {
          const url = URL.createObjectURL(b);
          blobUrls.set(src, url);
          return url;
        })
        .catch((err) => {
          blobCache.delete(src);
          throw err;
        });
      blobCache.set(src, p);
    }
    return blobCache.get(src);
  }

  function retainBlobs(keepSrcs) {
    const keep = new Set(keepSrcs.filter(Boolean));
    for (const [src, url] of Array.from(blobUrls.entries())) {
      if (keep.has(src)) continue;
      try {
        URL.revokeObjectURL(url);
      } catch (_) {
        /* ignore */
      }
      blobUrls.delete(src);
      blobCache.delete(src);
    }
  }

  function prefetchBlob(src) {
    if (!src) return;
    // Huge WAVs only fetch on demand so mobile data isn't burned up front.
    if (/\.wav(\?|$)/i.test(src)) return;
    blobUrlFor(src).catch(() => {});
  }

  function rangeCovers(time) {
    try {
      if (!audio.seekable || !audio.seekable.length) return false;
      for (let i = 0; i < audio.seekable.length; i++) {
        if (
          time >= audio.seekable.start(i) - 0.05 &&
          time <= audio.seekable.end(i) + 0.05
        ) {
          return true;
        }
      }
      return false;
    } catch (_) {
      return false;
    }
  }

  function mediaIsBlob() {
    return typeof audio.src === "string" && audio.src.indexOf("blob:") === 0;
  }

  function applySeekTime(target) {
    if (target == null || !Number.isFinite(target)) return;
    noteSeek();
    if (mediaIsBlob() || rangeCovers(target)) {
      try {
        audio.currentTime = target;
      } catch (_) {
        /* ignore */
      }
      syncProgress();
      return;
    }
    pendingSeek = target;
    ensureBlobThenSeek();
  }

  function ensureBlobThenSeek() {
    if (seekSwapBusy) return;
    const src = state.streamSrc;
    if (!src) return;
    seekSwapBusy = true;
    const gen = seekGen;
    blobUrlFor(src)
      .then((url) => {
        if (gen !== seekGen) return;
        const t = pendingSeek;
        pendingSeek = null;
        const wasPlaying = isPlaying();
        return new Promise((resolve) => {
          let settled = false;
          const finish = (time) => {
            if (settled) return;
            settled = true;
            if (gen !== seekGen) {
              resolve();
              return;
            }
            if (Number.isFinite(time)) {
              try {
                audio.currentTime = time;
              } catch (_) {
                /* ignore */
              }
            }
            syncProgress();
            syncBuffer();
            if (wasPlaying) {
              const p = audio.play();
              if (p && typeof p.catch === "function") {
                p.catch(() => syncPlayUI());
              }
            } else {
              syncPlayUI();
            }
            resolve();
          };
          audio.addEventListener("loadedmetadata", () => finish(t), {
            once: true,
          });
          audio.src = url;
          setTimeout(() => finish(t), 3000);
        });
      })
      .catch(() => {
        if (gen === seekGen && pendingSeek != null) {
          try {
            audio.currentTime = pendingSeek;
          } catch (_) {
            /* ignore */
          }
          pendingSeek = null;
          syncProgress();
        }
      })
      .then(() => {
        seekSwapBusy = false;
        if (gen === seekGen && pendingSeek != null) {
          const t = pendingSeek;
          pendingSeek = null;
          applySeekTime(t);
        }
      });
  }

  function healSeekable() {
    // Kept as a hook after metadata; real seekability is handled by the blob fallback.
  }

  function syncPositionState() {
    if (!("mediaSession" in navigator)) return;
    if (typeof navigator.mediaSession.setPositionState !== "function") return;
    try {
      if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
      navigator.mediaSession.setPositionState({
        duration: audio.duration,
        playbackRate: audio.playbackRate || 1,
        position: Math.min(
          Math.max(0, audio.currentTime || 0),
          audio.duration
        ),
      });
    } catch (_) {
      /* ignore unsupported / invalid */
    }
  }

  function fmtTime(sec) {
    if (!Number.isFinite(sec) || sec < 0) return "0:00";
    const s = Math.floor(sec % 60);
    const m = Math.floor(sec / 60);
    return m + ":" + String(s).padStart(2, "0");
  }

  function resolveSrc(track) {
    const raw = track.src || track.url || "";
    if (!raw) return "";
    if (/^https?:\/\//i.test(raw)) return raw;
    if (!state.base) return raw;
    return state.base.replace(/\/$/, "") + "/" + raw.replace(/^\//, "");
  }

  const TONEARM_HTML =
    '<div class="turntable" aria-hidden="true">' +
    '<div class="turntable__arm">' +
    '<div class="turntable__counterweight"></div>' +
    '<div class="turntable__tube"></div>' +
    '<div class="turntable__headshell">' +
    '<div class="turntable__stylus"></div>' +
    '<div class="turntable__glow"></div>' +
    "</div></div>" +
    '<div class="turntable__pivot"></div>' +
    '<div class="turntable__sparks">' +
    '<canvas class="spark-canvas" id="spark-canvas"></canvas>' +
    "</div></div>";

  /* ---------- stylus sparks (orange, canvas) ---------- */

  const sparks = {
    canvas: null,
    ctx: null,
    parts: [],
    raf: 0,
    running: false,
    last: 0,
    emitAcc: 0,
    burstAt: 0,
  };

  function resizeSparkCanvas() {
    if (!sparks.canvas || !els.heroArt) return;
    const rect = els.heroArt.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    if (sparks.canvas.width !== w * dpr || sparks.canvas.height !== h * dpr) {
      sparks.canvas.width = w * dpr;
      sparks.canvas.height = h * dpr;
      sparks.canvas.style.width = w + "px";
      sparks.canvas.style.height = h + "px";
    }
    if (sparks.ctx) sparks.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function stylusPoint() {
    const tip = document.querySelector(".turntable__stylus");
    const host = els.heroArt;
    if (!tip || !host) return null;
    const t = tip.getBoundingClientRect();
    const h = host.getBoundingClientRect();
    return {
      x: t.left + t.width / 2 - h.left,
      y: t.bottom - 2 - h.top,
    };
  }

  // Slow orange embers — stylus crackle, not a firework.
  // Velocity units are px/s; integrate with dt only.
  function spawnSpark(x, y, boost) {
    // Bias sideways along the groove; only a slight upward flick.
    const ang = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
    const sp = (18 + Math.random() * 42) * (boost ? 1.25 : 1);
    sparks.parts.push({
      x: x + (Math.random() - 0.5) * 3,
      y: y + (Math.random() - 0.5) * 2,
      vx: Math.cos(ang) * sp * (0.4 + Math.random() * 0.7),
      vy: Math.sin(ang) * sp * 0.55 - Math.random() * 12,
      life: 0,
      ttl: 0.9 + Math.random() * 1.4,
      size: 0.7 + Math.random() * 1.6 * (boost ? 1.15 : 1),
      hue: 18 + Math.random() * 22,
    });
    if (sparks.parts.length > 120) sparks.parts.splice(0, sparks.parts.length - 120);
  }

  function stepSparks(dt) {
    const ctx = sparks.ctx;
    if (!ctx || !sparks.canvas) return;
    const w = sparks.canvas.clientWidth;
    const h = sparks.canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);

    if (isPlaying()) {
      const tip = stylusPoint();
      if (tip) {
        sparks.emitAcc += dt;
        // rare pop every ~1.8–2.8s, then a short crackle
        if (Date.now() - sparks.burstAt > 1800 + Math.random() * 1000) {
          sparks.burstAt = Date.now();
          for (let i = 0; i < 3; i++) spawnSpark(tip.x, tip.y, true);
        }
        // trickle: ~4–6 embers/sec, not a continuous fountain
        while (sparks.emitAcc > 0.18) {
          sparks.emitAcc -= 0.18;
          if (Math.random() < 0.75) spawnSpark(tip.x, tip.y, false);
        }
      }
    }

    const g = 55; // px/s^2 — gentle settle
    const drag = Math.exp(-1.1 * dt); // ~0.98 per frame at 60fps
    for (let i = sparks.parts.length - 1; i >= 0; i--) {
      const p = sparks.parts[i];
      p.life += dt;
      if (p.life >= p.ttl) {
        sparks.parts.splice(i, 1);
        continue;
      }
      p.vy += g * dt;
      p.vx *= drag;
      p.vy *= drag;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const t = p.life / p.ttl;
      // fade in briefly, then long soft fade out
      const a = (t < 0.08 ? t / 0.08 : 1 - (t - 0.08) / 0.92) * 0.9;
      const r = p.size * (1 - t * 0.35);
      const grd = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 2.4);
      grd.addColorStop(0, "hsla(" + p.hue + ", 100%, 68%, " + a + ")");
      grd.addColorStop(0.35, "hsla(" + p.hue + ", 100%, 48%, " + a * 0.8 + ")");
      grd.addColorStop(1, "hsla(" + p.hue + ", 100%, 38%, 0)");
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 2.4, 0, Math.PI * 2);
      ctx.fill();

      // soft core — dimmer than before so it reads as ember, not sparkler
      ctx.fillStyle = "hsla(" + (p.hue + 6) + ", 100%, 74%, " + a * 0.85 + ")";
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(0.45, r * 0.4), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function sparkLoop(ts) {
    if (!sparks.running) return;
    const now = ts || performance.now();
    const dt = Math.min(0.05, sparks.last ? (now - sparks.last) / 1000 : 0.016);
    sparks.last = now;
    stepSparks(dt);
    sparks.raf = requestAnimationFrame(sparkLoop);
  }

  function startSparks() {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    if (sparks.running) return;
    sparks.running = true;
    sparks.last = 0;
    sparks.raf = requestAnimationFrame(sparkLoop);
  }

  function stopSparks() {
    sparks.running = false;
    if (sparks.raf) cancelAnimationFrame(sparks.raf);
    sparks.raf = 0;
    // keep last frame briefly; clear particles so next play starts clean
    sparks.parts.length = 0;
  }

  function bindSparks() {
    const canvas = document.getElementById("spark-canvas");
    sparks.canvas = canvas;
    sparks.ctx = canvas ? canvas.getContext("2d") : null;
    resizeSparkCanvas();
    if (sparks.running) {
      // canvas was replaced — restart loop against the new node
      sparks.running = false;
      startSparks();
    }
  }

  window.addEventListener("resize", () => {
    syncTurntableSize();
    resizeSparkCanvas();
  });

  function syncTurntableSize() {
    const host = els.heroArt;
    if (!host) return;
    const s = Math.min(host.clientWidth, host.clientHeight);
    if (s > 0) host.style.setProperty("--tt-size", s + "px");
  }

  function mountHeroArt(html) {
    if (!els.heroArt) return;
    els.heroArt.innerHTML = html + TONEARM_HTML;
    syncTurntableSize();
    bindSparks();
    updateTonearm();
  }

  function vinylInner() {
    return (
      '<div class="vinyl">' +
      '<div class="vinyl__shine"></div>' +
      '<div class="vinyl__mark"></div>' +
      '<div class="vinyl__paper">' +
      '<img class="vinyl__wordmark" src="/img/ronn-wordmark.png" alt="" width="798" height="212" draggable="false">' +
      '<div class="vinyl__hole"></div>' +
      "</div>" +
      "</div>"
    );
  }

  function vinylHtml() {
    return (
      '<div class="hero-art__fallback" aria-hidden="true">' +
      vinylInner() +
      "</div>"
    );
  }

  function artHtml(track, forMini) {
    const src = track.art || "";
    if (src) {
      const alt = (track.title || "Track artwork").replace(/"/g, "&quot;");
      return '<img src="' + src.replace(/"/g, "&quot;") + '" alt="' + alt + '" loading="lazy">';
    }
    const letter = (track.title || "?").trim().charAt(0).toUpperCase();
    if (forMini) {
      return "<span>" + letter + "</span>";
    }
    return (
      '<div class="hero-art__fallback" aria-hidden="true">' +
      vinylInner() +
      '<span class="art-letter">' +
      letter +
      "</span></div>"
    );
  }

  function setIcon(el, name) {
    if (!el) return;
    el.innerHTML = ICONS[name] || "";
  }

  function isPlaying() {
    return !audio.paused && !audio.ended;
  }

  function syncPlayUI() {
    const playing = isPlaying();
    if (els.heroKicker && state.index >= 0) {
      els.heroKicker.textContent = playing ? "Now playing" : "Selected";
    }
    if (els.play) {
      els.play.classList.toggle("is-playing", playing);
      els.play.setAttribute("aria-label", playing ? "Pause" : "Play");
      setIcon(els.play.querySelector("svg"), playing ? "pause" : "play");
    }
    if (els.miniPlay) {
      els.miniPlay.classList.toggle("is-playing", playing);
      els.miniPlay.setAttribute("aria-label", playing ? "Pause" : "Play");
      setIcon(els.miniPlay.querySelector("svg"), playing ? "pause" : "play");
    }
    if (els.hero) els.hero.classList.toggle("is-playing", playing);
    if (playing) startSparks();
    else stopSparks();
    updateTonearm();
    if (els.list) {
      els.list.querySelectorAll(".row").forEach((row, i) => {
        row.classList.toggle("is-active", i === state.index);
        row.classList.toggle("is-playing", i === state.index && playing);
        const btn = row.querySelector(".row-btn");
        if (btn) {
          const activePlay = i === state.index && playing;
          if (activePlay) {
            btn.innerHTML = ICONS.eq;
          } else {
            btn.innerHTML =
              '<svg viewBox="0 0 24 24" aria-hidden="true">' +
              ICONS.play +
              "</svg>";
          }
          btn.setAttribute(
            "aria-label",
            activePlay ? "Pause" : "Play track"
          );
        }
      });
    }
  }

  function updateTonearm() {
    const arm = els.heroArt && els.heroArt.querySelector(".turntable__arm");
    if (!arm) return;
    if (!isPlaying()) {
      arm.style.removeProperty("--arm-rot");
      arm.style.removeProperty("transition");
      return;
    }
    const dur = audio.duration;
    const cur = audio.currentTime;
    const p =
      Number.isFinite(dur) && dur > 0
        ? Math.min(1, Math.max(0, cur / dur))
        : 0;
    // outer groove (r≈0.32) → inner groove (r≈0.15) as the track plays.
    // Calibrated for arm width 40% of the turntable square: -3° lands on the
    // outer edge, -38° lands just outside the label, always on the pivot side.
    const angle = -3 - p * 35;
    arm.style.transition = "transform 0.35s linear";
    arm.style.setProperty("--arm-rot", angle.toFixed(2) + "deg");
  }

  function syncProgress() {
    const dur = audio.duration;
    const cur = audio.currentTime;
    const pct = Number.isFinite(dur) && dur > 0 ? (cur / dur) * 100 : 0;
    if (els.seekFill) els.seekFill.style.width = pct + "%";
    if (els.seekKnob) els.seekKnob.style.left = pct + "%";
    if (els.seekCurrent) els.seekCurrent.textContent = fmtTime(cur);
    if (els.seekDuration) {
      els.seekDuration.textContent = Number.isFinite(dur) ? fmtTime(dur) : "0:00";
    }
    if (els.miniProgress) els.miniProgress.style.width = pct + "%";
    if (els.seek) {
      els.seek.setAttribute("aria-valuenow", String(Math.round(pct)));
      els.seek.setAttribute(
        "aria-valuetext",
        fmtTime(cur) + " of " + fmtTime(dur)
      );
    }
    if (state.index >= 0 && Number.isFinite(dur) && dur > 0) {
      const row = els.list && els.list.querySelector('.row[data-index="' + state.index + '"] .row__time-text');
      if (row) row.textContent = fmtTime(dur);
    }
    if (els.heroKicker && !audio.paused) {
      els.heroKicker.textContent = "Now playing";
    }
    updateTonearm();
  }

  function syncBuffer() {
    if (!els.seekBuffer) return;
    try {
      if (audio.buffered.length && Number.isFinite(audio.duration) && audio.duration > 0) {
        const end = audio.buffered.end(audio.buffered.length - 1);
        els.seekBuffer.style.width = Math.min(100, (end / audio.duration) * 100) + "%";
      }
    } catch (_) {
      /* ignore */
    }
  }

  function updateHero() {
    const track = state.tracks[state.index];
    if (!track) return;
    if (els.heroTitle) els.heroTitle.textContent = track.title || "Untitled";
    if (els.heroSub) {
      els.heroSub.textContent = trackMeta(track) || "Ronn";
    }
    if (els.heroKicker) {
      els.heroKicker.textContent = isPlaying() ? "Now playing" : "Selected";
    }
    if (els.heroArt) mountHeroArt(artHtml(track, false));
    if (els.miniTitle) els.miniTitle.textContent = track.title || "Untitled";
    if (els.miniSub) {
      els.miniSub.textContent = trackMeta(track) || "Ronn";
    }
    if (els.miniArt) els.miniArt.innerHTML = artHtml(track, true);

    if ("mediaSession" in navigator) {
      const meta = {
        title: track.title || "Untitled",
        artist: track.artist || "Sutanu Chatterjee",
        album: track.album || "Ronn",
      };
      if (track.art) {
        meta.artwork = [
          { src: track.art, sizes: "512x512", type: "image/png" },
        ];
      }
      try {
        navigator.mediaSession.metadata = new MediaMetadata(meta);
      } catch (_) {
        /* older browsers */
      }
    }
  }

  function loadTrack(index, autoplay) {
    if (!state.tracks.length) return;
    state.index = (index + state.tracks.length) % state.tracks.length;
    const track = state.tracks[state.index];
    const src = resolveSrc(track);
    if (!src) {
      if (els.status) els.status.textContent = "No audio source for this track.";
      return;
    }
    // Setting src runs the resource selection algorithm; an extra load()
    // can leave Chrome's seekable range collapsed to [0, 0].
    state.healedSeekable = false;
    state.streamSrc = src;
    seekGen++;
    pendingSeek = null;
    retainBlobs([src]);
    audio.src = src;
    prefetchBlob(src);
    if (els.seekBuffer) els.seekBuffer.style.width = "0%";
    updateHero();
    syncPlayUI();
    syncProgress();
    if (autoplay) {
      const playPromise = audio.play();
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch(() => {
          syncPlayUI();
        });
      }
    }
  }

  function togglePlay() {
    if (state.index < 0) {
      loadTrack(0, true);
      return;
    }
    if (isPlaying()) {
      audio.pause();
    } else {
      const p = audio.play();
      if (p && typeof p.catch === "function") p.catch(() => syncPlayUI());
    }
  }

  function seekTargetFromRatio(ratio) {
    const dur = Number.isFinite(audio.duration) && audio.duration > 0
      ? audio.duration
      : 0;
    if (!dur) return null;
    const target = Math.min(1, Math.max(0, ratio)) * dur;
    // Stay shy of the true end so a user seek never fires "ended".
    return Math.min(target, dur - 0.08);
  }

  function seekFromEvent(e) {
    const el = els.seek;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (!rect.width) return;
    let clientX = null;
    if (e && typeof e.clientX === "number" && !Number.isNaN(e.clientX)) {
      clientX = e.clientX;
    } else if (e && e.touches && e.touches[0]) {
      clientX = e.touches[0].clientX;
    } else if (e && e.changedTouches && e.changedTouches[0]) {
      clientX = e.changedTouches[0].clientX;
    }
    if (clientX == null || Number.isNaN(clientX)) return;
    const ratio = (clientX - rect.left) / rect.width;
    const target = seekTargetFromRatio(ratio);
    if (target == null || !Number.isFinite(target)) return;
    const pct = Math.min(1, Math.max(0, ratio)) * 100;
    if (els.seekFill) els.seekFill.style.width = pct + "%";
    if (els.seekKnob) els.seekKnob.style.left = pct + "%";
    if (els.seekCurrent) els.seekCurrent.textContent = fmtTime(target);
    applySeekTime(target);
  }

  function trackMeta(track) {
    return [track.artist, track.album, track.year].filter(Boolean).join(" · ");
  }

  function renderList() {
    if (!els.list) return;
    if (!state.tracks.length) {
      els.list.innerHTML =
        '<li class="player-empty">No tracks yet — add entries to audio/tracks.json</li>';
      if (els.listCount) els.listCount.textContent = "0 tracks";
      return;
    }
    if (els.listCount) {
      els.listCount.textContent =
        state.tracks.length + (state.tracks.length === 1 ? " track" : " tracks");
    }
    els.list.innerHTML = state.tracks
      .map((track, i) => {
        const meta = trackMeta(track);
        return (
          '<li class="row" data-index="' +
          i +
          '">' +
          '<button class="row-btn" type="button" aria-label="Play track">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true">' +
          ICONS.play +
          "</svg></button>" +
          '<div class="row__main" role="button" tabindex="0">' +
          '<div class="row__title">' +
          escapeHtml(track.title || "Untitled") +
          "</div>" +
          (meta
            ? '<div class="row__meta">' + escapeHtml(meta) + "</div>"
            : "") +
          "</div>" +
          '<div class="row__time">' +
          EQ_HTML +
          '<span class="row__time-text">' +
          escapeHtml(track.duration || "--:--") +
          "</span>" +
          "</div>" +
          "</li>"
        );
      })
      .join("");
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function bindList() {
    if (!els.list) return;
    els.list.addEventListener("click", (e) => {
      const row = e.target.closest(".row");
      if (!row) return;
      const index = Number(row.getAttribute("data-index"));
      if (Number.isNaN(index)) return;
      if (index === state.index && isPlaying()) {
        audio.pause();
        return;
      }
      if (index === state.index && !isPlaying()) {
        togglePlay();
        return;
      }
      loadTrack(index, true);
    });
    els.list.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const main = e.target.closest(".row__main");
      if (!main) return;
      e.preventDefault();
      const row = main.closest(".row");
      const index = Number(row.getAttribute("data-index"));
      if (index === state.index) togglePlay();
      else loadTrack(index, true);
    });
  }

  function bindTransport() {
    if (els.play) els.play.addEventListener("click", togglePlay);
    if (els.miniPlay) els.miniPlay.addEventListener("click", togglePlay);
    if (els.prev) {
      els.prev.addEventListener("click", () => {
        if (audio.currentTime > 3) {
          applySeekTime(0);
          return;
        }
        loadTrack(state.index - 1, isPlaying() || state.index >= 0);
      });
    }
    if (els.next) els.next.addEventListener("click", () => nextTrack(true));
    if (els.miniNext) {
      els.miniNext.addEventListener("click", () => nextTrack(true));
    }

    if (els.seek) {
      const startSeek = (e) => {
        state.seeking = true;
        if (els.seekWrap) els.seekWrap.classList.add("is-dragging");
        seekFromEvent(e);
      };
      const moveSeek = (e) => {
        if (!state.seeking) return;
        if (e.cancelable) e.preventDefault();
        seekFromEvent(e);
      };
      const endSeek = () => {
        if (!state.seeking) return;
        state.seeking = false;
        if (els.seekWrap) els.seekWrap.classList.remove("is-dragging");
      };

      // Pointer Events first (covers mouse + touch + pen on modern browsers)
      if (window.PointerEvent) {
        els.seek.addEventListener("pointerdown", (e) => {
          els.seek.setPointerCapture && els.seek.setPointerCapture(e.pointerId);
          startSeek(e);
        });
        els.seek.addEventListener("pointermove", moveSeek);
        els.seek.addEventListener("pointerup", endSeek);
        els.seek.addEventListener("pointercancel", endSeek);
      } else {
        els.seek.addEventListener("mousedown", startSeek);
        els.seek.addEventListener("touchstart", startSeek, { passive: true });
        window.addEventListener("mousemove", moveSeek);
        window.addEventListener("touchmove", moveSeek, { passive: false });
        window.addEventListener("mouseup", endSeek);
        window.addEventListener("touchend", endSeek);
      }

      els.seek.addEventListener("keydown", (e) => {
        if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
        const step = e.shiftKey ? 15 : 5;
        const jump = (t) => {
          const target = seekTargetFromRatio(
            t / Math.max(0.001, audio.duration)
          );
          if (target == null) return;
          applySeekTime(target);
        };
        if (e.code === "ArrowRight" || e.code === "Right") {
          e.preventDefault();
          e.stopPropagation();
          jump(audio.currentTime + step);
        } else if (e.code === "ArrowLeft" || e.code === "Left") {
          e.preventDefault();
          e.stopPropagation();
          jump(audio.currentTime - step);
        } else if (e.code === "Home") {
          e.preventDefault();
          e.stopPropagation();
          jump(0);
        } else if (e.code === "End") {
          e.preventDefault();
          e.stopPropagation();
          jump(audio.duration);
        }
      });
    }

    const miniText = document.getElementById("mini-text");
    if (miniText) {
      const jump = () => {
        if (els.hero) {
          els.hero.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      };
      miniText.addEventListener("click", jump);
      miniText.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          jump();
        }
      });
    }

    if (els.volume) {
      els.volume.addEventListener("input", () => {
        const v = Number(els.volume.value);
        audio.volume = Number.isFinite(v) ? v : 1;
        audio.muted = audio.volume === 0;
        syncMuteUI();
      });
    }
    if (els.mute) {
      els.mute.addEventListener("click", () => {
        audio.muted = !audio.muted;
        if (!audio.muted && audio.volume === 0) {
          audio.volume = 0.85;
          if (els.volume) els.volume.value = "0.85";
        }
        syncMuteUI();
      });
    }
  }

  function nextTrack(autoplay) {
    if (!state.tracks.length) return;
    const next = state.index + 1;
    if (next >= state.tracks.length) {
      loadTrack(0, autoplay);
    } else {
      loadTrack(next, autoplay);
    }
  }

  function syncMuteUI() {
    if (els.mute) {
      const muted = audio.muted || audio.volume === 0;
      setIcon(els.mute.querySelector("svg"), muted ? "mute" : "volume");
      els.mute.setAttribute("aria-label", muted ? "Unmute" : "Mute");
    }
    if (els.volume) {
      els.volume.value = String(audio.muted ? 0 : audio.volume);
    }
  }

  function bindAudio() {
    audio.addEventListener("seeked", () => {
      // Allow natural end-of-track advance after a user seek settles.
      state.suppressEnded = false;
      syncProgress();
      syncPositionState();
    });
    audio.addEventListener("timeupdate", () => {
      syncProgress();
      syncPositionState();
    });
    audio.addEventListener("progress", syncBuffer);
    audio.addEventListener("loadedmetadata", () => {
      syncProgress();
      syncBuffer();
      syncPositionState();
      healSeekable();
    });
    audio.addEventListener("ended", () => {
      // Scrubbing/keyboard seek to the end fires "ended"; don't auto-advance.
      const recentSeek = Date.now() - state.lastSeekAt < 800;
      if (state.suppressEnded || state.seeking || recentSeek) {
        state.suppressEnded = false;
        applySeekTime(Math.max(0, (audio.duration || 0) - 0.08));
        syncPlayUI();
        return;
      }
      nextTrack(true);
    });
    audio.addEventListener("play", () => {
      syncPlayUI();
      syncPositionState();
    });
    audio.addEventListener("pause", () => {
      syncPlayUI();
      syncPositionState();
    });
    audio.addEventListener("error", () => {
      if (els.status) {
        els.status.textContent =
          "Could not load this track. Check the audio URL in tracks.json.";
      }
      syncPlayUI();
    });

    if ("mediaSession" in navigator) {
      try {
        navigator.mediaSession.setActionHandler("play", togglePlay);
        navigator.mediaSession.setActionHandler("pause", () => audio.pause());
        navigator.mediaSession.setActionHandler("previoustrack", () => {
          if (audio.currentTime > 3) applySeekTime(0);
          else loadTrack(state.index - 1, true);
        });
        navigator.mediaSession.setActionHandler("nexttrack", () =>
          nextTrack(true)
        );
        navigator.mediaSession.setActionHandler("seekto", (details) => {
          if (details && Number.isFinite(details.seekTime)) {
            applySeekTime(details.seekTime);
          }
        });
        navigator.mediaSession.setActionHandler("seekbackward", (details) => {
          const skip =
            details && Number.isFinite(details.seekOffset)
              ? details.seekOffset
              : 10;
          applySeekTime(Math.max(0, audio.currentTime - skip));
        });
        navigator.mediaSession.setActionHandler("seekforward", (details) => {
          const skip =
            details && Number.isFinite(details.seekOffset)
              ? details.seekOffset
              : 10;
          const dur = Number.isFinite(audio.duration) ? audio.duration : 0;
          applySeekTime(Math.min(dur, audio.currentTime + skip));
        });
      } catch (_) {
        /* ignore unsupported actions */
      }
    }
  }

  function bindKeys() {
    document.addEventListener("keydown", (e) => {
      const tag = (e.target && e.target.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.target && e.target.isContentEditable) return;

      if (e.target && e.target.closest && e.target.closest("#seek")) return;

      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
      } else if (e.code === "ArrowRight" && e.shiftKey) {
        e.preventDefault();
        nextTrack(true);
      } else if (e.code === "ArrowLeft" && e.shiftKey) {
        e.preventDefault();
        loadTrack(state.index - 1, true);
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        if (Number.isFinite(audio.duration)) {
          const target = seekTargetFromRatio(
            (audio.currentTime + 5) / Math.max(0.001, audio.duration)
          );
          if (target != null) applySeekTime(target);
        }
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        const target = seekTargetFromRatio(
          (audio.currentTime - 5) / Math.max(0.001, audio.duration || 1)
        );
        if (target != null) applySeekTime(target);
      } else if (e.key === "m" || e.key === "M") {
        audio.muted = !audio.muted;
        syncMuteUI();
      }
    });
  }

  function isHeroVisible() {
    if (!els.hero) return true;
    const rect = els.hero.getBoundingClientRect();
    return rect.bottom > 80 && rect.top < window.innerHeight - 40;
  }

  function bindMiniVisibility() {
    if (!els.mini || !els.hero) return;
    const io = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        const show =
          !entry.isIntersecting && (isPlaying() || state.index >= 0);
        els.mini.classList.toggle("is-visible", show);
      },
      { threshold: 0.15 }
    );
    io.observe(els.hero);

    audio.addEventListener("play", () => {
      if (isHeroVisible()) return;
      els.mini.classList.add("is-visible");
    });
  }

  function bindVideoRails() {
    const shells = document.querySelectorAll(".video-rail-shell");
    shells.forEach((shell) => {
      const rail = shell.querySelector(".video-rail");
      const thumb = shell.querySelector(".video-scroll__thumb");
      const track = shell.querySelector(".video-scroll__track");
      const wrap = shell.querySelector(".video-rail-wrap");
      const label = shell.querySelector(".video-scroll__label");
      const prev = shell.querySelector('[data-video-nav="-1"]');
      const next = shell.querySelector('[data-video-nav="1"]');
      if (!rail || !thumb || !track) return;

      const cards = Array.from(rail.querySelectorAll(".video-card"));

      function maxScroll() {
        return Math.max(1, rail.scrollWidth - rail.clientWidth);
      }

      function update() {
        const max = maxScroll();
        const ratio = rail.clientWidth / Math.max(rail.scrollWidth, 1);
        const thumbW = Math.max(12, Math.min(100, ratio * 100));
        const progress = Math.min(1, Math.max(0, rail.scrollLeft / max));
        const travel = 100 - thumbW;
        thumb.style.width = thumbW + "%";
        thumb.style.left = progress * travel + "%";
        const atStart = rail.scrollLeft <= 2;
        const atEnd = rail.scrollLeft >= max - 2;
        if (prev) prev.disabled = atStart;
        if (next) next.disabled = atEnd;

        if (wrap) {
          wrap.classList.toggle("is-overflow-start", !atStart);
          wrap.classList.toggle("is-overflow-end", !atEnd);
        }

        if (label) {
          const total = cards.length;
          if (!total) {
            label.textContent = "";
          } else if (max <= 1) {
            label.textContent = "1–" + total + " / " + total;
          } else {
            const railRect = rail.getBoundingClientRect();
            let first = -1;
            let last = -1;
            for (let i = 0; i < total; i++) {
              const r = cards[i].getBoundingClientRect();
              const visW =
                Math.min(r.right, railRect.right) - Math.max(r.left, railRect.left);
              if (visW <= r.width * 0.2) continue;
              if (first < 0) first = i;
              last = i;
            }
            if (first < 0) {
              first = 0;
              last = 0;
            }
            label.textContent =
              first === last
                ? first + 1 + " / " + total
                : first + 1 + "–" + (last + 1) + " / " + total;
          }
        }
      }

      function scrollByCards(dir) {
        const card = rail.querySelector(".video-card");
        const step = card ? card.getBoundingClientRect().width + 16 : rail.clientWidth * 0.8;
        rail.scrollBy({ left: dir * step, behavior: "smooth" });
      }

      if (prev) prev.addEventListener("click", () => scrollByCards(-1));
      if (next) next.addEventListener("click", () => scrollByCards(1));

      rail.addEventListener("scroll", update, { passive: true });
      window.addEventListener("resize", update);

      // Click / drag on the custom progress bar
      function seekTo(clientX) {
        const rect = track.getBoundingClientRect();
        const t = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
        const thumbRatio = rail.clientWidth / Math.max(rail.scrollWidth, 1);
        const thumbW = Math.max(0.18, Math.min(1, thumbRatio));
        const travel = 1 - thumbW;
        const left = (t * 1 - thumbW / 2) / travel;
        const clamped = Math.min(1, Math.max(0, left));
        rail.scrollLeft = clamped * maxScroll();
        update();
      }

      let dragging = false;
      const scrollUi = shell.querySelector(".video-scroll");
      track.addEventListener("pointerdown", (e) => {
        dragging = true;
        if (scrollUi) scrollUi.classList.add("is-dragging");
        track.setPointerCapture(e.pointerId);
        seekTo(e.clientX);
      });
      track.addEventListener("pointermove", (e) => {
        if (!dragging) return;
        seekTo(e.clientX);
      });
      const endDrag = (e) => {
        if (!dragging) return;
        dragging = false;
        if (scrollUi) scrollUi.classList.remove("is-dragging");
        try {
          track.releasePointerCapture(e.pointerId);
        } catch (_) {}
      };
      track.addEventListener("pointerup", endDrag);
      track.addEventListener("pointercancel", endDrag);

      track.tabIndex = 0;
      track.addEventListener("keydown", (e) => {
        const step = (rail.querySelector(".video-card")?.getBoundingClientRect().width || 220) + 16;
        if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
          e.preventDefault();
          rail.scrollBy({ left: -step, behavior: "smooth" });
        } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
          e.preventDefault();
          rail.scrollBy({ left: step, behavior: "smooth" });
        } else if (e.key === "Home") {
          e.preventDefault();
          rail.scrollTo({ left: 0, behavior: "smooth" });
        } else if (e.key === "End") {
          e.preventDefault();
          rail.scrollTo({ left: maxScroll(), behavior: "smooth" });
        }
      });

      // Shift + wheel / trackpad horizontal already works; also map vertical wheel when hovering
      rail.addEventListener(
        "wheel",
        (e) => {
          if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && e.shiftKey) {
            e.preventDefault();
            rail.scrollLeft += e.deltaY;
          }
        },
        { passive: false }
      );

      // Drag-to-scroll on the rail itself (pointer, desktop)
      let railDrag = null;
      rail.addEventListener("pointerdown", (e) => {
        if (e.pointerType === "touch") return;
        if (e.target.closest("a, button")) return;
        railDrag = { x: e.clientX, left: rail.scrollLeft, moved: false };
      });
      window.addEventListener("pointermove", (e) => {
        if (!railDrag) return;
        const dx = e.clientX - railDrag.x;
        if (Math.abs(dx) > 4) railDrag.moved = true;
        if (railDrag.moved) {
          rail.scrollLeft = railDrag.left - dx;
          e.preventDefault();
        }
      });
      window.addEventListener("pointerup", () => {
        railDrag = null;
      });

      update();
      // thumbnails may shift layout as they load
      if (wrap) {
        wrap.querySelectorAll("img").forEach((img) => {
          if (!img.complete) img.addEventListener("load", update, { once: true });
        });
      }
    });
  }

  async function boot() {
    bindAudio();
    bindTransport();
    bindList();
    bindKeys();
    bindMiniVisibility();
    bindVideoRails();
    syncMuteUI();

    try {
      const res = await fetch("/audio/tracks.json", { cache: "no-cache" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      state.base = data.audioBase || data.base || "";
      state.tracks = Array.isArray(data.tracks) ? data.tracks : [];
    } catch (err) {
      state.tracks = [];
      if (els.status) {
        els.status.textContent = "Could not load tracks.json";
      }
    }

    renderList();
    if (state.tracks.length) {
      loadTrack(0, false);
    } else {
      if (els.heroTitle) els.heroTitle.textContent = "Coming soon";
      if (els.heroSub) els.heroSub.textContent = "Add tracks in audio/tracks.json";
      if (els.heroArt) {
        mountHeroArt(
          '<div class="hero-art__fallback" aria-hidden="true">' +
            '<div class="vinyl"></div>' +
            '<span class="art-letter">R</span></div>'
        );
      }
      [els.play, els.prev, els.next].forEach((btn) => {
        if (btn) btn.disabled = true;
      });
    }
    state.ready = true;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
