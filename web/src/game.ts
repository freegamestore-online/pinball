import type { FlipperInput } from "./input";

type Sounds = { playMove(): void; playScore(): void; playClear(): void; playLevelUp(): void; playError(): void };

// ─── Field constants (logical pixels — canvas scales via CSS) ───
export const FIELD_W = 280;
export const FIELD_H = 400;
export const BALL_R = 6;

export const GRAVITY = 0.0013; // px/ms²
export const FRICTION_PER_MS = 0.9994; // multiplicative per ms
export const WALL_RESTITUTION = 0.72;
export const BUMPER_RESTITUTION = 1.06;
export const MAX_SPEED = 1.8;

// Flippers
export const FLIPPER_LEN = 44;
export const FLIPPER_W = 9;
export const LEFT_PIVOT = { x: 92, y: 358 };
export const RIGHT_PIVOT = { x: 188, y: 358 };
export const LEFT_REST_ANG = 0.45;       // ~26° below horizontal
export const LEFT_RAISED_ANG = -0.55;    // ~31° above horizontal
export const RIGHT_REST_ANG = Math.PI - 0.45;
export const RIGHT_RAISED_ANG = Math.PI + 0.55;
export const FLIP_RATE = 0.028; // rad/ms — how fast the flipper rotates
export const FLIPPER_BOOST = 0.5; // px/ms imparted by an actively-raising flipper

// Score events
export const POINTS_BUMPER = 100;
export const POINTS_SLINGSHOT = 50;
export const POINTS_WALL_BOUNCE = 5;
export const POINTS_DROP_TARGET = 250;
export const POINTS_ALL_DROP_BONUS = 1500;

export const MULTIPLIER_DURATION = 9000; // ms of 2× scoring after clearing all targets
export const DROP_RESET_DELAY = 5500;    // ms before fallen targets pop back up
export const SHAKE_MS = 320;             // drain tilt-shake duration

export const START_BALLS = 3;

export interface Vec { x: number; y: number; }
export interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  alive: boolean;
  trail: Array<{ x: number; y: number }>;
}
export interface DropTarget {
  x: number;
  y: number;
  w: number;
  h: number;
  down: boolean;     // true once hit, false when reset
  hitFlash: number;  // ms remaining of "just hit" glow
}
export interface ScorePopup {
  x: number;
  y: number;
  text: string;
  color: string;
  age: number;
}
export interface Bumper {
  x: number;
  y: number;
  r: number;
  points: number;
  flash: number; // ms remaining
}
export interface Slingshot {
  // triangle with a 45° hypotenuse; we represent it as a line segment that
  // imparts an extra push when struck.
  ax: number; ay: number;
  bx: number; by: number;
  flash: number;
}
export interface Wall {
  ax: number; ay: number;
  bx: number; by: number;
}
export interface Flipper {
  pivot: Vec;
  rest: number;
  raised: number;
  angle: number;     // current
  prevAngle: number; // last frame — used for angular velocity
  raising: boolean;
}


export interface GameState {
  ball: Ball | null;
  leftFlip: Flipper;
  rightFlip: Flipper;
  bumpers: Bumper[];
  slingshots: Slingshot[];
  walls: Wall[];
  dropTargets: DropTarget[];
  dropResetTimer: number; // > 0 means all-cleared, will reset after this many ms
  multiplier: number;     // current score multiplier (1 or 2)
  multiplierTimer: number;// ms remaining of multiplier
  popups: ScorePopup[];
  shake: number;          // ms remaining of tilt-shake
  ballsLeft: number;
  score: number;
  time: number;
  frame: number;
}

export function freshFlipper(side: "left" | "right"): Flipper {
  const pivot = side === "left" ? LEFT_PIVOT : RIGHT_PIVOT;
  const rest = side === "left" ? LEFT_REST_ANG : RIGHT_REST_ANG;
  const raised = side === "left" ? LEFT_RAISED_ANG : RIGHT_RAISED_ANG;
  return { pivot, rest, raised, angle: rest, prevAngle: rest, raising: false };
}

