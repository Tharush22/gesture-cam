// Loads the MediaPipe hand tracker from the files inside the extension.

/**
 * Returns { detect(image) } once the model has loaded. detect() gives back the hand points.
 * `url` turns a file path in the extension into a full link.
 */
export async function loadHandTracker(url) {
  // MediaPipe usually loads its engine with a <script> tag, but meeting sites block that.
  // So I load the engine myself and pass it to MediaPipe.
  const { default: moduleFactory } = await import(url("vendor/mediapipe/vision_wasm_module_internal.js"));
  const { HandLandmarker } = await import(url("vendor/mediapipe/vision_bundle.mjs"));
  const files = { wasmLoaderPath: "", wasmBinaryPath: url("vendor/mediapipe/vision_wasm_module_internal.wasm") };

  // MediaPipe prints normal status messages as warnings, like "OpenGL error checking is
  // disabled". Chrome shows them under the extension's Errors button, so I hide them.
  // Lines starting with I or W are just info or warnings. Real errors still show.
  const routine = /^\s*(?:[IW]\d{4} |INFO:)/;
  const quiet = (log) => (...args) => {
    if (!routine.test(String(args[0]))) log(...args);
  };
  globalThis.custom_dbg = quiet(console.warn);  // MediaPipe's own logger
  const factory = (moduleArg = {}) =>
    moduleFactory(Object.assign(moduleArg, { print: quiet(console.log), printErr: quiet(console.error) }));

  // Without a real graphics card, GPU mode is much slower than CPU mode, so skip it.
  const delegates = softwareGpu() ? ["CPU"] : ["GPU", "CPU"];
  let landmarker = null;
  for (const delegate of delegates) {
    try {
      globalThis.ModuleFactory = factory;  // MediaPipe clears this after loading, so set it each time
      landmarker = await HandLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: url("models/hand_landmarker.task"), delegate },
        runningMode: "VIDEO",
        numHands: 2,
      });
      break;
    } catch (err) {
      if (delegate === "CPU") throw err;
      console.info("[Gesture Cam] GPU hand tracking unavailable, using the CPU:", err);
    }
  }

  let lastTimestamp = 0;
  return {
    detect(image) {
      // Each frame needs a later timestamp than the one before.
      lastTimestamp = Math.max(lastTimestamp + 1, Math.round(performance.now()));
      return landmarker.detectForVideo(image, lastTimestamp).landmarks;
    },
  };
}

/** True when there's no real graphics card to use (the browser is faking one). */
function softwareGpu() {
  try {
    const gl = new OffscreenCanvas(1, 1).getContext("webgl2");
    if (!gl) return true;
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return /swiftshader|llvmpipe|software/i.test(renderer);
  } catch {
    return false;
  }
}
