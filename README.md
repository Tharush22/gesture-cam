# Gesture Cam

Chrome extension that adds effects to your webcam when you do hand gestures. Works in Google Meet, Zoom and Teams (in the browser). Everyone in the call sees it.

## Gestures

- 👍 **Thumbs up**: confetti
- ✋ **Open palm**: privacy blur (again to turn off)
- 👉 **Finger gun**: BANG!
- ✌️ **Peace sign**: fog mirror (again to clear)
  - index finger draws, middle finger erases
- 🤚 **Flat hand, palm up**: Rasengan
- 🙌 **Both hands up**: fake bad connection. Lags, freezes, then goes black. Again to come back.

## Install

1. Download the ZIP and unzip it
2. Go to `chrome://extensions` and turn on **Developer mode**
3. Click **Load unpacked** and pick the `extension` folder

Join a call with your camera on and a panel shows up in the corner. Hold a gesture for about half a second.

## Tests

```bash
npm install
```
```bash
npm test
```

## Credits

Hand tracking by Google's [MediaPipe](https://ai.google.dev/edge/mediapipe) (Apache 2.0). Everything else is [MIT](LICENSE) © 2026 Tharush22.