export function buildWalls(): Wall[] {
  const W: Wall[] = [];
  // Outer box (open at top so ball can drop into top arc / chute later if added).
  // Top:
  W.push({ ax: 6, ay: 24, bx: FIELD_W - 6, by: 24 });
  // Top-left arc (3 lines)
  W.push({ ax: 6, ay: 24, bx: 14, by: 50 });
  W.push({ ax: 14, ay: 50, bx: 6, by: 90 });
  // Left side
  W.push({ ax: 6, ay: 90, bx: 6, by: 320 });
  // Bottom-left inward funnel toward flipper pivot
  W.push({ ax: 6, ay: 320, bx: 60, by: 372 });
  // Right side
  W.push({ ax: FIELD_W - 6, ay: 24, bx: FIELD_W - 6, by: 320 });
  // Bottom-right inward funnel
  W.push({ ax: FIELD_W - 6, ay: 320, bx: FIELD_W - 60, by: 372 });
  return W;
}

export function buildSlingshots(): Slingshot[] {
  // Two triangular cushions above the flippers — the diagonal face of each
  // is a "live" slingshot segment that gives an extra push.
  return [
    { ax: 30, ay: 290, bx: 70, by: 330, flash: 0 },   // left slingshot diagonal
    { ax: FIELD_W - 70, ay: 330, bx: FIELD_W - 30, by: 290, flash: 0 }, // right
  ];
}

export function buildBumpers(): Bumper[] {
  // Classic triangle of pop bumpers in upper-middle field.
  return [
    { x: 80,  y: 130, r: 14, points: POINTS_BUMPER, flash: 0 },
    { x: 200, y: 130, r: 14, points: POINTS_BUMPER, flash: 0 },
    { x: 140, y: 90,  r: 14, points: POINTS_BUMPER, flash: 0 },
    { x: 140, y: 180, r: 12, points: POINTS_BUMPER, flash: 0 },
  ];
}

export function buildDropTargets(): DropTarget[] {
  // Row of 4 drop targets across the middle of the playfield.
  const targets: DropTarget[] = [];
  const startX = 40;
  const gap = 50;
  const y = 240;
  for (let i = 0; i < 4; i++) {
    targets.push({ x: startX + i * gap, y, w: 36, h: 8, down: false, hitFlash: 0 });
  }
  return targets;
}

export function freshState(): GameState {
  return {
    ball: null,
    leftFlip: freshFlipper("left"),
    rightFlip: freshFlipper("right"),
    bumpers: buildBumpers(),
    slingshots: buildSlingshots(),
    walls: buildWalls(),
    dropTargets: buildDropTargets(),
    dropResetTimer: 0,
    multiplier: 1,
    multiplierTimer: 0,
    popups: [],
    shake: 0,
    ballsLeft: START_BALLS,
    score: 0,
    time: 0,
    frame: 0,
  };
}

export function launchBall(): Ball {
  // Drop from near top-center with a slight random sideways nudge.
  return {
    x: FIELD_W / 2 + (Math.random() - 0.5) * 20,
    y: 40,
    vx: (Math.random() - 0.5) * 0.2,
    vy: 0.05,
    alive: true,
    trail: [],
  };
}

// ─── Vector / geometry helpers ───

export function clampLen(vx: number, vy: number, max: number): [number, number] {
  const s = Math.hypot(vx, vy);
  if (s > max) {
    const k = max / s;
    return [vx * k, vy * k];
  }
  return [vx, vy];
}

// Closest point on segment a→b to point p.
export function closestPointOnSeg(ax: number, ay: number, bx: number, by: number, px: number, py: number): { x: number; y: number; t: number } {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return { x: ax, y: ay, t: 0 };
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  return { x: ax + dx * t, y: ay + dy * t, t };
}

