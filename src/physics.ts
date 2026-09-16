export type Vec3 = [number, number, number];

export interface Body {
  position: Vec3;
  velocity: Vec3;
  age: number;
  status: 'active' | 'captured' | 'escaped';
}

export interface GravityField {
  gravity: number;
  spin: number;
}

export function magnitude(v: Vec3): number {
  return Math.hypot(...v);
}

// A softened Paczynski-Wiita potential approximates relativistic infall.
// The spin term is an artistic frame-dragging approximation, not Kerr dynamics.
export function acceleration(position: Vec3, field: GravityField): Vec3 {
  const radius = Math.max(magnitude(position), 0.0001);
  const horizon = field.gravity;
  const gap = Math.max(radius - horizon, horizon * 0.15);
  const central = -12 * field.gravity / (gap * gap * radius);
  const drag = field.spin * 3.5 * horizon * horizon / (radius ** 4);
  return [
    position[0] * central - position[2] * drag,
    position[1] * central,
    position[2] * central + position[0] * drag,
  ];
}

export function stepBody(body: Body, dt: number, field: GravityField): void {
  if (body.status !== 'active' || dt <= 0) return;
  if (magnitude(body.position) <= field.gravity * 1.04) {
    body.status = 'captured';
    return;
  }
  const a = acceleration(body.position, field);
  for (let axis = 0; axis < 3; axis++) {
    body.position[axis] += body.velocity[axis] * dt + 0.5 * a[axis] * dt * dt;
  }
  // Capture before a large inward acceleration can fling a probe through the singularity.
  if (magnitude(body.position) <= field.gravity * 1.04) {
    body.status = 'captured';
    return;
  }
  const nextA = acceleration(body.position, field);
  for (let axis = 0; axis < 3; axis++) {
    body.velocity[axis] += 0.5 * (a[axis] + nextA[axis]) * dt;
  }
  body.age += dt;
  const radius = magnitude(body.position);
  const radialVelocity = body.position.reduce((sum, value, axis) => sum + value * body.velocity[axis], 0);
  if (radius > 65 && radialVelocity > 0) body.status = 'escaped';
}

export function createProbe(gravity: number, speed: number, impact: number, azimuth = 0): Body {
  const radius = 14 * Math.sqrt(gravity);
  const velocity = 2.2 * speed;
  const tangent = Math.max(-0.95, Math.min(0.95, impact));
  const inward = Math.sqrt(1 - tangent * tangent);
  const cos = Math.cos(azimuth);
  const sin = Math.sin(azimuth);
  return {
    position: [radius * cos, 0.45 * gravity, radius * sin],
    velocity: [
      velocity * (-inward * cos - tangent * sin),
      -0.015,
      velocity * (-inward * sin + tangent * cos),
    ],
    age: 0,
    status: 'active',
  };
}

export class FixedStepper {
  private accumulator = 0;
  readonly step = 1 / 120;

  advance(delta: number, tick: (dt: number) => void): void {
    this.accumulator += Math.max(0, Math.min(delta, 0.1));
    while (this.accumulator + 1e-10 >= this.step) {
      tick(this.step);
      this.accumulator -= this.step;
    }
  }

  reset(): void {
    this.accumulator = 0;
  }
}
