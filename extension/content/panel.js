// The small control panel on the meeting page. Only you can see it, the meeting only gets the
// video. It's kept in a shadow root so the meeting page's styles don't mess it up.

const STYLE = `
:host { all: initial; }
.card {
  position: fixed; right: 16px; bottom: 96px; z-index: 2147483647; width: 260px;
  font: 13px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: #eef0f6; background: rgba(18, 20, 30, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 14px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4); user-select: none;
}
header { display: flex; align-items: center; gap: 8px; padding: 10px 12px; cursor: grab; }
header:active { cursor: grabbing; }
.light { width: 8px; height: 8px; border-radius: 50%; background: #6b7280; flex: none; }
.light.loading { background: #fbbf24; }
.light.ready { background: #34d399; box-shadow: 0 0 6px #34d399; }
.light.error { background: #f87171; }
h1 { all: unset; font-weight: 650; flex: 1; }
.fold { all: unset; cursor: pointer; color: #a3a9b8; width: 20px; text-align: center; font-size: 16px; }
.fold:hover { color: #fff; }
main { display: grid; gap: 8px; padding: 0 12px 12px; }
.folded main { display: none; }
.status { color: #a3a9b8; font-size: 12px; min-height: 17px; }
.effect { display: grid; grid-template-columns: 1fr auto auto; align-items: center; gap: 8px;
  padding: 8px 10px; border-radius: 10px; background: rgba(255, 255, 255, 0.05); }
.effect.seen { background: rgba(52, 211, 153, 0.18); }
.effect b { display: block; font-weight: 600; }
.effect small { color: #a3a9b8; font-size: 11.5px; }
.try { all: unset; cursor: pointer; font-size: 12px; padding: 3px 8px; border-radius: 6px; background: #2b3346; }
.try:hover { background: #38425b; }
.try.on { background: #6366f1; }
.toggle { all: unset; cursor: pointer; width: 32px; height: 18px; border-radius: 9px; background: #3a4152; position: relative; }
.toggle::after { content: ""; position: absolute; top: 3px; left: 3px; width: 12px; height: 12px;
  border-radius: 50%; background: #fff; transition: left .15s; }
.toggle[aria-checked="true"] { background: #22c55e; }
.toggle[aria-checked="true"]::after { left: 17px; }
.try:focus-visible, .toggle:focus-visible, .fold:focus-visible { outline: 2px solid #a5b4fc; outline-offset: 2px; }
`;

export const EFFECTS = [
  { key: "confetti", title: "Confetti", how: "Thumbs up", gesture: "thumbsUp" },
  { key: "privacy", title: "Privacy blur", how: "Open palm (toggles)", gesture: "openPalm" },
  { key: "bang", title: "Bang!", how: "Finger gun", gesture: "fingerGun" },
  { key: "fog", title: "Fog mirror", how: "Peace sign (toggles)", gesture: "peace" },
  { key: "orb", title: "Rasengan", how: "Hand laid flat", gesture: "flatHand" },
  { key: "lag", title: "Bad connection", how: "Both hands up (toggles)", gesture: "bothHandsUp" },
];

export class Panel {
  /**
   * settings: which effects are on, and whether the panel is folded.
   * on: what to do when a switch, Try button or the fold button is clicked.
   */
  constructor(settings, on) {
    const host = document.createElement("gesture-cam-panel");
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${STYLE}</style>
      <section class="card${settings.folded ? " folded" : ""}" aria-label="Gesture Cam">
        <header>
          <span class="light loading"></span>
          <h1>Gesture Cam</h1>
          <button class="fold" aria-label="Show or hide controls">${settings.folded ? "+" : "–"}</button>
        </header>
        <main>
          <div class="status" aria-live="polite">Loading hand tracking…</div>
          ${EFFECTS.map((e) => `
            <div class="effect" data-key="${e.key}">
              <span><b>${e.title}</b><small>${e.how}</small></span>
              <button class="try" title="Try it without the gesture">Try</button>
              <button class="toggle" role="switch" aria-checked="${!!settings[e.key]}" aria-label="${e.title} gesture"></button>
            </div>`).join("")}
        </main>
      </section>`;

    this.$ = (sel) => root.querySelector(sel);
    for (const row of root.querySelectorAll(".effect")) {
      const key = row.dataset.key;
      row.querySelector(".try").addEventListener("click", () => on.tryEffect(key));
      const toggle = row.querySelector(".toggle");
      toggle.addEventListener("click", () => {
        const value = toggle.getAttribute("aria-checked") !== "true";
        toggle.setAttribute("aria-checked", String(value));
        on.toggle(key, value);
      });
    }
    this.$(".fold").addEventListener("click", () => {
      const folded = this.$(".card").classList.toggle("folded");
      this.$(".fold").textContent = folded ? "+" : "–";
      on.fold(folded);
    });
    this.#draggable(this.$(".card"), this.$("header"));

    const mount = () => document.documentElement.append(host);
    if (document.body) mount();
    else document.addEventListener("DOMContentLoaded", mount, { once: true });
  }

  /** state: "loading" | "ready" | "error" */
  setState(state, text) {
    this.$(".light").className = `light ${state}`;
    this.status = text;
    this.showStatus(text);
  }

  /** Shows a message in the status line. With no text, it goes back to the normal message. */
  showStatus(text = this.status) {
    const el = this.$(".status");
    if (el.textContent !== text) el.textContent = text;
  }

  /** Highlights the effects whose gestures are in view right now. */
  showSeen(gestures) {
    for (const e of EFFECTS) this.$(`.effect[data-key="${e.key}"]`).classList.toggle("seen", gestures.has(e.gesture));
  }

  /** Lights up the Try button while an on/off effect (like privacy or fog) is on. */
  showOn(key, on) {
    const button = this.$(`.effect[data-key="${key}"] .try`);
    button.classList.toggle("on", on);
    button.textContent = on ? "Turn off" : "Try";
  }

  #draggable(card, handle) {
    let grab = null;
    handle.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button")) return;
      const r = card.getBoundingClientRect();
      grab = { x: e.clientX - r.left, y: e.clientY - r.top };
      handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener("pointermove", (e) => {
      if (!grab) return;
      const x = Math.min(innerWidth - 80, Math.max(0, e.clientX - grab.x));
      const y = Math.min(innerHeight - 40, Math.max(0, e.clientY - grab.y));
      Object.assign(card.style, { left: `${x}px`, top: `${y}px`, right: "auto", bottom: "auto" });
    });
    handle.addEventListener("pointerup", () => { grab = null; });
  }
}