// Reflect velocity vector against a normal (assumed unit-length).
export function reflect(vx: number, vy: number, nx: number, ny: number, rest: number): [number, number] {
  const dot = vx * nx + vy * ny;
  const rvx = (vx - 2 * dot * nx) * rest;
  const rvy = (vy - 2 * dot * ny) * rest;
  return [rvx, rvy];
}

// ─── Collision routines ───

// Ball vs line segment. Returns true if collision applied.
export function collideLine(
  b: Ball,
  ax: number, ay: number, bx: number, by: number,
  rest: number,
  thickness: number,
): boolean {
  const cp = closestPointOnSeg(ax, ay, bx, by, b.x, b.y);
  const dx = b.x - cp.x;
  const dy = b.y - cp.y;
  const d = Math.hypot(dx, dy);
  const radius = BALL_R + thickness;
  if (d >= radius) return false;
  if (d === 0) {
    // Degenerate — pick an arbitrary normal
    b.x += radius;
    return true;
  }
  const nx = dx / d;
  const ny = dy / d;
  // Push out
  const push = radius - d + 0.1;
  b.x += nx * push;
  b.y += ny * push;
  // Reflect only if moving into the surface
  const into = b.vx * (-nx) + b.vy * (-ny);
  if (into > 0) {
    [b.vx, b.vy] = reflect(b.vx, b.vy, nx, ny, rest);
  }
  return true;
}

// Ball vs circular bumper. Returns true if it was an active hit (bounced).
export function collideBumper(b: Ball, bumper: Bumper): boolean {
  const dx = b.x - bumper.x;
  const dy = b.y - bumper.y;
  const d = Math.hypot(dx, dy);
  const radius = BALL_R + bumper.r;
  if (d >= radius) return false;
  const nx = d === 0 ? 1 : dx / d;
  const ny = d === 0 ? 0 : dy / d;
  const push = radius - d + 0.1;
  b.x += nx * push;
  b.y += ny * push;
  [b.vx, b.vy] = reflect(b.vx, b.vy, nx, ny, BUMPER_RESTITUTION);
  // Small minimum kick so a slow ball doesn't sit on the bumper.
  const speed = Math.hypot(b.vx, b.vy);
  if (speed < 0.25) {
    b.vx = nx * 0.35;
    b.vy = ny * 0.35;
  }
  return true;
}

// Ball vs axis-aligned rectangle (used for drop targets).
export function collideAabb(b: Ball, x: number, y: number, w: number, h: number, rest: number): boolean {
  const cx = Math.max(x, Math.min(b.x, x + w));
  const cy = Math.max(y, Math.min(b.y, y + h));
  const dx = b.x - cx;
  const dy = b.y - cy;
  const d = Math.hypot(dx, dy);
  if (d >= BALL_R) return false;
  let nx: number, ny: number;
  if (d === 0) { nx = 0; ny = -1; }
  else { nx = dx / d; ny = dy / d; }
  const push = BALL_R - d + 0.1;
  b.x += nx * push;
  b.y += ny * push;
  const into = b.vx * (-nx) + b.vy * (-ny);
  if (into > 0) [b.vx, b.vy] = reflect(b.vx, b.vy, nx, ny, rest);
  return true;
}

