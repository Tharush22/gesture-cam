// Turns MediaPipe's 21 hand points into gestures: thumbs up, open palm, finger gun, peace sign,
// and pointing with just the ring or just the index finger (the fog mirror's pen and eraser).
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

  return { p, fingers, thumbOut, thumbStraight, thumbGap, thumbDir: dir2(2, 4), handDir: dir2(0, 9), indexDir: dir2(5, 8) };
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

  // Ring finger on its own: the fog mirror's pen. The others only need to be not straight,
  // because few hands can curl them tightly while holding the ring finger out.
  if (ring.extended && !index.extended && !middle.extended && !pinky.extended) {
    return { name: "ringPoint", ...at(16), dx: 0, dy: -1 };
  }

  // Index finger on its own, thumb tucked in (thumb out would be the finger gun): the fog eraser.
  if (index.extended && !middle.extended && !ring.extended && !pinky.extended && !m.thumbOut) {
    return { name: "indexPoint", ...at(8), dx: m.indexDir[0], dy: m.indexDir[1] };
  }

  return null;
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
