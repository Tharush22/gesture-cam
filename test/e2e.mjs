// Full test: loads the real extension into Chrome, uses the hand photos as a fake webcam,
// and checks that the effects show up in the video the meeting gets.
//   npm run test:e2e   (needs ffmpeg, saves screenshots to test/out/)
//
// The "meeting" is a fake page at https://meet.google.com/test so the extension runs on it.
// Nothing is actually sent to Google, the test answers the request itself.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const EXTENSION = process.env.EXTENSION_DIR ?? join(ROOT, "extension");  // or test another copy, like a release zip
const OUT = join(ROOT, "test", "out");
mkdirSync(OUT, { recursive: true });
const work = mkdtempSync(join(tmpdir(), "gesture-cam-"));

// Makes a fake camera video: 3 seconds of the photo at 1280x720. Chrome loops it.
function clip(photo) {
  const file = join(work, `${photo}.y4m`);
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-loop", "1", "-t", "3", "-i", join(ROOT, "test", "images", `${photo}.jpg`),
    "-vf", "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=0xd8d4ce,format=yuv420p",
    "-r", "30", file]);
  return file;
}

// The fake meeting page. It shows the video it gets, and can tell what percent of the
// picture has changed since a saved snapshot.
const MEETING = `<!doctype html><meta charset="utf-8"><title>Fake meeting</title>
<body style="margin:0;background:#202124">
<video id="v" autoplay muted playsinline style="width:640px;height:360px;display:block"></video>
<script>
  window.camera = navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } })
    .then((s) => { v.srcObject = s; window.stream = s; return s.getVideoTracks()[0].label; });
  const canvas = new OffscreenCanvas(320, 180), ctx = canvas.getContext("2d", { willReadFrequently: true });
  const grab = () => { ctx.drawImage(v, 0, 0, 320, 180); return ctx.getImageData(0, 0, 320, 180).data; };
  let reference = null;
  window.snapshot = () => { reference = grab(); };
  window.changed = () => {
    const now = grab();
    let n = 0;
    for (let i = 0; i < now.length; i += 4) {
      const d = Math.max(Math.abs(now[i] - reference[i]), Math.abs(now[i + 1] - reference[i + 1]), Math.abs(now[i + 2] - reference[i + 2]));
      if (d > 40) n++;
    }
    return (100 * n) / (now.length / 4);
  };
</script>`;

const SHOWS = 0.5;  // if more than this % of the picture changes, the effect is showing

async function open(photo) {
  const context = await chromium.launchPersistentContext(join(work, `profile-${photo}-${Date.now()}`), {
    channel: "chromium",  // the full browser, because the lighter one can't load extensions
    args: [
      `--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`,
      "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
      `--use-file-for-fake-video-capture=${clip(photo)}`,
    ],
    viewport: { width: 1000, height: 600 },
  });
  await context.route("https://meet.google.com/**", (route) => route.fulfill({ contentType: "text/html", body: MEETING }));
  // Remember every website the browser talks to (besides the fake meeting and the extension itself).
  const outside = new Set();
  context.on("request", (r) => {
    const { protocol, host } = new URL(r.url());
    if (protocol !== "chrome-extension:" && host !== "meet.google.com") outside.add(host);
  });
  const page = await context.newPage();
  const logs = [];
  page.on("console", (m) => logs.push(`${m.type()}: ${m.text()}`));
  await page.goto("https://meet.google.com/test");
  const label = await page.evaluate(() => window.camera);
  await page.locator("gesture-cam-panel .light.ready").waitFor({ timeout: 30000 });
  await page.waitForTimeout(300);
  return { context, page, logs, label, outside, opened: Date.now() };
}

/** The most the picture changed within `ms`, stopping early once an effect clearly shows. */
async function watch(page, ms) {
  const end = Date.now() + ms;
  let most = 0;
  while (Date.now() < end && most <= SHOWS) {
    most = Math.max(most, await page.evaluate(() => window.changed()));
    await page.waitForTimeout(30);
  }
  return most;
}

let failed = 0;
const check = (ok, what) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failed++;
};

// 1. A fist isn't a gesture, so the picture shouldn't change.
{
  const { context, page, logs, label } = await open("fist");
  check(label.length > 0, `the meeting sees the camera's own name ("${label}")`);
  await page.evaluate(() => window.snapshot());
  const change = await watch(page, 4000);
  check(change < 0.2, `fist: nothing fires (${change.toFixed(1)}% of pixels changed)`);
  const errors = logs.filter((l) => l.startsWith("error"));
  check(errors.length === 0, `no errors in the console${errors.length ? ": " + errors.join(" | ") : ""}`);
  // MediaPipe's normal startup messages would show up under the Errors button.
  const chatter = logs.filter((l) => /gl_context|NORM_RECT|INFO:/.test(l));
  check(chatter.length === 0, `no MediaPipe startup warnings${chatter.length ? ": " + chatter.join(" | ") : ""}`);
  await context.close();
}

