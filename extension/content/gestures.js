// Turns MediaPipe's 21 hand points into gestures: thumbs up, open palm, finger gun, peace sign,
// a hand laid flat (the Rasengan), pointing with just the index or just the middle finger
// (the fog mirror's pen and eraser), and both hands up (the fake bad connection).
//
// Hand points (https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker):
//   0 wrist; thumb 1-4; index 5-8; middle 9-12; ring 13-16; pinky 17-20 (knuckle first, tip last).
// Points come normalized (x, y in 0..1 of the image; z is depth on roughly the same scale as x).
// We scale them to pixels so angles and distances aren't stretched by the image's aspect ratio.

const FINGERS = { index: [5, 6, 8], middle: [9, 10, 12], ring: [13, 14, 16], pinky: [17, 18, 20] };  // knuckle, middle joint, tip

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (v) => Math.hypot(v[0], v[1], v[2]);
const dist = (a, b) => len(sub(a, b));
const cosine = (a, b) => (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (len(a) * len(b) + 1e-9);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Measures every finger. Exported for tests and for the debug readout. */
export function measure(landmarks, w, h) {
  const p = landmarks.map((q) => [q.x * w, q.y * h, (q.z ?? 0) * w]);
  const palm = dist(p[0], p[9]) + 1e-9;  // wrist to middle knuckle: the hand's size

  const fingers = {};
  for (const [name, [knuckle, joint, tip]] of Object.entries(FINGERS)) {
    // 1 when the finger is straight, below 0 when it folds back on itself.
    const straight = cosine(sub(p[joint], p[knuckle]), sub(p[tip], p[joint]));
    // How far the tip reaches from the wrist compared with the middle joint.
    const reach = dist(p[tip], p[0]) / (dist(p[joint], p[0]) + 1e-9);
    fingers[name] = {
      extended: straight > 0.75 && reach > 1.1,
      curled: reach < 1.0 || straight < 0.1,
    };
  }

  // The thumb counts as out when it's straight and its tip is well away from the index knuckle.
  const thumbStraight = cosine(sub(p[3], p[2]), sub(p[4], p[3]));
  const thumbGap = dist(p[4], p[5]) / palm;
  const thumbOut = thumbStraight > 0.6 && thumbGap > 0.55;

  // Directions in the picture (2D, y pointing down), as unit vectors.
  const dir2 = (from, to) => {
    const dx = p[to][0] - p[from][0], dy = p[to][1] - p[from][1];
    const n = Math.hypot(dx, dy) + 1e-9;
    return [dx / n, dy / n];
  };

  // Which way the palm faces: the line at right angles to the palm's surface (wrist, index knuckle,
  // pinky knuckle). Its y part is near ±1 when the hand lies flat, palm up or down.
  const normal = cross(sub(p[5], p[0]), sub(p[17], p[0]));
  const palmFacing = normal.map((v) => v / (len(normal) + 1e-9));

  return { p, palm, fingers, thumbOut, thumbStraight, thumbGap, palmFacing,
    thumbDir: dir2(2, 4), handDir: dir2(0, 9), indexDir: dir2(5, 8) };
}

/**
 * The gesture this hand is making, or null.
 * Returns { name, x, y, dx, dy }: x, y is where the effect starts (0..1 of the image) and dx, dy
 * the direction it points.
 */
export function classify(landmarks, w, h) {
  const m = measure(landmarks, w, h);
  const { index, middle, ring, pinky } = m.fingers;
  const at = (i) => ({ x: landmarks[i].x, y: landmarks[i].y });

  // Hand laid flat (palm facing up or down), fingers not curled: the Rasengan sits above the palm.
  if (Math.abs(m.palmFacing[1]) > 0.65 && !index.curled && !middle.curled && !ring.curled && !pinky.curled) {
    const palmIds = [0, 5, 9, 13, 17];
    const cx = palmIds.reduce((s, i) => s + landmarks[i].x, 0) / palmIds.length;
    const cy = palmIds.reduce((s, i) => s + landmarks[i].y, 0) / palmIds.length;
    const size = m.palm / h;  // hand size as a fraction of the picture's height
    return { name: "flatHand", x: cx, y: cy - size * 0.9, size, dx: 0, dy: -1 };
  }

  // Open palm: every finger and the thumb out, hand held upright.
  if (index.extended && middle.extended && ring.extended && pinky.extended && m.thumbOut && m.handDir[1] < -0.6) {
    return { name: "openPalm", ...at(9), dx: 0, dy: -1 };
  }

  // Finger gun: index and thumb out, the other three curled.
  if (index.extended && m.thumbOut && middle.curled && ring.curled && pinky.curled) {
    return { name: "fingerGun", ...at(8), dx: m.indexDir[0], dy: m.indexDir[1] };
  }

  // Thumbs up: four fingers curled, thumb out and pointing up, thumb tip the highest point.
  const thumbHighest = [8, 12, 16, 20].every((i) => m.p[4][1] < m.p[i][1]);
  if (index.curled && middle.curled && ring.curled && pinky.curled && m.thumbOut && m.thumbDir[1] < -0.6 && thumbHighest) {
    return { name: "thumbsUp", ...at(4), dx: m.thumbDir[0], dy: m.thumbDir[1] };
  }

  // Peace sign: index and middle fingers out, ring and pinky curled, thumb tucked in.
  if (index.extended && middle.extended && ring.curled && pinky.curled && !m.thumbOut) {
    return { name: "peace", ...at(12), dx: 0, dy: -1 };
  }

  // Index finger on its own, thumb tucked in (thumb out is the finger gun): the fog mirror's pen.
  // The other fingers only need to be not straight, so a relaxed hand still counts.
  if (index.extended && !middle.extended && !ring.extended && !pinky.extended && !m.thumbOut) {
    return { name: "indexPoint", ...at(8), dx: m.indexDir[0], dy: m.indexDir[1] };
  }

  // Middle finger on its own: the fog mirror's eraser.
  if (middle.extended && !index.extended && !ring.extended && !pinky.extended) {
    return { name: "middlePoint", ...at(12), dx: 0, dy: -1 };
  }

  return null;
}

/**
 * Both hands held up with fingers open: the bad-connection toggle. Unlike classify(), this looks at
 * every hand in the picture at once. Returns { name: "bothHandsUp", ... } or null.
 */
export function bothHandsUp(hands, w, h) {
  const raised = hands.filter((landmarks) => {
    const m = measure(landmarks, w, h);
    const open = Object.values(m.fingers).filter((f) => !f.curled).length;
    return m.handDir[1] < -0.6 && open >= 3;  // pointing up, at least three fingers open
  });
  return raised.length >= 2 ? { name: "bothHandsUp", x: 0.5, y: 0.5, dx: 0, dy: -1 } : null;
}

/**
 * Debounces a gesture into single events. It fires once the gesture has been held for `hold`
 * seconds, and only fires again after the gesture has been gone for `release` seconds.
 * Short dropouts (a frame or two where tracking misses) don't reset the hold.
 */
export class Latch {
  constructor(hold, release) {
    this.hold = hold;
    this.release = release;
    this.since = null;
    this.lastSeen = -Infinity;
    this.armed = true;
  }

  update(seen, t) {
    if (seen) {
      this.lastSeen = t;
      this.since ??= t;
    } else if (t - this.lastSeen > this.release) {
      this.since = null;
      this.armed = true;
    }
    if (this.armed && seen && t - this.since >= this.hold) {
      this.armed = false;
      return true;
    }
    return false;
  }
}