// Ball vs flipper (capsule from pivot toward tip at current angle).
export function collideFlipper(b: Ball, f: Flipper, dt: number): boolean {
  const tipX = f.pivot.x + Math.cos(f.angle) * FLIPPER_LEN;
  const tipY = f.pivot.y + Math.sin(f.angle) * FLIPPER_LEN;
  const cp = closestPointOnSeg(f.pivot.x, f.pivot.y, tipX, tipY, b.x, b.y);
  const dx = b.x - cp.x;
  const dy = b.y - cp.y;
  const d = Math.hypot(dx, dy);
  const radius = BALL_R + FLIPPER_W / 2;
  if (d >= radius) return false;
  if (d === 0) {
    b.x += radius;
    return true;
  }
  const nx = dx / d;
  const ny = dy / d;
  const push = radius - d + 0.1;
  b.x += nx * push;
  b.y += ny * push;
  // Reflect
  const into = b.vx * (-nx) + b.vy * (-ny);
  if (into > 0) {
    [b.vx, b.vy] = reflect(b.vx, b.vy, nx, ny, 0.85);
  }
  // If flipper is mid-swing toward "raised", add angular impulse along its
  // tangent at the contact point. Magnitude scales with how far along the
  // flipper the hit is.
  if (f.raising && dt > 0) {
    const omega = (f.angle - f.prevAngle) / dt; // rad/ms (signed)
    if (Math.abs(omega) > 0.005) {
      const r = Math.hypot(cp.x - f.pivot.x, cp.y - f.pivot.y);
      // Tangent direction is perpendicular to the arm, rotated 90° in
      // the direction of motion. For left flipper, raising means angle
      // decreases (becomes more negative), so omega < 0 → tangent points
      // up. Right flipper raising = angle increases, omega > 0 → tangent
      // also points up. We bake the sign through omega.
      const armX = Math.cos(f.angle);
      const armY = Math.sin(f.angle);
      // perpendicular (rotated 90° CW): (armY, -armX)
      const tx = armY;
      const ty = -armX;
      const v = omega * r;
      b.vx += tx * v * FLIPPER_BOOST;
      b.vy += ty * v * FLIPPER_BOOST;
    }
  }
  return true;
}


export function animateFlipper(f: Flipper, pressed: boolean, dt: number) {
  f.prevAngle = f.angle;
  const target = pressed ? f.raised : f.rest;
  // Direction-aware rotation
  if (f.angle < target) {
    f.angle = Math.min(target, f.angle + FLIP_RATE * dt);
  } else if (f.angle > target) {
    f.angle = Math.max(target, f.angle - FLIP_RATE * dt);
  }
  f.raising = pressed && f.angle !== target;
}

/**
 * Advance one frame by `dt` ms. Flippers, flashes and timers always run; the
 * ball only moves while `playing`. Mutates `s`; returns true when the ball drained.
 */
