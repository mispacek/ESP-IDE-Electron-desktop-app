export function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, Number(value) || 0));
}

export function dutyToMicroseconds(duty, frequency) {
  const hz = Number(frequency) || 0;
  return hz > 0 ? (Number(duty) || 0) / 65535 * 1_000_000 / hz : 0;
}

export function servoAngle(duty, frequency, minimumUs = 600, maximumUs = 2400) {
  const pulse = dutyToMicroseconds(duty, frequency);
  return clamp((pulse - minimumUs) * 180 / (maximumUs - minimumUs), 0, 180);
}

export function continuousServoSpeed(duty, frequency, minimumUs = 600, maximumUs = 2400) {
  const pulse = dutyToMicroseconds(duty, frequency);
  const centre = (minimumUs + maximumUs) / 2;
  const halfRange = (maximumUs - minimumUs) / 2;
  return clamp((pulse - centre) * 100 / halfRange, -100, 100);
}

export function integrateDegrees(angle, speedPercent, maxRpm, elapsedMs) {
  return angle + (Number(speedPercent) || 0) / 100 * (Number(maxRpm) || 0) * 6 * elapsedMs / 1000;
}
