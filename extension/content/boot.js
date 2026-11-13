// Chrome can't load content scripts as modules, so this file just loads main.js as one.
// It runs in the extension's own space, where hand tracking is allowed.
import(chrome.runtime.getURL("content/main.js")).catch((err) => console.error("[Gesture Cam] failed to start:", err));