// 2. Thumbs up gives confetti, 3. open palm gives privacy, and a peace sign gives fog.
for (const [photo, effect] of [["thumb_up", "confetti"], ["right_hands", "privacy blur"], ["victory", "fog mirror"]]) {
  const { context, page, logs } = await open(photo);
  // Take a snapshot to compare against before the gesture fires.
  await page.evaluate(() => window.snapshot());
  const change = await watch(page, 10000);
  await page.screenshot({ path: join(OUT, `${photo}.png`) });
  check(change > SHOWS, `${photo}: ${effect} shows on the outgoing video (${change.toFixed(1)}% of pixels changed)`);
  if (change <= SHOWS) console.log(logs.join("\n"));
  await context.close();
}

// 4. The Try buttons, including finger gun and Rasengan (there are no photos of those).
{
  const { context, page, outside, opened } = await open("fist");
  for (const key of ["bang", "confetti", "orb", "privacy"]) {
    await page.evaluate(() => window.snapshot());
    await page.locator(`gesture-cam-panel .effect[data-key="${key}"] .try`).click();
    const change = await watch(page, 3000);
    await page.screenshot({ path: join(OUT, `try-${key}.png`) });
    check(change > SHOWS, `Try ${key}: shows on the outgoing video (${change.toFixed(1)}% of pixels changed)`);
    if (key !== "privacy") await page.waitForTimeout(3500);  // let it finish before the next one
  }

  // 5. Fog mirror: turn it on, write "HI", then erase the I.
  await page.locator('gesture-cam-panel .effect[data-key="privacy"] .try').click();  // privacy off first
  await page.waitForTimeout(500);
  await page.locator('gesture-cam-panel .effect[data-key="fog"] .try').click();
  await page.waitForTimeout(1500);  // let the fog roll in
  await page.evaluate(() => window.snapshot());
  await page.evaluate(async () => {
    const fx = globalThis[Symbol.for("gesture-cam")].fx;
    const stroke = async (mode, points) => {
      for (const [x, y] of points) {
        fx.run({ name: "fogPen", mode, x, y });
        await new Promise((r) => setTimeout(r, 40));
      }
      fx.run({ name: "fogPen", mode: null });
      await new Promise((r) => setTimeout(r, 400));  // wait so the next line starts fresh
    };
    const line = (x0, y0, x1, y1, n = 12) => Array.from({ length: n + 1 }, (_, i) => [x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n]);
    await stroke("draw", line(0.35, 0.3, 0.35, 0.7));  // H
    await stroke("draw", line(0.5, 0.3, 0.5, 0.7));
    await stroke("draw", line(0.35, 0.5, 0.5, 0.5));
    await stroke("draw", line(0.62, 0.3, 0.62, 0.7));  // I
  });
  await page.waitForTimeout(300);
  const drawn = await page.evaluate(() => window.changed());
  await page.screenshot({ path: join(OUT, "fog-drawn.png") });
  check(drawn > SHOWS, `fog mirror: drawing clears lines through the fog (${drawn.toFixed(1)}% of pixels changed)`);
  await page.evaluate(async () => {
    const fx = globalThis[Symbol.for("gesture-cam")].fx;
    for (let i = 0; i <= 12; i++) {
      fx.run({ name: "fogPen", mode: "erase", x: 0.62, y: 0.3 + (0.4 * i) / 12 });
      await new Promise((r) => setTimeout(r, 40));
    }
    fx.run({ name: "fogPen", mode: null });
  });
  await page.waitForTimeout(300);
  const erased = await page.evaluate(() => window.changed());
  await page.screenshot({ path: join(OUT, "fog-erased.png") });
  check(erased < drawn * 0.85, `fog mirror: erasing fogs the "I" back over (${drawn.toFixed(1)}% → ${erased.toFixed(1)}%)`);
  await page.locator('gesture-cam-panel .effect[data-key="fog"] .try').click();  // fog off
  await page.waitForTimeout(1200);

  // 6. Bad connection: lags, freezes, then goes black. Clicking again brings it back.
  await page.evaluate(() => window.snapshot());
  await page.locator('gesture-cam-panel .effect[data-key="lag"] .try').click();
  await page.waitForTimeout(12500);  // wait past the lagging (5 s) and frozen (6 s) parts
  const dead = await page.evaluate(() => window.changed());
  await page.screenshot({ path: join(OUT, "lag-dead.png") });
  check(dead > 50, `bad connection: the camera "dies" after the lag and freeze (${dead.toFixed(0)}% of pixels changed)`);
  await page.locator('gesture-cam-panel .effect[data-key="lag"] .try').click();
  await page.waitForTimeout(1500);
  const back = await page.evaluate(() => window.changed());
  check(back < 0.5, `bad connection: turning it off brings the live picture back (${back.toFixed(1)}% of pixels changed)`);

  // The camera should only turn off once every copy of the video has been stopped.
  const afterOriginal = await page.evaluate(async () => {
    const track = window.stream.getVideoTracks()[0];
    const copy = track.clone();
    track.stop();
    await new Promise((r) => setTimeout(r, 300));
    const state = copy.readyState;
    copy.stop();
    return state;
  });
  check(afterOriginal === "live", `a cloned track keeps working after the original stops (${afterOriginal})`);

  // 7. Nothing goes online. MediaPipe would send usage stats once a minute, so wait past that.
  await page.waitForTimeout(Math.max(0, 65000 - (Date.now() - opened)));
  check(outside.size === 0, `nothing is sent online after a minute${outside.size ? ": " + [...outside].join(", ") : ""}`);
  await context.close();
}

rmSync(work, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
