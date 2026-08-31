const QUADRATURE_STATES = Object.freeze([
  Object.freeze([0, 0]),
  Object.freeze([1, 0]),
  Object.freeze([1, 1]),
  Object.freeze([0, 1]),
]);

export function encoderButtonLevel(pressed) {
  return pressed ? 0 : 1;
}

/**
 * DOM-free rotary encoder model. One logical detent is represented by four
 * electrical transitions so Pin.IRQ handlers see the same sequence as on a
 * quadrature encoder.
 */
export class RotaryEncoderModel {
  constructor({ stepAngle = 18 } = {}) {
    this.stepAngle = Number(stepAngle) || 18;
    this.reset();
  }

  reset() {
    this.angle = 0;
    this.quadrature = 0;
    this.queuedSteps = 0;
    this.transition = 0;
    this.currentDirection = 0;
  }

  step(direction) {
    const sign = Number(direction) >= 0 ? 1 : -1;
    this.queuedSteps += sign;
  }

  /** Return the next electrical transition, or null when the model is idle. */
  advance() {
    if (!this.queuedSteps && this.transition === 0) return null;

    if (this.transition === 0) {
      this.currentDirection = this.queuedSteps > 0 ? 1 : -1;
      this.queuedSteps -= this.currentDirection;
      this.angle += this.currentDirection * this.stepAngle;
    }

    this.quadrature = (this.quadrature + (this.currentDirection > 0 ? 1 : 3)) % 4;
    const [a, b] = QUADRATURE_STATES[this.quadrature];
    this.transition = (this.transition + 1) % 4;
    return {
      a,
      b,
      angle: this.angle,
      direction: this.currentDirection,
      complete: this.transition === 0,
    };
  }
}

export { QUADRATURE_STATES };
