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

  // A software-emulated GPU is several times slower than the CPU path, so skip it.
  const delegates = softwareGpu() ? ["CPU"] : ["GPU", "CPU"];
  let landmarker = null;
  for (const delegate of delegates) {
    try {
      globalThis.ModuleFactory = moduleFactory;  // MediaPipe clears this after each load
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
