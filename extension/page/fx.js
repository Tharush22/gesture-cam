// Draws all the effects on top of each camera frame, using a 2D canvas:
// confetti, privacy blur, bang, fog mirror, Rasengan and bad connection.
//
// This runs inside the meeting page next to camera.js, because that's where the camera frames are.
// main.js does the hand tracking and sends commands here, like "confetti".
//
// Each animation is worked out from how long ago it started, so it looks the same
// no matter how often frames get drawn.
(() => {
  const app = (globalThis[Symbol.for("gesture-cam")] ??= {});
  if (app.fx) return;

  const clock = () => performance.now() / 1000;
  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  const easeOut = (t) => 1 - (1 - t) ** 3;
  const rand = (a, b) => a + Math.random() * (b - a);

  // How far something has moved after t seconds, with starting speed v, air drag k and gravity g.
  const drift = (v, k, t) => (v * (1 - Math.exp(-k * t))) / k;
  const fall = (g, k, t) => g * (t / k - (1 - Math.exp(-k * t)) / (k * k));

  const CONFETTI_COLORS = ["#ff4d6d", "#ffd166", "#06d6a0", "#4cc9f0", "#b388ff", "#ff9f1c", "#ffffff"];
  const PRIVACY_FADE = 0.35;
  const SHAKE_SECONDS = 0.45;
  const FLASH_SECONDS = 0.12;
  const MUZZLE_SECONDS = 0.2;
  const BANG_TEXT_SECONDS = 0.8;

  // Positions go from 0 to 1 across the picture. Sizes and speeds are measured in picture heights,
  // so the effects look the same at any camera size.
  const state = {
    confetti: [],
    smoke: [],
    bangs: [],
    shakeAt: -1e9,
    privacyOn: false,
    privacyAt: -1e9,
  };

  // ------------------------------------------------------------------ commands

  function confetti(x, y) {
    const t0 = clock();
    for (let i = 0; i < 160; i++) {
      const angle = -Math.PI / 2 + rand(-0.85, 0.85);
      const speed = rand(0.55, 1.6);
      state.confetti.push({
        t0: t0 + rand(0, 0.08), x, y,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        size: rand(0.012, 0.022), ratio: rand(0.4, 0.7),
        spin: rand(-10, 10), angle: rand(0, Math.PI * 2),
        tumble: rand(4, 11), phase: rand(0, Math.PI * 2),
        color: CONFETTI_COLORS[(Math.random() * CONFETTI_COLORS.length) | 0],
        life: rand(2.4, 3.2),
      });
    }
  }

  function bang(x, y, dx, dy) {
    const t0 = clock();
    const n = Math.hypot(dx, dy) || 1;
    [dx, dy] = [dx / n, dy / n];
    // The spikes of the muzzle flash. Picked once per shot so they don't flicker.
    const spikes = Array.from({ length: 7 }, (_, i) => ({ angle: (i - 3) * 0.32 + rand(-0.08, 0.08), length: rand(0.5, 1) }));
    state.bangs.push({ t0, x, y, dx, dy, spikes, tilt: rand(-0.25, 0.1) });
    state.shakeAt = t0;
    for (let i = 0; i < 16; i++) {
      const speed = rand(0.1, 0.35);
      state.smoke.push({
        t0: t0 + rand(0, 0.15), x, y,
        vx: dx * speed + rand(-0.05, 0.05), vy: dy * speed + rand(-0.05, 0.05),
        rise: rand(0.05, 0.12), r0: rand(0.015, 0.03), r1: rand(0.07, 0.12),
        life: rand(1.2, 2), alpha: rand(0.35, 0.55),
      });
    }
  }

  function privacy(on) {
    if (on === state.privacyOn) return;
    // Start the fade from where the last one stopped, so switching quickly doesn't jump.
    const t = clock();
    const progress = clamp01((t - state.privacyAt) / PRIVACY_FADE);
    state.privacyOn = on;
    state.privacyAt = t - (1 - progress) * PRIVACY_FADE;
  }

  function privacyAmount(t) {
    const k = easeOut(clamp01((t - state.privacyAt) / PRIVACY_FADE));
    return state.privacyOn ? k : 1 - k;
  }

  // ------------------------------------------------------------------ drawing

  const main = { canvas: null, ctx: null };
  const small = { canvas: null, ctx: null };

  function context(slot, w, h, alpha = false) {
    if (!slot.canvas) {
      slot.canvas = new OffscreenCanvas(w, h);
      slot.ctx = slot.canvas.getContext("2d", { alpha });
    } else if (slot.canvas.width !== w || slot.canvas.height !== h) {
      slot.canvas.width = w;
      slot.canvas.height = h;
    }
    return slot.ctx;
  }

  function prune(t) {
    state.confetti = state.confetti.filter((p) => t - p.t0 < p.life);
    state.smoke = state.smoke.filter((p) => t - p.t0 < p.life);
    state.bangs = state.bangs.filter((b) => t - b.t0 < BANG_TEXT_SECONDS);
  }

  function drawConfetti(ctx, t, w, h) {
    for (const p of state.confetti) {
      const age = t - p.t0;
      if (age < 0) continue;
      const x = p.x * w + drift(p.vx, 1.6, age) * h;
      const y = p.y * h + (drift(p.vy, 1.6, age) + fall(1.2, 1.6, age)) * h;
      const s = p.size * h;
      ctx.save();
      ctx.globalAlpha = clamp01((p.life - age) / 0.5);
      ctx.translate(x, y);
      ctx.rotate(p.angle + p.spin * age);
      ctx.scale(1, Math.cos(p.phase + p.tumble * age));  // squash it to make it look like it's flipping
      ctx.fillStyle = p.color;
      ctx.fillRect(-s / 2, (-s * p.ratio) / 2, s, s * p.ratio);
      ctx.restore();
    }
  }

  function drawSmoke(ctx, t, w, h) {
    for (const p of state.smoke) {
      const age = t - p.t0;
      if (age < 0) continue;
      const k = age / p.life;
      const x = p.x * w + drift(p.vx, 2.5, age) * h;
      const y = p.y * h + (drift(p.vy, 2.5, age) - p.rise * age) * h;
      const r = (p.r0 + (p.r1 - p.r0) * easeOut(k)) * h;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const a = p.alpha * (1 - k) * clamp01(age / 0.08);
      g.addColorStop(0, `rgba(140,140,148,${a})`);
      g.addColorStop(1, "rgba(140,140,148,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawBangs(ctx, t, w, h) {
    for (const b of state.bangs) {
      const age = t - b.t0;
      const x = b.x * w, y = b.y * h;
      const heading = Math.atan2(b.dy, b.dx);

      if (age < MUZZLE_SECONDS) {
        const k = 1 - age / MUZZLE_SECONDS;
        const reach = 0.16 * h * (0.6 + 0.4 * k);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(heading);
        ctx.globalCompositeOperation = "lighter";
        ctx.fillStyle = `rgba(255,190,60,${0.9 * k})`;
        ctx.beginPath();
        for (const s of b.spikes) {
          const half = 0.07;
          ctx.moveTo(0, 0);
          ctx.lineTo(Math.cos(s.angle - half) * reach * 0.3, Math.sin(s.angle - half) * reach * 0.3);
          ctx.lineTo(Math.cos(s.angle) * reach * s.length, Math.sin(s.angle) * reach * s.length);
          ctx.lineTo(Math.cos(s.angle + half) * reach * 0.3, Math.sin(s.angle + half) * reach * 0.3);
          ctx.closePath();
        }
        ctx.fill();
        const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, reach * 0.45);
        glow.addColorStop(0, `rgba(255,255,235,${k})`);
        glow.addColorStop(1, "rgba(255,200,80,0)");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(0, 0, reach * 0.45, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Comic book style "BANG!" text in front of the finger.
      const pop = clamp01(age / 0.12);
      const scale = pop < 1 ? 0.4 + 0.8 * easeOut(pop) : 1.2 - 0.2 * clamp01((age - 0.12) / 0.15);
      const alpha = clamp01((BANG_TEXT_SECONDS - age) / 0.3);
      const size = 0.085 * h;
      const tx = Math.min(w - size * 2.2, Math.max(size * 2.2, x + b.dx * 0.16 * h));
      const ty = Math.min(h - size, Math.max(size, y + b.dy * 0.16 * h - 0.05 * h));
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(tx, ty);
      ctx.rotate(b.tilt);
      ctx.scale(scale, scale);
      ctx.font = `900 ${size}px Impact, "Arial Black", system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineJoin = "round";
      ctx.lineWidth = size * 0.16;
      ctx.strokeStyle = "#111";
      ctx.strokeText("BANG!", 0, 0);
      ctx.fillStyle = "#ffd60a";
      ctx.fillText("BANG!", 0, 0);
      ctx.restore();
    }
  }

  function drawPrivacyBadge(ctx, amount, w, h) {
    const size = 0.04 * h;
    const text = "Privacy mode";
    ctx.save();
    ctx.globalAlpha = amount;
    ctx.font = `600 ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    const tw = ctx.measureText(text).width;
    const pw = tw + size * 1.6, ph = size * 1.9;
    const px = (w - pw) / 2, py = h - ph - 0.05 * h;
    ctx.fillStyle = "rgba(10,12,20,0.7)";
    ctx.beginPath();
    ctx.roundRect(px, py, pw, ph, ph / 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, w / 2, py + ph / 2);
    ctx.restore();
  }

  // ------------------------------------------------------------------ fog mirror
  //
  // The fog is a blurry, whiter copy of the picture laid on top of the normal one.
  // A "mask" says where the fog is: solid means foggy, empty means clear.
  //   - Drawing (index finger) cuts lines out of the mask.
  //   - Erasing (middle finger) paints the mask back in.
  //   - Every quarter second a thin layer of fog is added everywhere, so lines slowly fog over again.
  // The mask stays between frames, which is how your drawing builds up.

  const FOG_IN_SECONDS = 1.2, FOG_OUT_SECONDS = 0.8;
  const REFOG_SECONDS = 5;   // lines are almost fully fogged over after about 15 seconds
  const REFOG_STEP = 0.25;   // add fog every 0.25 s (thinner layers would be too faint to show up)
  const PEN_WIDTH = 0.035, ERASER_WIDTH = 0.1;  // compared to the picture's height
  // A line ends when you stop pointing. This is just a backup in case that message never comes.
  // It's long because on a slow computer the fingertip updates can be far apart.
  const PEN_GAP = 1.0;
  // (The fingertip is already smoothed by smoothing.js.)

  const fog = { on: false, at: -1e9, from: 0, pen: null, refogAt: 0 };
  const mask = { canvas: null, ctx: null };
  const layer = { canvas: null, ctx: null };
  let condensation = null;  // a pattern of tiny water droplets, made once

  function fogAmount(t) {
    const k = easeOut(clamp01((t - fog.at) / (fog.on ? FOG_IN_SECONDS : FOG_OUT_SECONDS)));
    return fog.on ? fog.from + (1 - fog.from) * k : fog.from * (1 - k);
  }

  function setFog(on) {
    if (on === fog.on) return;
    const t = clock();
    fog.from = fogAmount(t);  // keep going from wherever the fade was
    if (on && fog.from < 0.01) mask.canvas = null;  // new fog, so start fully fogged
    fog.on = on;
    fog.at = t;
    fog.pen = null;
  }

  /** Makes the mask (half the picture's size) if it doesn't exist yet, fully fogged. */
  function ensureMask(w, h, t) {
    const mw = Math.max(1, Math.round(w / 2)), mh = Math.max(1, Math.round(h / 2));
    if (mask.canvas && mask.canvas.width === mw && mask.canvas.height === mh) return;
    mask.canvas = null;  // if the camera size changed, the old drawing can't be kept
    const m = context(mask, mw, mh, true);
    m.fillStyle = "#fff";
    m.fillRect(0, 0, mw, mh);
    fog.refogAt = t;
  }

  /** The pen moved. mode is "draw", "erase", or null when the pen is lifted. */
  function fogPen(mode, x, y) {
    const t = clock();
    const pen = fog.pen;
    if (!mode || !fog.on || !mask.canvas) {
      if (pen?.prev && mask.canvas) penStroke(pen.mode, (m) => { m.moveTo(...mid(pen.prev, pen.last)); m.lineTo(...pen.last); });
      fog.pen = null;
      return;
    }
    const point = [x * mask.canvas.width, y * mask.canvas.height];
    const joined = pen && pen.mode === mode && t - pen.t < PEN_GAP;
    if (!joined) {
      // Start of a new line, so just draw a dot.
      // (A line with no length might not get drawn, so make it very slightly longer.)
      penStroke(mode, (m) => { m.moveTo(...point); m.lineTo(point[0] + 0.01, point[1]); });
      fog.pen = { mode, prev: null, last: point, t };
      return;
    }
    // Draw a smooth curve through the points instead of straight lines between them.
    // Each piece goes from halfway between two points to halfway between the next two.
    const { prev, last } = pen;
    penStroke(mode, (m) => {
      m.moveTo(...(prev ? mid(prev, last) : last));
      m.quadraticCurveTo(...last, ...mid(last, point));
    });
    fog.pen = { mode, prev: last, last: point, t };
  }

  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

  /** Draws a line on the mask. "draw" clears the fog, "erase" puts it back. */
  function penStroke(mode, path) {
    const m = mask.ctx;
    m.save();
    m.globalCompositeOperation = mode === "draw" ? "destination-out" : "source-over";
    m.strokeStyle = "#fff";
    m.lineWidth = (mode === "draw" ? PEN_WIDTH : ERASER_WIDTH) * mask.canvas.height;
    m.lineCap = m.lineJoin = "round";
    m.beginPath();
    path(m);
    m.stroke();
    m.restore();
  }

  function makeCondensation() {
    const size = 256;
    const c = new OffscreenCanvas(size, size), g = c.getContext("2d");
    for (let i = 0; i < 900; i++) {
      const r = Math.random() < 0.9 ? rand(0.4, 1.2) : rand(1.5, 3);
      g.fillStyle = `rgba(255,255,255,${rand(0.15, 0.5)})`;
      g.beginPath();
      g.arc(rand(0, size), rand(0, size), r, 0, Math.PI * 2);
      g.fill();
    }
    return c;
  }

  /** Puts the fog on top of the picture (including the privacy blur, if it's on). */
  function drawFog(ctx, amount, t, w, h) {
    ensureMask(w, h, t);
    const lw = mask.canvas.width, lh = mask.canvas.height;

    if (t - fog.refogAt >= REFOG_STEP) {
      const m = mask.ctx;
      m.globalAlpha = 1 - Math.exp(-Math.min(1, t - fog.refogAt) / REFOG_SECONDS);
      m.fillStyle = "#fff";
      m.fillRect(0, 0, lw, lh);
      m.globalAlpha = 1;
      fog.refogAt = t;
    }

    const f = context(layer, lw, lh, true);
    f.globalCompositeOperation = "copy";
    f.filter = `blur(${Math.max(2, lh / 60)}px)`;
    f.drawImage(ctx.canvas, 0, 0, lw, lh);
    f.filter = "none";
    f.globalCompositeOperation = "source-over";
    f.fillStyle = "rgba(226,232,238,0.55)";
    f.fillRect(0, 0, lw, lh);
    condensation ??= makeCondensation();
    f.globalAlpha = 0.6;
    f.fillStyle = f.createPattern(condensation, "repeat");
    f.fillRect(0, 0, lw, lh);
    // Only keep the fog where the mask says, and fade it while it's coming in.
    f.globalCompositeOperation = "destination-in";
    f.globalAlpha = amount;
    f.filter = "blur(1px)";  // softer edges on the lines
    f.drawImage(mask.canvas, 0, 0);
    f.filter = "none";
    f.globalAlpha = 1;
    f.globalCompositeOperation = "source-over";

    ctx.drawImage(layer.canvas, 0, 0, w, h);
  }

  // ------------------------------------------------------------------ Rasengan
  //
  // A spinning ball of light above your hand. It has a glowing middle, spinning streaks at
  // different angles (so it looks round), a ring around the outside and sparks flying around it.
  // Hand tracking updates less often than the video, so between updates the ball slides toward
  // your hand to keep it smooth. When the updates stop, it shrinks away.

  const ORB_GROW = 0.35, ORB_SHRINK = 0.3;  // in seconds
  const ORB_HOLD = 0.6;    // keep showing it this long after the last update
  const ORB_FOLLOW = 14;   // how fast it follows your hand (higher = faster)

  const orb = { x: 0.5, y: 0.5, size: 0.2, target: null, shownAt: -1e9, until: -1e9, lastT: 0, arcs: null, sparks: null };

  function orbAmount(t) {
    const grow = easeOut(clamp01((t - orb.shownAt) / ORB_GROW));
    const shrink = 1 - clamp01((t - orb.until) / ORB_SHRINK);
    return grow * shrink;
  }

  /** Where your hand is now (x, y) and how big it is. */
  function orbUpdate(x, y, size, hold = ORB_HOLD) {
    const t = clock();
    if (orbAmount(t) <= 0) {  // just appearing, so start right at the hand
      Object.assign(orb, { x, y, size, shownAt: t, lastT: t });
    }
    orb.target = { x, y, size };
    orb.until = t + hold;
  }

  function makeOrbParts() {
    orb.arcs = Array.from({ length: 16 }, () => ({
      r: rand(0.35, 1), tilt: rand(0, Math.PI), squash: rand(0.25, 1), spin: rand(7, 15),
      start: rand(0, Math.PI * 2), len: rand(0.8, 2.2), width: rand(0.025, 0.07), alpha: rand(0.35, 0.85),
    }));
    orb.sparks = Array.from({ length: 24 }, () => ({
      r: rand(0.9, 1.5), speed: rand(3, 8), phase: rand(0, Math.PI * 2), tilt: rand(0, Math.PI), size: rand(0.02, 0.05),
    }));
  }

  function drawOrb(ctx, amount, t, h) {
    const w = ctx.canvas.width;
    // Slide toward the hand.
    const dt = Math.min(0.1, Math.max(0, t - orb.lastT));
    orb.lastT = t;
    if (orb.target) {
      const k = 1 - Math.exp(-ORB_FOLLOW * dt);
      orb.x += (orb.target.x - orb.x) * k;
      orb.y += (orb.target.y - orb.y) * k;
      orb.size += (orb.target.size - orb.size) * k;
    }
    if (!orb.arcs) makeOrbParts();

    const cx = orb.x * w, cy = orb.y * h;
    const R = orb.size * h * 0.55 * (0.3 + 0.7 * amount) * (1 + 0.03 * Math.sin(t * 37));  // small flicker
    ctx.save();
    ctx.globalCompositeOperation = "lighter";  // overlapping light gets brighter
    ctx.globalAlpha = Math.min(1, amount * 1.2);

    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 2.4);
    glow.addColorStop(0, "rgba(70,160,255,0.45)");
    glow.addColorStop(0.4, "rgba(40,120,255,0.18)");
    glow.addColorStop(1, "rgba(40,120,255,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(cx - R * 2.4, cy - R * 2.4, R * 4.8, R * 4.8);

    const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
    core.addColorStop(0, "rgba(255,255,255,0.95)");
    core.addColorStop(0.35, "rgba(190,235,255,0.85)");
    core.addColorStop(0.75, "rgba(70,160,255,0.45)");
    core.addColorStop(1, "rgba(40,110,255,0)");
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();

    ctx.lineCap = "round";
    for (const a of orb.arcs) {
      const from = a.start + a.spin * t;
      ctx.strokeStyle = `rgba(210,240,255,${a.alpha})`;
      ctx.lineWidth = a.width * R;
      ctx.beginPath();
      ctx.ellipse(cx, cy, a.r * R, a.r * R * a.squash, a.tilt, from, from + a.len);
      ctx.stroke();
    }

    ctx.strokeStyle = "rgba(160,215,255,0.5)";
    ctx.lineWidth = R * 0.05;
    for (let k = 0; k < 3; k++) {
      const from = -t * 9 + k * 2.1;
      ctx.beginPath();
      ctx.ellipse(cx, cy, R * 1.35, R * 0.42, -0.2, from, from + 1.3);
      ctx.stroke();
    }

    ctx.fillStyle = "rgba(220,245,255,0.9)";
    for (const s of orb.sparks) {
      const angle = s.phase + s.speed * t;
      const ex = Math.cos(angle) * s.r * R, ey = Math.sin(angle) * s.r * R * 0.45;
      const x = cx + ex * Math.cos(s.tilt) - ey * Math.sin(s.tilt);
      const y = cy + ex * Math.sin(s.tilt) + ey * Math.cos(s.tilt);
      ctx.beginPath();
      ctx.arc(x, y, s.size * R, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // ------------------------------------------------------------------ bad connection
  //
  // Makes it look like your internet is going out:
  //   1. Lagging: choppy and blocky. The picture only updates now and then, gets worse over time,
  //      and sometimes only part of it updates.
  //   2. Frozen: stuck on the last picture.
  //   3. Dead: black, like the camera stopped working.
  // Turning it off "reconnects": blocky for a moment, then back to normal.

  const LAG_SECONDS = 5;       // how long the choppy stage lasts
  const FREEZE_SECONDS = 6;    // then how long it stays frozen before going black
  const RECOVER_SECONDS = 0.6; // how long it's blocky when it comes back
  const MACROBLOCK = 32;       // size of the patches that update, in pixels

  const lag = { on: false, at: -1e9, offAt: -1e9, holdUntil: 0 };
  const held = { canvas: null, ctx: null, ready: false };  // the picture people are stuck on
  const lowRes = { canvas: null, ctx: null };

  function setLag(on) {
    if (on === lag.on) return;
    lag.on = on;
    if (on) {
      lag.at = clock();
      held.ready = false;
    } else {
      lag.offAt = clock();
    }
  }

  /** Which stage it's in: "lag", "freeze", "dead", "recover", or null if it's off. */
  function lagStage(t) {
    if (!lag.on) return t - lag.offAt < RECOVER_SECONDS ? "recover" : null;
    const age = t - lag.at;
    return age < LAG_SECONDS ? "lag" : age < LAG_SECONDS + FREEZE_SECONDS ? "freeze" : "dead";
  }

  /** Draws the frame at low quality by shrinking it and then stretching it back up. */
  function drawBlocky(ctx, frame, w, h, block) {
    if (block <= 1.5) {
      ctx.drawImage(frame, 0, 0, w, h);
      return;
    }
    const sw = Math.max(1, Math.round(w / block)), sh = Math.max(1, Math.round(h / block));
    context(lowRes, sw, sh).drawImage(frame, 0, 0, sw, sh);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(lowRes.canvas, 0, 0, sw, sh, 0, 0, w, h);
    ctx.imageSmoothingEnabled = true;
  }

  /** Draws the bad connection picture for right now. */
  function drawLag(ctx, frame, stage, t, w, h) {
    if (stage === "dead") {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, w, h);
      return;
    }
    if (stage === "recover") {
      const k = (t - lag.offAt) / RECOVER_SECONDS;
      drawBlocky(ctx, frame, w, h, 1 + (1 - k) * 24);
      return;
    }

    if (!held.canvas || held.canvas.width !== w || held.canvas.height !== h) held.ready = false;
    const hc = context(held, w, h);
    if (!held.ready || (stage === "lag" && t >= lag.holdUntil)) {
      // Let a new picture through.
      const age = t - lag.at;
      const block = Math.random() < 0.6 ? rand(6, 10 + 4 * age) : 1;  // often blocky, worse over time
      if (held.ready && Math.random() < 0.4) {
        // Only update some patches and leave the rest old, so it looks smeared.
        hc.save();
        hc.beginPath();
        for (let i = 0; i < 4; i++) {
          const bw = MACROBLOCK * Math.round(rand(3, 12)), bh = MACROBLOCK * Math.round(rand(2, 6));
          const bx = MACROBLOCK * Math.floor(rand(0, w / MACROBLOCK)), by = MACROBLOCK * Math.floor(rand(0, h / MACROBLOCK));
          hc.rect(bx, by, bw, bh);
        }
        hc.clip();
        drawBlocky(hc, frame, w, h, block);
        hc.restore();
      } else {
        drawBlocky(hc, frame, w, h, block);
      }
      held.ready = true;
      lag.holdUntil = t + rand(0.1, 0.25 + 0.12 * age);  // gets choppier over time
    }
    ctx.drawImage(held.canvas, 0, 0);
  }

  // ------------------------------------------------------------------ every frame

  /**
   * Draws the effects that are on onto a camera frame. If nothing is on, it returns the same frame
   * (most of the time). Otherwise it returns a new frame.
   */
  function render(frame) {
    const t = clock();
    prune(t);
    const privacy = privacyAmount(t);
    const shakeAge = t - state.shakeAt;
    const shaking = shakeAge < SHAKE_SECONDS;
    const fogged = fogAmount(t);
    const orbShown = orbAmount(t);
    const stage = lagStage(t);
    const busy = stage || privacy > 0.001 || fogged > 0.001 || orbShown > 0 || shaking || state.confetti.length || state.smoke.length || state.bangs.length;
    if (!busy) return frame;

    const w = frame.displayWidth, h = frame.displayHeight;
    const ctx = context(main, w, h);

    // Bad connection hides all the other effects, because confetti moving over a frozen picture
    // would give it away. They come back when it's turned off.
    if (stage) {
      drawLag(ctx, frame, stage, t, w, h);
      return new VideoFrame(main.canvas, { timestamp: frame.timestamp, duration: frame.duration ?? undefined, alpha: "discard" });
    }

    // Screen shake: move the picture around, zoomed in a bit so the edges don't show.
    let rect = [0, 0, w, h];
    if (shaking) {
      const k = 1 - shakeAge / SHAKE_SECONDS;
      const amp = 0.02 * h * k * k;
      const pad = 0.025 * h;
      const ox = amp * Math.sin(shakeAge * 97), oy = amp * Math.cos(shakeAge * 71 + 1);
      rect = [ox - pad, oy - pad, w + 2 * pad, h + 2 * pad];
    }

    if (privacy > 0.001) {
      // Pixelate: shrink the picture, then stretch it back up so it looks blocky.
      const block = 1 + privacy * (w / 22 - 1);
      const sw = Math.max(1, Math.round(w / block)), sh = Math.max(1, Math.round(h / block));
      context(small, sw, sh).drawImage(frame, 0, 0, sw, sh);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(small.canvas, 0, 0, sw, sh, ...rect);
      ctx.imageSmoothingEnabled = true;
      ctx.fillStyle = `rgba(12,14,24,${0.3 * privacy})`;
      ctx.fillRect(0, 0, w, h);
    } else {
      ctx.drawImage(frame, ...rect);
    }

    if (fogged > 0.001) drawFog(ctx, fogged, t, w, h);
    drawSmoke(ctx, t, w, h);
    drawConfetti(ctx, t, w, h);
    if (orbShown > 0) drawOrb(ctx, orbShown, t, h);
    drawBangs(ctx, t, w, h);

    const flashAge = shakeAge;  // the white flash starts at the same time as the bang
    if (flashAge < FLASH_SECONDS) {
      ctx.fillStyle = `rgba(255,255,255,${0.45 * (1 - flashAge / FLASH_SECONDS)})`;
      ctx.fillRect(0, 0, w, h);
    }
    if (privacy > 0.001) drawPrivacyBadge(ctx, privacy, w, h);

    return new VideoFrame(main.canvas, {
      timestamp: frame.timestamp,
      duration: frame.duration ?? undefined,
      alpha: "discard",
    });
  }

  /** Runs a command from main.js, like { name: "confetti", x, y }. */
  function run(cmd) {
    if (cmd.name === "confetti") confetti(cmd.x, cmd.y);
    else if (cmd.name === "bang") bang(cmd.x, cmd.y, cmd.dx, cmd.dy);
    else if (cmd.name === "privacy") privacy(!!cmd.on);
    else if (cmd.name === "fog") setFog(!!cmd.on);
    else if (cmd.name === "fogPen") fogPen(cmd.mode, cmd.x, cmd.y);
    else if (cmd.name === "orb") orbUpdate(cmd.x, cmd.y, cmd.size, cmd.hold);
    else if (cmd.name === "lag") setLag(!!cmd.on);
  }

  app.fx = { render, run };
})();