export function stepGame(
  s: GameState,
  dt: number,
  input: FlipperInput,
  playing: boolean,
  sounds: Sounds | null,
): boolean {
  // Always animate flippers (even between balls) — better tactile feel
  const lp = input.left;
  const rp = input.right;
  animateFlipper(s.leftFlip, lp, dt);
  animateFlipper(s.rightFlip, rp, dt);

  // Decay flash timers on bumpers + slingshots + drop targets
  for (const b of s.bumpers) b.flash = Math.max(0, b.flash - dt);
  for (const sl of s.slingshots) sl.flash = Math.max(0, sl.flash - dt);
  for (const dt2 of s.dropTargets) dt2.hitFlash = Math.max(0, dt2.hitFlash - dt);
  s.shake = Math.max(0, s.shake - dt);

  // Decay popups
  const livePopups: ScorePopup[] = [];
  for (const p of s.popups) {
    p.age += dt;
    if (p.age < 900) livePopups.push(p);
  }
  s.popups = livePopups;

  // Multiplier countdown
  if (s.multiplierTimer > 0) {
    s.multiplierTimer = Math.max(0, s.multiplierTimer - dt);
    if (s.multiplierTimer === 0) s.multiplier = 1;
  }

  // Drop-target reset cycle: once player cleared the row, repopulate after
  // DROP_RESET_DELAY so the row can be hit again.
  if (s.dropResetTimer > 0) {
    s.dropResetTimer = Math.max(0, s.dropResetTimer - dt);
    if (s.dropResetTimer === 0) {
      for (const t of s.dropTargets) { t.down = false; t.hitFlash = 0; }
    }
  }

  if (!playing) return false;

  const ball = s.ball;
  if (!ball || !ball.alive) return false;

  // Apply gravity + friction
  ball.vy += GRAVITY * dt;
  const f = Math.pow(FRICTION_PER_MS, dt);
  ball.vx *= f;
  ball.vy *= f;
  [ball.vx, ball.vy] = clampLen(ball.vx, ball.vy, MAX_SPEED);

  // Ball trail — append each frame, capped
  ball.trail.push({ x: ball.x, y: ball.y });
  if (ball.trail.length > 8) ball.trail.shift();

  // Substepped motion + collisions. Enough substeps that the ball moves at
  // most half its radius per substep, and each substep uses the velocity left
  // by the previous one's bounces, so a fast ball can't tunnel through a wall.
  const substeps = Math.max(3, Math.ceil((Math.hypot(ball.vx, ball.vy) * dt) / (BALL_R / 2)));
  const subDt = dt / substeps;
  for (let i = 0; i < substeps; i++) {
    ball.x += ball.vx * subDt;
    ball.y += ball.vy * subDt;

    // Walls
    for (const w of s.walls) {
      if (collideLine(ball, w.ax, w.ay, w.bx, w.by, WALL_RESTITUTION, 1)) {
        s.score += POINTS_WALL_BOUNCE * s.multiplier;
      }
    }
    // Slingshots (line + extra push along normal)
    for (const sl of s.slingshots) {
      if (collideLine(ball, sl.ax, sl.ay, sl.bx, sl.by, 1.0, 1)) {
        sl.flash = 180;
        const pts = POINTS_SLINGSHOT * s.multiplier;
        s.score += pts;
        s.popups.push({ x: (sl.ax + sl.bx) / 2, y: (sl.ay + sl.by) / 2 - 6, text: `+${pts}`, color: "#fde68a", age: 0 });
        const speed = Math.hypot(ball.vx, ball.vy);
        if (speed > 0) {
          const k = Math.min(1.4, speed * 1.25);
          const nx = ball.vx / speed;
          const ny = ball.vy / speed;
          ball.vx = nx * k;
          ball.vy = ny * k;
        }
        sounds?.playMove();
      }
    }
    // Bumpers
    for (const b of s.bumpers) {
      if (collideBumper(ball, b)) {
        b.flash = 220;
        const pts = b.points * s.multiplier;
        s.score += pts;
        s.popups.push({ x: b.x, y: b.y - b.r - 4, text: `+${pts}`, color: "#facc15", age: 0 });
        sounds?.playScore();
      }
    }
    // Drop targets
    for (const dt2 of s.dropTargets) {
      if (dt2.down) continue;
      if (collideAabb(ball, dt2.x, dt2.y, dt2.w, dt2.h, 0.6)) {
        dt2.down = true;
        dt2.hitFlash = 260;
        const pts = POINTS_DROP_TARGET * s.multiplier;
        s.score += pts;
        s.popups.push({ x: dt2.x + dt2.w / 2, y: dt2.y - 4, text: `+${pts}`, color: "#86efac", age: 0 });
        sounds?.playClear();
        // Cleared them all? Award bonus + activate multiplier.
        if (s.dropTargets.every((t) => t.down)) {
          const bonus = POINTS_ALL_DROP_BONUS * s.multiplier;
          s.score += bonus;
          s.popups.push({ x: FIELD_W / 2, y: dt2.y - 24, text: `ROW CLEAR +${bonus}`, color: "#86efac", age: 0 });
          s.multiplier = 2;
          s.multiplierTimer = MULTIPLIER_DURATION;
          s.dropResetTimer = DROP_RESET_DELAY;
          sounds?.playLevelUp();
        }
      }
    }
    // Flippers
    collideFlipper(ball, s.leftFlip, dt);
    collideFlipper(ball, s.rightFlip, dt);
  }


  // Drain detection: anything past the bottom of the field is lost
  if (ball.y - BALL_R > FIELD_H + 4) {
    ball.alive = false;
    s.ballsLeft--;
    s.ball = null;
    s.shake = SHAKE_MS;
    sounds?.playError();
    return true;
  }
  return false;
}
