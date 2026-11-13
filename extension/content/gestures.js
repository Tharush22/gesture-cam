// Works out which gesture a hand is making from MediaPipe's 21 hand points.
// Gestures: thumbs up, open palm, finger gun, peace sign, flat hand (Rasengan),
// index finger only (fog pen), middle finger only (fog eraser) and both hands up (bad connection).
//
// Hand points (https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker):
//   0 wrist, thumb 1-4, index 5-8, middle 9-12, ring 13-16, pinky 17-20 (knuckle first, tip last).
// x and y go from 0 to 1 across the picture, and z is how close the point is to the camera.
// I turn them into pixels first so the picture's shape doesn't stretch the angles.

const FINGERS = { index: [5, 6, 8], middle: [9, 10, 12], ring: [13, 14, 16], pinky: [17, 18, 20] };  // knuckle, middle joint, tip

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (v) => Math.hypot(v[0], v[1], v[2]);
const dist = (a, b) => len(sub(a, b));
const cosine = (a, b) => (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (len(a) * len(b) + 1e-9);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Measures every finger. The tests use this too. */
export function measure(landmarks, w, h) {
  const p = landmarks.map((q) => [q.x * w, q.y * h, (q.z ?? 0) * w]);
  const palm = dist(p[0], p[9]) + 1e-9;  // wrist to middle knuckle, used as the hand's size

  const fingers = {};
  for (const [name, [knuckle, joint, tip]] of Object.entries(FINGERS)) {
    // 1 means the finger is straight. Below 0 means it's bent back.
    const straight = cosine(sub(p[joint], p[knuckle]), sub(p[tip], p[joint]));
    // Is the fingertip further from the wrist than the middle joint is?
    const reach = dist(p[tip], p[0]) / (dist(p[joint], p[0]) + 1e-9);
    fingers[name] = {
      extended: straight > 0.75 && reach > 1.1,
      curled: reach < 1.0 || straight < 0.1,
    };
  }

  // The thumb is "out" when it's straight and the tip is far from the index knuckle.
  const thumbStraight = cosine(sub(p[3], p[2]), sub(p[4], p[3]));
  const thumbGap = dist(p[4], p[5]) / palm;
  const thumbOut = thumbStraight > 0.6 && thumbGap > 0.55;

  // Which way something points in the picture (y goes down).
  const dir2 = (from, to) => {
    const dx = p[to][0] - p[from][0], dy = p[to][1] - p[from][1];
    const n = Math.hypot(dx, dy) + 1e-9;
    return [dx / n, dy / n];
  };

  // Which way the palm is facing, using the wrist, index knuckle and pinky knuckle.
  // If the y part is close to 1 or -1, the hand is lying flat (palm up or down).
  const normal = cross(sub(p[5], p[0]), sub(p[17], p[0]));
  const palmFacing = normal.map((v) => v / (len(normal) + 1e-9));

  return { p, palm, fingers, thumbOut, thumbStraight, thumbGap, palmFacing,
    thumbDir: dir2(2, 4), handDir: dir2(0, 9), indexDir: dir2(5, 8) };
}

/**
 * Returns the gesture this hand is making, or null if it's none of them.
 * x, y is where the effect should start, and dx, dy is the direction it points.
 */
export function classify(landmarks, w, h) {
  const m = measure(landmarks, w, h);
  const { index, middle, ring, pinky } = m.fingers;
  const at = (i) => ({ x: landmarks[i].x, y: landmarks[i].y });

  // Flat hand (palm up or down) with fingers not curled. The Rasengan goes above the palm.
  if (Math.abs(m.palmFacing[1]) > 0.65 && !index.curled && !middle.curled && !ring.curled && !pinky.curled) {
    const palmIds = [0, 5, 9, 13, 17];
    const cx = palmIds.reduce((s, i) => s + landmarks[i].x, 0) / palmIds.length;
    const cy = palmIds.reduce((s, i) => s + landmarks[i].y, 0) / palmIds.length;
    const size = m.palm / h;  // hand size compared to the picture's height
    return { name: "flatHand", x: cx, y: cy - size * 0.9, size, dx: 0, dy: -1 };
  }

  // Open palm: all fingers and the thumb out, hand pointing up.
  if (index.extended && middle.extended && ring.extended && pinky.extended && m.thumbOut && m.handDir[1] < -0.6) {
    return { name: "openPalm", ...at(9), dx: 0, dy: -1 };
  }

  // Finger gun: index and thumb out, the other three curled.
  if (index.extended && m.thumbOut && middle.curled && ring.curled && pinky.curled) {
    return { name: "fingerGun", ...at(8), dx: m.indexDir[0], dy: m.indexDir[1] };
  }

  // Thumbs up: four fingers curled, thumb out and pointing up, and the thumb is the highest point.
  const thumbHighest = [8, 12, 16, 20].every((i) => m.p[4][1] < m.p[i][1]);
  if (index.curled && middle.curled && ring.curled && pinky.curled && m.thumbOut && m.thumbDir[1] < -0.6 && thumbHighest) {
    return { name: "thumbsUp", ...at(4), dx: m.thumbDir[0], dy: m.thumbDir[1] };
  }

  // Peace sign: index and middle fingers out, ring and pinky curled, thumb tucked in.
  if (index.extended && middle.extended && ring.curled && pinky.curled && !m.thumbOut) {
    return { name: "peace", ...at(12), dx: 0, dy: -1 };
  }

  // Only the index finger out, thumb tucked in: the fog pen. (Thumb out would be the finger gun.)
  // The other fingers just can't be straight, so a relaxed hand still works.
  if (index.extended && !middle.extended && !ring.extended && !pinky.extended && !m.thumbOut) {
    return { name: "indexPoint", ...at(8), dx: m.indexDir[0], dy: m.indexDir[1] };
  }

  // Only the middle finger out: the fog eraser.
  if (middle.extended && !index.extended && !ring.extended && !pinky.extended) {
    return { name: "middlePoint", ...at(12), dx: 0, dy: -1 };
  }

  return null;
}

/**
 * Both hands up with fingers open turns the bad connection on or off.
 * This one looks at all the hands at once, not just one.
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
 * Makes a gesture fire once instead of every frame. It fires after you hold the gesture for
 * `hold` seconds, and can only fire again once it's been gone for `release` seconds.
 * If tracking misses the hand for a frame or two, the timer keeps going.
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
