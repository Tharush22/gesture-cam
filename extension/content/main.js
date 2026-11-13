// The main logic. Runs in the extension's own space on the meeting page.
//
// camera.js sends small copies of the camera frames here. I find the hands, work out the gestures,
// and send commands back to fx.js to draw the effects.
// Two effects follow your hand the whole time instead of firing once: the fog pen and the Rasengan.
import { bothHandsUp, classify, Latch } from "./gestures.js";
import { EFFECTS, Panel } from "./panel.js";
import { OneEuroFilter } from "./smoothing.js";
import { loadHandTracker } from "./tracker.js";

const url = (path) => chrome.runtime.getURL(path);
const MIN_FRAME_GAP_MS = 33;  // check for hands up to about 30 times a second

const settings = await chrome.storage.local.get({ confetti: true, privacy: true, bang: true, fog: true, orb: true, lag: true, folded: false });

// How long to hold each gesture before it fires, and how long it has to be gone before it can fire again.
// The flat hand isn't here because the Rasengan stays as long as you hold your hand flat.
const latches = {
  thumbsUp: new Latch(0.4, 0.6),
  openPalm: new Latch(0.6, 0.5),
  fingerGun: new Latch(0.25, 0.35),
  peace: new Latch(0.5, 0.5),
  bothHandsUp: new Latch(0.5, 0.6),
};

let port = null, panel = null, tracker = null, loading = null;
let privacyOn = false, fogOn = false, lagOn = false;

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

// Don't load anything big until the camera turns on.
function start() {
  panel ??= new Panel(settings, {
    toggle(key, value) {
      settings[key] = value;
      chrome.storage.local.set({ [key]: value });
      if (key === "privacy" && !value) setPrivacy(false);
      if (key === "fog" && !value) setFog(false);
      if (key === "lag" && !value) setLag(false);
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
  // Two hands up is its own gesture, so the open palms shouldn't also turn on privacy.
  const both = bothHandsUp(hands, width, height);
  if (both) {
    seen.set(both.name, both);
    seen.delete("openPalm");
  }
  const t = performance.now() / 1000;
  for (const effect of EFFECTS) {
    const latch = latches[effect.gesture];
    if (!latch) continue;
    // While the fog is on, index finger plus thumb is drawing, not the finger gun.
    const active = settings[effect.key] && seen.has(effect.gesture) && !(fogOn && effect.gesture === "fingerGun");
    if (latch.update(active, t)) fire(effect.key, seen.get(effect.gesture));
  }
  panel?.showSeen(new Set(seen.keys()));
  if (fogOn) movePen(seen, t);
  moveOrb(seen, t);

  // Hand tracking and the video share the same thread, so wait at least as long as tracking took.
  // On a slow computer this keeps the video smooth, and gestures are just a bit slower.
  const took = performance.now() - started;
  const wait = Math.max(MIN_FRAME_GAP_MS - took, took);
  setTimeout(() => port.postMessage({ type: "want" }), wait);
}

/** Starts an effect. `where` is the gesture that set it off, or null for the Try buttons. */
function fire(key, where) {
  if (key === "confetti") send({ name: "confetti", x: where?.x ?? 0.5, y: where?.y ?? 0.8 });
  else if (key === "bang") send({ name: "bang", x: where?.x ?? 0.3, y: where?.y ?? 0.6, dx: where?.dx ?? 1, dy: where?.dy ?? -0.25 });
  else if (key === "privacy") setPrivacy(!privacyOn);
  else if (key === "fog") setFog(!fogOn);
  else if (key === "lag") setLag(!lagOn);
  else if (key === "orb") send({ name: "orb", x: 0.5, y: 0.45, size: 0.22, hold: 3 });
}

function setPrivacy(on) {
  privacyOn = on;
  send({ name: "privacy", on });
  panel?.showOn("privacy", on);
}

// ------------------------------------------------------------------ bad connection

function setLag(on) {
  lagOn = on;
  send({ name: "lag", on });
  panel?.showOn("lag", on);
  panel?.showStatus(on ? "Bad connection on. Both hands up again to reconnect." : undefined);
}

// ------------------------------------------------------------------ fog mirror

function setFog(on) {
  fogOn = on;
  pen = null;
  send({ name: "fog", on });
  panel?.showOn("fog", on);
  panel?.showStatus(on ? "Fog on: index finger draws, middle finger erases." : undefined);
}

const PEN_LIFT_GRACE = 0.15;  // tracking can miss the hand for this long without lifting the pen
const penX = new OneEuroFilter(), penY = new OneEuroFilter();
let pen = null;  // set while the pen is down

/** Moves the fog pen. Index finger draws, middle finger erases, anything else lifts it. */
function movePen(seen, t) {
  // Index finger plus thumb also draws, so the line doesn't break if your thumb moves out.
  const draw = seen.get("indexPoint") ?? seen.get("fingerGun");
  const erase = seen.get("middlePoint");
  const tip = draw ?? erase;
  if (tip) {
    const mode = draw ? "draw" : "erase";
    if (pen?.mode !== mode) {  // new line, so forget the old position
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

const ORB_HOLD = 0.25;   // hold your hand flat this long before the Rasengan shows up
const ORB_GRACE = 0.3;   // short tracking misses don't restart the timer
let orbSince = null, orbLastSeen = -Infinity;

/** Keeps the Rasengan above your flat hand. fx.js makes it fade out when the updates stop. */
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
