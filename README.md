# Gesture Cam

A Chrome extension that adds effects to your webcam in video calls when you make hand gestures. Everyone in the call sees them.

It works in Google Meet, and in Zoom and Microsoft Teams when you use them in the browser.

## Gestures

| Gesture | Effect |
|---|---|
| 👍 Thumbs up | Confetti shoots out from your thumb |
| ✋ Open palm | Privacy mode: blurs your video into big pixels. Do it again to turn it off. |
| 👉 Finger gun | Muzzle flash, "BANG!", screen shake and smoke |
| ✌️ Peace sign | Fog mirror: your video fogs up like a bathroom mirror. Do it again to clear it. |
| 🤚 Hand flat, palm up | Rasengan: a spinning ball of light above your hand while you hold it there |
| 🙌 Both hands up | Bad connection: your video lags, freezes, then goes black like your internet died. Both hands up again to come back. |

### Drawing on the fog mirror

When the fog is on:

- Point with only your **index finger** to draw a clear line in the fog.
- Point with only your **middle finger** to erase.
- Lines slowly fog over again after about 15 seconds.

Your own self-view is mirrored, so your writing looks normal to you. Other people in the call see it backwards, like writing on a window from the other side.

## How to install

1. Download this repo (**Code → Download ZIP**) and unzip it.
2. Go to `chrome://extensions` in Chrome.
3. Turn on **Developer mode** in the top right.
4. Click **Load unpacked** and pick the `extension` folder.

## How to use

1. Join a call and turn your camera on.
2. A small **Gesture Cam** panel shows up in the corner. Only you can see it.
3. Wait for the light to turn green (hand tracking takes a few seconds to load).
4. Make a gesture and hold it for about half a second.

Each effect has a **Try** button to test it without the gesture, and a switch to turn it off. You can drag the panel around or fold it with **–**.

Tip: keep your whole hand in the picture, about an arm's length from the camera.

## How it works

```
 Meeting page                                      Extension
 ────────────                                      ─────────
 camera.js                                         main.js
   takes over the camera                             finds your hands (MediaPipe)
   camera → fx.js → video sent to the meeting  ── small copies ──▶  gestures.js
            (draws the effects)                ◀── "confetti" ───   decides what to do
```

- **`page/camera.js`** takes over the camera before the meeting app loads. Every frame goes through `fx.js` before the meeting gets it.
- **`page/fx.js`** draws all the effects with a 2D canvas. If no effect is on, the video is passed through as it is.
- **`content/main.js`** gets small copies of the frames and uses MediaPipe to find your hands. It runs separately because meeting sites block MediaPipe from running inside the page.
- **`content/gestures.js`** looks at the 21 points MediaPipe gives for each hand, checks which fingers are straight or curled, and works out the gesture.
- **`content/smoothing.js`** smooths the fingertip position so drawing on the fog isn't shaky.

Hand tracking shares the same thread as the video, so it waits between checks. On a slow computer the video stays smooth and gestures are just a bit slower.

## Adding a new gesture

1. **Gesture:** add a rule to `classify()` in `extension/content/gestures.js`.
2. **Effect:** add a function to `extension/page/fx.js`, call it from `run()`, and draw it in `render()`.
3. **Connect them:** add a row to `EFFECTS` in `extension/content/panel.js`, a `Latch` in `extension/content/main.js`, and a line in `fire()`.

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

- `npm test` runs the hand tracker on real hand photos in `test/images/` and checks each gesture is recognised correctly, including ones that shouldn't do anything, like a fist.
- `npm run test:e2e` loads the extension in Chrome with the photos as a fake webcam and checks the effects show up in the video. It needs `ffmpeg` and saves screenshots to `test/out/`.

## Credits

Hand tracking uses Google's [MediaPipe](https://ai.google.dev/edge/mediapipe) (Apache License 2.0). It's included in `extension/vendor/mediapipe/` and `extension/models/`. The test photos are from MediaPipe's test files.

## License

[MIT](LICENSE) © 2026 Tharush22. The MediaPipe files keep their own Apache 2.0 license.
