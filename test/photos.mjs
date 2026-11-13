// Checks the gesture rules on real hand photos, using the real hand tracker in Chrome.
//   node test/photos.mjs
import { chromium } from "playwright";
import { serve } from "./serve.mjs";

// What each photo should do. right_hands has two hands: one upright and one upside down.
const EXPECT = {
  thumb_up: ["thumbsUp"],
  pointing_up: ["indexPoint"],          // the fog pen
  pointing_up_rotated: ["indexPoint"],
  victory: ["peace"],
  fist: [null],
  right_hands: ["openPalm", null],
  // Real hands turned or changed in 3D, for poses I don't have photos of (see photos.html).
  "open hand tilted flat": ["flatHand"],
  "open hand tilted flat the other way": ["flatHand"],
  "open hand turned sideways": [null],
  "middle finger instead of index": ["middlePoint"],
  // Two-hand gestures check both hands together.
  "both hands: real photo, one upside down": [null],
  "both hands: two open hands up": ["bothHandsUp"],
  "both hands: one open hand up": [null],
  "both hands: open hand + fist": [null],
};

const server = await serve();
const browser = await chromium.launch();
const page = await browser.newPage();
page.on("console", (m) => m.type() === "error" && console.error("page:", m.text()));
await page.goto(`http://127.0.0.1:${server.address().port}/test/photos.html`);
const results = await page.waitForFunction(() => window.results, null, { timeout: 120000 }).then((h) => h.jsonValue());
await browser.close();
server.close();

let failed = 0;
for (const [photo, want] of Object.entries(EXPECT)) {
  const got = results[photo].map((r) => r.gesture).sort();
  const ok = JSON.stringify(got) === JSON.stringify([...want].sort());
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${photo}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  if (!ok || process.argv.includes("-v")) for (const r of results[photo]) console.log("      ", JSON.stringify(r));
}
process.exit(failed ? 1 : 0);
