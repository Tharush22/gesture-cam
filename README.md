# Gesture Cam

Hand-gesture effects for your webcam in browser video calls. Everyone else in the call sees the effects.

| Gesture | Effect |
|---|---|
| 👍 Thumbs up | A burst of confetti from your thumb |
| ✋ Open palm, held upright | Privacy mode: pixelates the picture. Do it again to turn it off. |
| 👉 Finger gun (index out, thumb up) | Muzzle flash, "BANG!", screen shake and smoke |
| ✌️ Peace sign | **Fog mirror**: the picture steams up like a bathroom mirror. Do it again to clear it. |
| 🤚 Hand laid flat (palm up or down) | **Rasengan**: a spinning ball of wind and light hovers above your hand for as long as you hold it |

While the fog mirror is on, you can write on it:

| Gesture | What it does |
|---|---|
| Only your index finger out | Draws: wipes a clear line through the fog |
| Only your middle finger out | Erases: rubs fog back over your lines |

The fingertip is smoothed (a "1€ filter", in `content/smoothing.js`) and lines are drawn as curves, so they come out steady even when hand tracking is slow. While the fog is on, the finger gun is switched off, so your thumb drifting out doesn't fire a bang mid-line.

Lines slowly mist over again in about 15 seconds, like a real mirror. Your self-view is mirrored, so writing looks right to you, but the others in the call see text reversed, the way it would look from behind real glass.

It works in Google Meet, and in Zoom and Microsoft Teams when you use them in the browser.

## Install

1. Open `chrome://extensions` in Chrome (or Edge, Brave or Arc).
2. Turn on **Developer mode**.
3. Click **Load unpacked** and choose the `extension/` folder.

## Use

Join a call with your camera on. A small **Gesture Cam** panel appears in the corner of the page. Only you can see it.

- The light turns green once hand tracking has loaded, which takes a few seconds the first time.
- An effect's row lights up while its gesture is in view. Hold the gesture for about half a second to fire it.
- **Try** fires an effect without the gesture, and the switch turns that gesture off.
- Drag the panel by its title, and use **–** to fold it away.

Tip: keep your hand roughly facing the camera, and far enough away that your whole hand is in the frame.

## How it works

```
 meeting page (page's own JS world)                 extension's isolated world
 ─────────────────────────────────────              ────────────────────────────
 page/camera.js                                     content/main.js
   wraps getUserMedia()                               hand tracking (MediaPipe)
   camera → page/fx.js → new video track  ── small frame copies ──▶  content/gestures.js
            (draws effects)               ◀── "confetti" / "bang" ──  latches, panel
                                              (private MessageChannel)
```

- **`page/camera.js`** runs before the meeting app loads. When the meeting asks for the camera, it opens the camera itself and runs every frame through `fx.render()`. It then gives the meeting a new video track with the result. The track reports the real camera's name and settings, so the meeting app can't tell the difference.
- **`page/fx.js`** draws the effects with a plain 2D canvas. When no effect is running, frames pass through untouched.
- **`content/main.js`** runs in the extension's own isolated world. That's needed because the meeting site's security policy would block MediaPipe's WebAssembly. It receives small copies of the frames and finds hands with **`content/tracker.js`**. It turns hand shapes into gestures with **`content/gestures.js`** and sends effect commands back.
- Hand tracking shares the page's main thread with the video. It paces itself so a slow computer gets slower gesture detection instead of choppy video.

## Add your own gesture and effect

1. **Gesture:** add a rule to `classify()` in `extension/content/gestures.js`. `measure()` already tells you which fingers are extended or curled, whether the thumb is out, and which way the hand points.
2. **Effect:** add a function to `extension/page/fx.js`, call it from `run()`, and make `render()` draw it while it's active.
3. **Wire it up:** add a row to `EFFECTS` in `extension/content/panel.js`, a `Latch` in `extension/content/main.js`, and a case in `fire()`.

## Tests

```bash
npm install
```
```bash
npm test
```
```bash
npm run test:e2e
```

- `npm test` runs the real hand tracker on the photos in `test/images/` and checks each one is classified correctly. This includes photos that shouldn't trigger anything: a fist, pointing, and a peace sign.
- `npm run test:e2e` loads the extension into Chromium with a fake webcam made from those photos. It checks that the effects show on the video the meeting receives. It needs `ffmpeg`, and writes screenshots to `test/out/`.

## Credits

Hand tracking uses Google's [MediaPipe](https://ai.google.dev/edge/mediapipe) (Apache License 2.0), bundled in `extension/vendor/mediapipe/` and `extension/models/`. The test photos come from MediaPipe's test assets.

## License

[MIT](LICENSE) © 2026 Tharush22. The bundled MediaPipe files keep their own Apache 2.0 license.
