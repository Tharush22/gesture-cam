// Takes over the camera. This runs inside the meeting page, before the meeting app loads.
//
// When the meeting asks for the camera, I open it myself, run every frame through fx.js, and give
// the meeting my video instead. I also send small copies of frames to main.js, which finds hands
// and sends back commands.
//
// The two sides talk through a private MessageChannel, set up once with window.postMessage.
(() => {
  const app = (globalThis[Symbol.for("gesture-cam")] ??= {});
  if (app.camera) return;
  app.camera = true;

  const md = navigator.mediaDevices;
  const realGetUserMedia = md?.getUserMedia?.bind(md);
  const supported = typeof MediaStreamTrackProcessor === "function" && typeof MediaStreamTrackGenerator === "function";
  if (!realGetUserMedia || !supported || !app.fx) return;

  const LINK_ATTEMPTS = 40, LINK_RETRY_MS = 100;  // wait up to 4 seconds for main.js to answer
  const DETECT_WIDTH = 480;                       // width of the small copies sent for hand tracking

  // ------------------------------------------------------------------ link to the extension

  let port = null;
  let wantFrame = false;  // true when the hand tracker is ready for another frame

  const linked = new Promise((resolve) => {
    let attempts = 0;
    (function hello() {
      if (port) return;
      if (attempts++ >= LINK_ATTEMPTS) return resolve(false);
      // Make a new channel each try, because a port can only be sent once.
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
    const copy = frame.clone();  // copy it, because the original frame keeps moving
    createImageBitmap(copy, { resizeWidth: DETECT_WIDTH, resizeHeight: Math.round((DETECT_WIDTH * h) / w), resizeQuality: "medium" })
      .then((bitmap) => port.postMessage({ type: "frame", bitmap }, [bitmap]))
      .catch(() => { wantFrame = true; })
      .finally(() => copy.close());
  }

  // ------------------------------------------------------------------ streams

  const streams = [];  // camera streams I'm drawing on. The newest one is used for hand tracking.
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
      .catch(() => {})  // this happens normally when the camera stops
      .finally(() => {
        camera.stop();
        streams.splice(streams.indexOf(id), 1);
        reportCameras();
      });

    return new MediaStream([present(generator, camera), ...stream.getAudioTracks()]);
  }

  /**
   * Makes my video act like the real camera, so the meeting app sees the camera's name and settings.
   * The real camera only turns off once every copy of my video is stopped
   * (meeting apps often copy it for your self-view).
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
