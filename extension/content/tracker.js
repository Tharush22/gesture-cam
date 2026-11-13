// Loads MediaPipe's hand tracker from the files bundled with the extension.

/**
 * Resolves to { detect(image) -> landmarks[] } once the model is loaded.
 * `url` turns an extension path into a full chrome-extension:// URL.
 */
export async function loadHandTracker(url) {
  // MediaPipe normally loads its WebAssembly glue code by adding a <script> tag. On a meeting page
  // that tag would run in the page's world and be blocked by the site's security policy, so we
  // import the ES-module build of the glue ourselves and hand MediaPipe the factory it exports.
  const { default: moduleFactory } = await import(url("vendor/mediapipe/vision_wasm_module_internal.js"));
  const { HandLandmarker } = await import(url("vendor/mediapipe/vision_bundle.mjs"));
  const files = { wasmLoaderPath: "", wasmBinaryPath: url("vendor/mediapipe/vision_wasm_module_internal.wasm") };

  // MediaPipe prints routine status lines as warnings and errors, for example
  // "W1112 06:36:07 gl_context.cc] OpenGL error checking is disabled" or
  // "INFO: Created TensorFlow Lite XNNPACK delegate for CPU". Chrome lists those under the
  // extension's red "Errors" button, which looks alarming, so drop them. Lines starting with I or W
  // are info and warnings; real problems (E..., or anything else) still get through.
  const routine = /^\s*(?:[IW]\d{4} |INFO:)/;
  const quiet = (log) => (...args) => {
    if (!routine.test(String(args[0]))) log(...args);
  };
  globalThis.custom_dbg = quiet(console.warn);  // MediaPipe's own logger (it set a noisy one on import)
  const factory = (moduleArg = {}) =>
    moduleFactory(Object.assign(moduleArg, { print: quiet(console.log), printErr: quiet(console.error) }));

  // A software-emulated GPU is several times slower than the CPU path, so skip it.
  const delegates = softwareGpu() ? ["CPU"] : ["GPU", "CPU"];
  let landmarker = null;
  for (const delegate of delegates) {
    try {
      globalThis.ModuleFactory = factory;  // MediaPipe clears this after each load
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
      // VIDEO mode needs strictly increasing timestamps.
      lastTimestamp = Math.max(lastTimestamp + 1, Math.round(performance.now()));
      return landmarker.detectForVideo(image, lastTimestamp).landmarks;
    },
  };
}

/** True when the browser draws WebGL in software (no usable graphics card, or it's been blocked). */
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
