// Content scripts listed in manifest.json can't be ES modules, so this one just imports the real
// entry point as a module. It still runs in the extension's isolated world, under the extension's
// security policy (which allows WebAssembly), not the meeting page's.
import(chrome.runtime.getURL("content/main.js")).catch((err) => console.error("[Gesture Cam] failed to start:", err));
