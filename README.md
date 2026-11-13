# Gesture Cam

Chrome extension that adds effects to your webcam when you do hand gestures. Works in Google Meet, Zoom and Teams (in the browser). Everyone in the call sees it.

## Gestures

- 👍 **Thumbs up**: confetti
- ✋ **Open palm**: privacy blur (again to turn off)
- 👉 **Finger gun**
- ✌️ **Peace sign**: fog mirror (again to clear)
  - index finger draws, middle finger erases
- 🤚 **Flat hand, palm up**: Rasengan
- 🙌 **Both hands up**: fake bad connection. Lags, freezes, then goes black. Again to come back.

## Install

1. Download `gesture-cam.zip` from the [latest release](https://github.com/Tharush22/gesture-cam/releases/latest) and unzip it
2. Go to `chrome://extensions` and turn on **Developer mode**
3. Click **Load unpacked** and pick the `gesture-cam` folder

Join a call with your camera on and a panel shows up in the corner. Hold a gesture for about half a second.

## Good to know

- **Private:** everything runs on your computer. Your video isn't sent anywhere except to the call like normal.
- Works in Chrome on a computer (also Edge, Brave and Arc). Not on phones.
- Keep your whole hand in the picture, about an arm's length from the camera.
- Your self-view is mirrored, so writing in the fog looks backwards to everyone else.

**Not working?**
- "Manifest file is missing": you picked the wrong folder. Pick the one with `manifest.json` in it.
- No panel: refresh the call page and turn your camera on.
- Each effect has a **Try** button to test it without the gesture.

## Tests

```bash
npm install
```
```bash
npm test
```

## Credits

Hand tracking by Google's [MediaPipe](https://ai.google.dev/edge/mediapipe) (Apache 2.0). Everything else is [MIT](LICENSE) © 2026 Tharush22.
