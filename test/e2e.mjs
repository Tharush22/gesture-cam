// End-to-end test: loads the real extension into Chromium, feeds it a fake webcam made from the
// hand photos, and checks that the gestures fire their effects on the video the "meeting" gets.
//   npm run test:e2e            (needs ffmpeg; writes screenshots to test/out/)
//
// The meeting is a stand-in page served at https://meet.google.com/test, so the extension's content
// scripts run on it, but nothing goes to Google: Playwright answers the request itself.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const EXTENSION = join(ROOT, "extension");
const OUT = join(ROOT, "test", "out");
mkdirSync(OUT, { recursive: true });
const work = mkdtempSync(join(tmpdir(), "gesture-cam-"));

// A fake camera clip: 3 s of the photo, fitted into 1280x720. Chromium loops it.
function clip(photo) {
  const file = join(work, `${photo}.y4m`);
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-loop", "1", "-t", "3", "-i", join(ROOT, "test", "images", `${photo}.jpg`),
    "-vf", "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=0xd8d4ce,format=yuv420p",
    "-r", "30", file]);
  return file;
}

// The stand-in meeting. It shows the camera it gets, and can say how much of that picture has
// changed since a reference snapshot: the percentage of pixels that differ noticeably.
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

const SHOWS = 0.5;  // % of pixels changed that counts as "the effect is on screen"

async function open(photo) {
  const context = await chromium.launchPersistentContext(join(work, `profile-${photo}-${Date.now()}`), {
    channel: "chromium",  // the full browser: the headless shell can't load extensions
    args: [
      `--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`,
      "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
      `--use-file-for-fake-video-capture=${clip(photo)}`,
    ],
    viewport: { width: 1000, height: 600 },
  });
  await context.route("https://meet.google.com/**", (route) => route.fulfill({ contentType: "text/html", body: MEETING }));
  const page = await context.newPage();
  const logs = [];
  page.on("console", (m) => logs.push(`${m.type()}: ${m.text()}`));
  await page.goto("https://meet.google.com/test");
  const label = await page.evaluate(() => window.camera);
  await page.locator("gesture-cam-panel .light.ready").waitFor({ timeout: 30000 });
  await page.waitForTimeout(300);
  return { context, page, logs, label };
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

// 1. A fist isn't a gesture: the picture should stay the plain camera.
{
  const { context, page, logs, label } = await open("fist");
  check(label.length > 0, `the meeting sees the camera's own name ("${label}")`);
  await page.evaluate(() => window.snapshot());
  const change = await watch(page, 4000);
  check(change < 0.2, `fist: nothing fires (${change.toFixed(1)}% of pixels changed)`);
  // MediaPipe prints its info messages through console.error, so skip those.
  const errors = logs.filter((l) => l.startsWith("error") && !l.includes("INFO:"));
  check(errors.length === 0, `no errors in the console${errors.length ? ": " + errors.join(" | ") : ""}`);
  await context.close();
}

// 2. Thumbs up fires confetti; 3. an open palm turns on privacy mode.
for (const [photo, effect] of [["thumb_up", "confetti"], ["right_hands", "privacy blur"]]) {
  const { context, page, logs } = await open(photo);
  // The gesture may already have fired while the model warmed up, so compare with the photo itself.
  await page.evaluate(() => window.snapshot());
  const change = await watch(page, 10000);
  await page.screenshot({ path: join(OUT, `${photo}.png`) });
  check(change > SHOWS, `${photo}: ${effect} shows on the outgoing video (${change.toFixed(1)}% of pixels changed)`);
  if (change <= SHOWS) console.log(logs.join("\n"));
  await context.close();
}

// 4. The Try buttons, including the finger gun (there's no finger-gun photo to test with).
{
  const { context, page } = await open("fist");
  for (const key of ["bang", "confetti", "privacy"]) {
    await page.evaluate(() => window.snapshot());
    await page.locator(`gesture-cam-panel .effect[data-key="${key}"] .try`).click();
    const change = await watch(page, 3000);
    await page.screenshot({ path: join(OUT, `try-${key}.png`) });
    check(change > SHOWS, `Try ${key}: shows on the outgoing video (${change.toFixed(1)}% of pixels changed)`);
    if (key !== "privacy") await page.waitForTimeout(3500);  // let it finish before the next one
  }

  // The camera should turn off only once every copy of the meeting's track has been stopped.
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
  await context.close();
}

rmSync(work, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
