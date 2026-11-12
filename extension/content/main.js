// The extension's side, running in its own isolated world on the meeting page.
//
// page/camera.js (in the page's world) hands us a private message port, then sends small copies of
// camera frames through it. We find hands in them, turn hand shapes into gestures, and send effect
// commands back for page/fx.js to draw. Two effects follow your hand continuously instead of
// firing once: the fog mirror's pen (index finger draws, middle finger erases) and the Rasengan,
// which hovers over a hand laid flat.
import { classify, Latch } from "./gestures.js";
import { EFFECTS, Panel } from "./panel.js";
import { OneEuroFilter } from "./smoothing.js";
import { loadHandTracker } from "./tracker.js";

const url = (path) => chrome.runtime.getURL(path);
const MIN_FRAME_GAP_MS = 33;  // look for hands at most ~30 times a second

const settings = await chrome.storage.local.get({ confetti: true, privacy: true, bang: true, fog: true, orb: true, folded: false });

// How long each gesture must be held to fire, and how long it must be gone before it can fire again.
// (The flat hand has no latch: the Rasengan stays for as long as you hold the pose.)
const latches = {
  thumbsUp: new Latch(0.4, 0.6),
  openPalm: new Latch(0.6, 0.5),
  fingerGun: new Latch(0.25, 0.35),
  peace: new Latch(0.5, 0.5),
};

let port = null, panel = null, tracker = null, loading = null;
let privacyOn = false, fogOn = false;

// ------------------------------------------------------------------ link to the page

window.addEventListener("message", (e) => {
  if (port || e.source !== window || e.data?.gestureCam !== "hello" || !e.ports[0]) return;
  port = e.ports[0];
  port.onmessage = onPageMessage;
  port.postMessage({ type: "ack" });
});

function onPageMessage(e) {
  const msg = e.data;
  if (msg?.type === "cameras" && msg.count > 0) start();
  else if (msg?.type === "frame") onFrame(msg.bitmap);
}

function send(cmd) {
  port?.postMessage({ type: "fx", ...cmd });
}

// ------------------------------------------------------------------ startup

// Nothing heavy loads until a call turns the camera on.
function start() {
  panel ??= new Panel(settings, {
    toggle(key, value) {
      settings[key] = value;
      chrome.storage.local.set({ [key]: value });
      if (key === "privacy" && !value) setPrivacy(false);
      if (key === "fog" && !value) setFog(false);
    },
    tryEffect: (key) => fire(key, null),
    fold: (folded) => chrome.storage.local.set({ folded }),
  });
  loading ??= loadHandTracker(url)
    .then((t) => {
      tracker = t;
      panel.setState("ready", "Watching for gestures.");
      port.postMessage({ type: "want" });
    })
    .catch((err) => {
      console.error("[Gesture Cam] couldn't load hand tracking:", err);
      panel.setState("error", "Hand tracking didn't load. The Try buttons still work.");
    });
}

// ------------------------------------------------------------------ gestures -> effects

function onFrame(bitmap) {
  const started = performance.now();
  let hands = [];
  try {
    hands = tracker ? tracker.detect(bitmap) : [];
  } catch (err) {
    console.warn("[Gesture Cam] hand tracking failed on a frame:", err);
  }
  const { width, height } = bitmap;
  bitmap.close();

  const seen = new Map();
  for (const landmarks of hands) {
    const g = classify(landmarks, width, height);
    if (g) seen.set(g.name, g);
  }
  const t = performance.now() / 1000;
  for (const effect of EFFECTS) {
    const latch = latches[effect.gesture];
    if (!latch) continue;
    // While the fog is on, index-plus-thumb is drawing, not a finger gun.
    const active = settings[effect.key] && seen.has(effect.gesture) && !(fogOn && effect.gesture === "fingerGun");
    if (latch.update(active, t)) fire(effect.key, seen.get(effect.gesture));
  }
  panel?.showSeen(new Set(seen.keys()));
  if (fogOn) movePen(seen, t);
  moveOrb(seen, t);

  // Hand tracking shares the page's main thread with the video, so rest at least as long as it
  // took: on a slow computer that keeps the picture moving at the cost of slower gestures.
  const took = performance.now() - started;
  const wait = Math.max(MIN_FRAME_GAP_MS - took, took);
  setTimeout(() => port.postMessage({ type: "want" }), wait);
}

/** Starts an effect. `where` is the gesture that triggered it, or null for the Try buttons. */
function fire(key, where) {
  if (key === "confetti") send({ name: "confetti", x: where?.x ?? 0.5, y: where?.y ?? 0.8 });
  else if (key === "bang") send({ name: "bang", x: where?.x ?? 0.3, y: where?.y ?? 0.6, dx: where?.dx ?? 1, dy: where?.dy ?? -0.25 });
  else if (key === "privacy") setPrivacy(!privacyOn);
  else if (key === "fog") setFog(!fogOn);
  else if (key === "orb") send({ name: "orb", x: 0.5, y: 0.45, size: 0.22, hold: 3 });
}

function setPrivacy(on) {
  privacyOn = on;
  send({ name: "privacy", on });
  panel?.showOn("privacy", on);
}

// ------------------------------------------------------------------ fog mirror

function setFog(on) {
  fogOn = on;
  pen = null;
  send({ name: "fog", on });
  panel?.showOn("fog", on);
  panel?.showStatus(on ? "Fog on: index finger draws, middle finger erases." : undefined);
}

const PEN_LIFT_GRACE = 0.15;  // seconds the pose can drop out before the pen lifts (tracking blinks)
const penX = new OneEuroFilter(), penY = new OneEuroFilter();
let pen = null;  // { mode, lastSeen } while the pen is down

/** Moves the fog mirror's pen: index finger draws, middle finger erases, anything else lifts it. */
function movePen(seen, t) {
  // With the fog on, index finger plus thumb (the finger gun) draws too, so a drifting thumb
  // doesn't break your line.
  const draw = seen.get("indexPoint") ?? seen.get("fingerGun");
  const erase = seen.get("middlePoint");
  const tip = draw ?? erase;
  if (tip) {
    const mode = draw ? "draw" : "erase";
    if (pen?.mode !== mode) {  // a new stroke: forget where the last one was
      penX.reset();
      penY.reset();
    }
    pen = { mode, lastSeen: t };
    send({ name: "fogPen", mode, x: penX.filter(tip.x, t), y: penY.filter(tip.y, t) });
  } else if (pen && t - pen.lastSeen > PEN_LIFT_GRACE) {
    pen = null;
    send({ name: "fogPen", mode: null });
  }
}

// ------------------------------------------------------------------ Rasengan

const ORB_HOLD = 0.25;   // hold your hand flat this long before the orb appears
const ORB_GRACE = 0.3;   // tracking blinks shorter than this don't restart the hold
let orbSince = null, orbLastSeen = -Infinity;

/** Keeps the Rasengan over your flat hand. page/fx.js fades it out once the updates stop. */
function moveOrb(seen, t) {
  const hand = settings.orb ? seen.get("flatHand") : null;
  if (!hand) {
    if (t - orbLastSeen > ORB_GRACE) orbSince = null;
    return;
  }
  orbLastSeen = t;
  orbSince ??= t;
  if (t - orbSince >= ORB_HOLD) send({ name: "orb", x: hand.x, y: hand.y, size: hand.size });
}
