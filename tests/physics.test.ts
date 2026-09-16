import assert from 'node:assert/strict';
import { test } from 'node:test';
import { acceleration, createProbe, FixedStepper, magnitude, stepBody } from '../src/physics.ts';
import type { Body } from '../src/physics.ts';

const field = { gravity: 1, spin: 0 };

test('gravity points toward the center and strengthens with mass', () => {
  const weak = acceleration([10, 0, 0], field);
  const strong = acceleration([10, 0, 0], { gravity: 2, spin: 0 });
  assert.ok(weak[0] < 0);
  assert.equal(Math.abs(weak[1]), 0);
  assert.ok(Math.abs(strong[0]) > Math.abs(weak[0]));
});

test('frame dragging reverses with the spin direction', () => {
  const positive = acceleration([10, 0, 0], { gravity: 1, spin: 0.8 });
  const negative = acceleration([10, 0, 0], { gravity: 1, spin: -0.8 });
  assert.equal(positive[0], negative[0]);
  assert.equal(positive[2], -negative[2]);
  assert.ok(positive[2] > 0);
});

test('a direct probe is captured instead of tunneling through the horizon', () => {
  const body = createProbe(1, 1, 0);
  for (let i = 0; i < 4000 && body.status === 'active'; i++) stepBody(body, 1 / 120, field);
  assert.equal(body.status, 'captured');
  assert.ok(magnitude(body.position) <= 1.04);
  assert.ok(body.position.every(Number.isFinite));
});

test('a fast tangential probe can escape', () => {
  const body = createProbe(1, 2.5, 0.9);
  for (let i = 0; i < 15000 && body.status === 'active'; i++) stepBody(body, 1 / 120, field);
  assert.equal(body.status, 'escaped');
  assert.ok(magnitude(body.position) > 65);
});

test('velocity Verlet preserves a circular orbit in the non-spinning potential', () => {
  const radius = 8;
  const body: Body = {
    position: [radius, 0, 0], velocity: [0, 0, Math.sqrt(12 * radius) / (radius - 1)],
    age: 0, status: 'active',
  };
  const energy = (b: Body) => 0.5 * magnitude(b.velocity) ** 2 - 12 / (magnitude(b.position) - 1);
  const initialEnergy = energy(body);
  for (let i = 0; i < 12000; i++) stepBody(body, 1 / 120, field);
  assert.equal(body.status, 'active');
  assert.ok(Math.abs(magnitude(body.position) - radius) < 0.001);
  assert.ok(Math.abs(energy(body) - initialEnergy) < 0.0001);
});

test('fixed timestep produces identical trajectories across frame rates', () => {
  const simulate = (fps: number) => {
    const body = createProbe(1, 1.1, 0.5);
    const stepper = new FixedStepper();
    for (let i = 0; i < fps * 3; i++) stepper.advance(1 / fps, dt => stepBody(body, dt, field));
    return body;
  };
  assert.deepEqual(simulate(30), simulate(60));
  assert.deepEqual(simulate(60), simulate(144));
});

test('paused, completed, and invalid time increments do not move probes', () => {
  const body = createProbe(1, 1, 0.5);
  const original = structuredClone(body);
  stepBody(body, 0, field);
  stepBody(body, -1, field);
  assert.deepEqual(body, original);
  body.status = 'captured';
  const captured = structuredClone(body);
  stepBody(body, 1 / 120, field);
  assert.deepEqual(body, captured);
});

test('a probe already inside the horizon is captured immediately', () => {
  const body: Body = { position: [0, 0, 0], velocity: [0, 0, 0], age: 0, status: 'active' };
  stepBody(body, 1 / 120, field);
  assert.equal(body.status, 'captured');
  assert.ok(acceleration([0, 0, 0], field).every(Number.isFinite));
});

test('frame stalls are bounded and reset discards fractional accumulated time', () => {
  const stepper = new FixedStepper();
  let ticks = 0;
  stepper.advance(5, () => ticks++);
  assert.equal(ticks, 12);
  stepper.advance(0.001, () => ticks++);
  stepper.reset();
  stepper.advance(0.0075, () => ticks++);
  assert.equal(ticks, 12);
});

test('launch azimuth rotates position and velocity without changing their magnitudes', () => {
  const a = createProbe(1.65, 1.4, 0.6, 0);
  const b = createProbe(1.65, 1.4, 0.6, Math.PI / 3);
  assert.ok(Math.abs(magnitude(a.position) - magnitude(b.position)) < 1e-10);
  assert.ok(Math.abs(magnitude(a.velocity) - magnitude(b.velocity)) < 1e-10);
});
