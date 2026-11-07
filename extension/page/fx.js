// The effects engine. It draws on top of each camera frame with a plain 2D canvas.
//
// This file runs in the meeting page's own JavaScript world (see manifest.json), next to
// page/camera.js, because that is where the camera frames are. The hand tracking runs in the
// extension's world (content/) and sends commands here: confetti, privacy, bang.
//
// Every animation is a pure function of time since it started, so it looks the same no matter
// how many camera streams are being drawn or how often.
(() => {
  const app = (globalThis[Symbol.for("gesture-cam")] ??= {});
  if (app.fx) return;

  const clock = () => performance.now() / 1000;
  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  const easeOut = (t) => 1 - (1 - t) ** 3;
  const rand = (a, b) => a + Math.random() * (b - a);

  // Position under drag k and gravity g, in closed form: start speed v, after t seconds.
  const drift = (v, k, t) => (v * (1 - Math.exp(-k * t))) / k;
  const fall = (g, k, t) => g * (t / k - (1 - Math.exp(-k * t)) / (k * k));

  const CONFETTI_COLORS = ["#ff4d6d", "#ffd166", "#06d6a0", "#4cc9f0", "#b388ff", "#ff9f1c", "#ffffff"];
  const PRIVACY_FADE = 0.35;
  const SHAKE_SECONDS = 0.45;
  const FLASH_SECONDS = 0.12;
  const MUZZLE_SECONDS = 0.2;
  const BANG_TEXT_SECONDS = 0.8;

  // Positions: x is a fraction of the frame width, y a fraction of its height. Speeds and sizes are
  // in frame heights, so the effects look the same at any resolution or aspect ratio.
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
    // Spikes of the muzzle flash, fixed per shot so it doesn't flicker between streams.
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
    // Start the fade from wherever the last one got to, so a quick double toggle doesn't jump.
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

  function context(slot, w, h) {
    if (!slot.canvas) {
      slot.canvas = new OffscreenCanvas(w, h);
      slot.ctx = slot.canvas.getContext("2d", { alpha: false });
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
      ctx.scale(1, Math.cos(p.phase + p.tumble * age));  // tumbling: the piece turns edge-on and back
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

      // Comic-book "BANG!" that pops out ahead of the barrel.
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

  /**
   * Draws the active effects on a camera frame. Returns the same frame untouched when nothing is
   * happening (the cheap, common case), otherwise a new frame; the caller closes the old one.
   */
  function render(frame) {
    const t = clock();
    prune(t);
    const privacy = privacyAmount(t);
    const shakeAge = t - state.shakeAt;
    const shaking = shakeAge < SHAKE_SECONDS;
    const busy = privacy > 0.001 || shaking || state.confetti.length || state.smoke.length || state.bangs.length;
    if (!busy) return frame;

    const w = frame.displayWidth, h = frame.displayHeight;
    const ctx = context(main, w, h);

    // Screen shake: offset the picture, zoomed in slightly so the edges never show.
    let rect = [0, 0, w, h];
    if (shaking) {
      const k = 1 - shakeAge / SHAKE_SECONDS;
      const amp = 0.02 * h * k * k;
      const pad = 0.025 * h;
      const ox = amp * Math.sin(shakeAge * 97), oy = amp * Math.cos(shakeAge * 71 + 1);
      rect = [ox - pad, oy - pad, w + 2 * pad, h + 2 * pad];
    }

    if (privacy > 0.001) {
      // Pixelate: shrink the picture, then blow it back up without smoothing.
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

    drawSmoke(ctx, t, w, h);
    drawConfetti(ctx, t, w, h);
    drawBangs(ctx, t, w, h);

    const flashAge = shakeAge;  // the white flash starts with the shot
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

  /** A command from the extension: { name: "confetti" | "bang" | "privacy", ... }. */
  function run(cmd) {
    if (cmd.name === "confetti") confetti(cmd.x, cmd.y);
    else if (cmd.name === "bang") bang(cmd.x, cmd.y, cmd.dx, cmd.dy);
    else if (cmd.name === "privacy") privacy(!!cmd.on);
  }

  app.fx = { render, run };
})();
