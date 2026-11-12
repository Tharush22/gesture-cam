// The extension's side, running in its own isolated world on the meeting page.
//
// page/camera.js (in the page's world) hands us a private message port, then sends small copies of
// camera frames through it. We find hands in them, turn hand shapes into gestures, and send effect
// commands back for page/fx.js to draw. While the fog mirror is on, we also stream the fingertip
// position of the ring finger (pen) or index finger (eraser) so page/fx.js can draw on the fog.
import { classify, Latch } from "./gestures.js";
import { EFFECTS, Panel } from "./panel.js";
import { loadHandTracker } from "./tracker.js";

const url = (path) => chrome.runtime.getURL(path);
const MIN_FRAME_GAP_MS = 33;  // look for hands at most ~30 times a second

const settings = await chrome.storage.local.get({ confetti: true, privacy: true, bang: true, fog: true, folded: false });

// How long each gesture must be held to fire, and how long it must be gone before it can fire again.
const latches = {
  thumbsUp: new Latch(0.4, 0.6),
  openPalm: new Latch(0.6, 0.5),
  fingerGun: new Latch(0.25, 0.35),
  peace: new Latch(0.5, 0.5),
};

let port = null, panel = null, tracker = null, loading = null;
let privacyOn = false, fogOn = false, penDown = false;

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
    const active = settings[effect.key] && seen.has(effect.gesture);
    if (latches[effect.gesture].update(active, t)) fire(effect.key, seen.get(effect.gesture));
  }
  panel?.showSeen(new Set(seen.keys()));
  if (fogOn) movePen(seen);

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
}

function setPrivacy(on) {
  privacyOn = on;
  send({ name: "privacy", on });
  panel?.showOn("privacy", on);
}

// ------------------------------------------------------------------ fog mirror

function setFog(on) {
  fogOn = on;
  send({ name: "fog", on });
  panel?.showOn("fog", on);
  panel?.showStatus(on ? "Fog on: ring finger draws, index finger erases." : undefined);
}

/** Moves the fog mirror's pen: ring finger draws, index finger erases, anything else lifts it. */
function movePen(seen) {
  const ring = seen.get("ringPoint"), index = seen.get("indexPoint");
  const tip = ring ?? index;
  const mode = ring ? "draw" : index ? "erase" : null;
  if (!mode && !penDown) return;  // already lifted: nothing to say
  penDown = !!mode;
  send({ name: "fogPen", mode, x: tip?.x, y: tip?.y });
}
