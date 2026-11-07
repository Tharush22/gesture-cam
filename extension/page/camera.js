// Camera hook. Runs in the meeting page's own JavaScript world, before the meeting app loads.
//
// When the meeting asks for the camera, we open it, push every frame through page/fx.js, and give
// the meeting a new video track carrying the result. Now and then we also send a small copy of a
// frame to the extension's world (content/main.js), which looks for hands and sends back commands.
//
// The two worlds talk over a private MessageChannel. Its port is handed over once with
// window.postMessage; after that, frames (as ImageBitmaps) and commands go through the port.
(() => {
  const app = (globalThis[Symbol.for("gesture-cam")] ??= {});
  if (app.camera) return;
  app.camera = true;

  const md = navigator.mediaDevices;
  const realGetUserMedia = md?.getUserMedia?.bind(md);
  const supported = typeof MediaStreamTrackProcessor === "function" && typeof MediaStreamTrackGenerator === "function";
  if (!realGetUserMedia || !supported || !app.fx) return;

  const LINK_ATTEMPTS = 40, LINK_RETRY_MS = 100;  // give the extension's side up to 4 s to answer
  const DETECT_WIDTH = 480;                       // width of the copies sent for hand tracking

  // ------------------------------------------------------------------ link to the extension

  let port = null;
  let wantFrame = false;  // the hand tracker is free and waiting for a frame

  const linked = new Promise((resolve) => {
    let attempts = 0;
    (function hello() {
      if (port) return;
      if (attempts++ >= LINK_ATTEMPTS) return resolve(false);
      // A new channel per attempt: a port can only be handed over once.
      const channel = new MessageChannel();
      channel.port1.onmessage = (e) => {
        if (port || e.data?.type !== "ack") return;
        port = channel.port1;
        port.onmessage = onCommand;
        resolve(true);
      };
      window.postMessage({ gestureCam: "hello" }, "*", [channel.port2]);
      setTimeout(hello, LINK_RETRY_MS);
    })();
  });

  function onCommand(e) {
    const msg = e.data;
    if (msg?.type === "want") wantFrame = true;
    else if (msg?.type === "fx") app.fx.run(msg);
  }

  function sendFrame(frame) {
    wantFrame = false;
    const w = frame.displayWidth, h = frame.displayHeight;
    const copy = frame.clone();  // the original moves on down the pipeline before this resolves
    createImageBitmap(copy, { resizeWidth: DETECT_WIDTH, resizeHeight: Math.round((DETECT_WIDTH * h) / w), resizeQuality: "medium" })
      .then((bitmap) => port.postMessage({ type: "frame", bitmap }, [bitmap]))
      .catch(() => { wantFrame = true; })
      .finally(() => copy.close());
  }

  // ------------------------------------------------------------------ streams

  const streams = [];  // ids of the camera streams we're drawing on; the newest is tracked for hands
  let nextId = 1;

  function reportCameras() {
    port?.postMessage({ type: "cameras", count: streams.length });
  }

  function wrap(stream) {
    const camera = stream.getVideoTracks()[0];
    const processor = new MediaStreamTrackProcessor({ track: camera });
    const generator = new MediaStreamTrackGenerator({ kind: "video" });
    const id = nextId++;
    streams.push(id);
    reportCameras();

    let warned = false;
    const draw = new TransformStream({
      transform(frame, out) {
        if (wantFrame && id === streams.at(-1)) sendFrame(frame);
        let result = frame;
        try {
          result = app.fx.render(frame);
        } catch (err) {
          if (!warned) console.warn("[Gesture Cam] effect failed, sending the plain camera:", err);
          warned = true;
        }
        out.enqueue(result);
        if (result !== frame) frame.close();
      },
    });
    processor.readable.pipeThrough(draw).pipeTo(generator.writable)
      .catch(() => {})  // normal when the camera stops
      .finally(() => {
        camera.stop();
        streams.splice(streams.indexOf(id), 1);
        reportCameras();
      });

    return new MediaStream([present(generator, camera), ...stream.getAudioTracks()]);
  }

  /**
   * Makes our track behave like the camera to the meeting app: it reports the camera's name and
   * settings, and resolution changes go to the camera. The camera turns off once every copy of our
   * track has been stopped (apps often clone the track for the self-view).
   */
  function present(track, camera) {
    let live = 0;
    const adopt = (t) => {
      live++;
      let stopped = false;
      const stop = t.stop.bind(t), clone = t.clone.bind(t);
      t.stop = () => {
        if (stopped) return;
        stopped = true;
        stop();
        if (--live === 0) camera.stop();
      };
      t.clone = () => adopt(clone());
      for (const name of ["getSettings", "getCapabilities", "getConstraints", "applyConstraints"]) {
        t[name] = camera[name].bind(camera);
      }
      Object.defineProperty(t, "label", { get: () => camera.label });
      return t;
    };
    return adopt(track);
  }

  md.getUserMedia = async function getUserMedia(constraints) {
    const stream = await realGetUserMedia(constraints);
    if (stream.getVideoTracks().length === 0 || !(await linked)) return stream;
    try {
      return wrap(stream);
    } catch (err) {
      console.warn("[Gesture Cam] couldn't hook the camera, sending it as is:", err);
      return stream;
    }
  };
})();
