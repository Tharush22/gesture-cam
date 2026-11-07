// Checks the gesture rules against real hand photos, using the real hand tracker in Chromium.
//   node test/photos.mjs
import { chromium } from "playwright";
import { serve } from "./serve.mjs";

// What each photo should (and shouldn't) trigger. right_hands has two hands: one upright, one upside down.
const EXPECT = {
  thumb_up: ["thumbsUp"],
  pointing_up: [null],
  pointing_up_rotated: [null],
  victory: [null],
  fist: [null],
  right_hands: ["openPalm", null],
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
