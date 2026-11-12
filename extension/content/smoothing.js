// Smooths a shaky signal, like a fingertip position from hand tracking.
//
// This is the "1€ filter" (Casiez, Roussel and Vogel, CHI 2012). The trick: when the finger moves
// slowly, smooth hard, which hides the jitter; when it moves fast, smooth lightly, which avoids lag.
// A fixed amount of smoothing can only do one of those two well.

export class OneEuroFilter {
  /**
   * minCutoff: smoothing when still (lower = smoother, laggier).
   * beta: how quickly smoothing eases off as speed goes up (higher = less lag on fast strokes).
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

  /** Feeds in a new reading `x` taken at time `t` (seconds) and returns the smoothed value. */
  filter(x, t) {
    if (this.value === null) {
      this.value = x;
      this.time = t;
      return x;
    }
    const dt = Math.max(1e-3, t - this.time);
    this.time = t;
    // How much of the new reading to take, for a given cutoff frequency (Hz).
    const weight = (cutoff) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));
    this.speed += weight(this.derivativeCutoff) * ((x - this.value) / dt - this.speed);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.speed);
    this.value += weight(cutoff) * (x - this.value);
    return this.value;
  }
}
