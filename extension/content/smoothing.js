// Smooths out a shaky fingertip position so drawn lines aren't wobbly.
//
// This uses the "1 euro filter", a known way to smooth pointer input.
// When the finger moves slowly, it smooths a lot (hides the shaking).
// When the finger moves fast, it smooths less (so the line doesn't lag behind).

export class OneEuroFilter {
  /**
   * minCutoff: how much to smooth when the finger is still (lower = smoother but slower).
   * beta: how much less to smooth as the finger speeds up (higher = less lag).
   */
  constructor(minCutoff = 1.2, beta = 12, derivativeCutoff = 1) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.derivativeCutoff = derivativeCutoff;
    this.reset();
  }

  reset() {
    this.value = null;
    this.speed = 0;
    this.time = 0;
  }

  /** Takes a new position `x` at time `t` (in seconds) and returns the smoothed position. */
  filter(x, t) {
    if (this.value === null) {
      this.value = x;
      this.time = t;
      return x;
    }
    const dt = Math.max(1e-3, t - this.time);
    this.time = t;
    // How much of the new position to use. Higher cutoff = follow it more closely.
    const weight = (cutoff) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));
    this.speed += weight(this.derivativeCutoff) * ((x - this.value) / dt - this.speed);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.speed);
    this.value += weight(cutoff) * (x - this.value);
    return this.value;
  }
}
