import { useEffect, useRef, useState, useCallback } from "react";
import {
  GameShell,
  GameTopbar,
  GameAuth,
  GameButton,
  useGameSounds,
} from "@freegamestore/games";
import { useHighScore } from "./hooks/useHighScore";

// ─── Field constants (logical pixels — canvas scales via CSS) ───
const FIELD_W = 280;
const FIELD_H = 400;
const BALL_R = 6;

const GRAVITY = 0.0013; // px/ms²
const FRICTION_PER_MS = 0.9994; // multiplicative per ms
const WALL_RESTITUTION = 0.72;
const BUMPER_RESTITUTION = 1.06;
const MAX_SPEED = 1.8;

// Flippers
const FLIPPER_LEN = 44;
const FLIPPER_W = 9;
const LEFT_PIVOT = { x: 92, y: 358 };
const RIGHT_PIVOT = { x: 188, y: 358 };
const LEFT_REST_ANG = 0.45;       // ~26° below horizontal
const LEFT_RAISED_ANG = -0.55;    // ~31° above horizontal
const RIGHT_REST_ANG = Math.PI - 0.45;
const RIGHT_RAISED_ANG = Math.PI + 0.55;
const FLIP_RATE = 0.028; // rad/ms — how fast the flipper rotates
const FLIPPER_BOOST = 0.5; // px/ms imparted by an actively-raising flipper

// Score events
const POINTS_BUMPER = 100;
const POINTS_SLINGSHOT = 50;
const POINTS_WALL_BOUNCE = 5;

const START_BALLS = 3;

interface Vec { x: number; y: number; }
interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  alive: boolean;
}
interface Bumper {
  x: number;
  y: number;
  r: number;
  points: number;
  flash: number; // ms remaining
}
interface Slingshot {
  // triangle with a 45° hypotenuse; we represent it as a line line that
  // imparts an extra push when struck.
  ax: number; ay: number;
  bx: number; by: number;
  flash: number;
}
interface Wall {
  ax: number; ay: number;
  bx: number; by: number;
}
interface Flipper {
  pivot: Vec;
  rest: number;
  raised: number;
  angle: number;     // current
  prevAngle: number; // last frame — used for angular velocity
  raising: boolean;
}

type Phase = "intro" | "ready" | "playing" | "drained" | "over";

interface GameState {
  ball: Ball | null;
  leftFlip: Flipper;
  rightFlip: Flipper;
  bumpers: Bumper[];
  slingshots: Slingshot[];
  walls: Wall[];
  ballsLeft: number;
  score: number;
  drainTimer: number; // ms remaining before next ball auto-loads
  time: number;
  frame: number;
}

function freshFlipper(side: "left" | "right"): Flipper {
  const pivot = side === "left" ? LEFT_PIVOT : RIGHT_PIVOT;
  const rest = side === "left" ? LEFT_REST_ANG : RIGHT_REST_ANG;
  const raised = side === "left" ? LEFT_RAISED_ANG : RIGHT_RAISED_ANG;
  return { pivot, rest, raised, angle: rest, prevAngle: rest, raising: false };
}

function buildWalls(): Wall[] {
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

function buildSlingshots(): Slingshot[] {
  // Two triangular cushions above the flippers — the diagonal face of each
  // is a "live" slingshot line that gives an extra push.
  return [
    { ax: 30, ay: 290, bx: 70, by: 330, flash: 0 },   // left slingshot diagonal
    { ax: FIELD_W - 70, ay: 330, bx: FIELD_W - 30, by: 290, flash: 0 }, // right
  ];
}

function buildBumpers(): Bumper[] {
  // Classic triangle of pop bumpers in upper-middle field.
  return [
    { x: 80,  y: 130, r: 14, points: POINTS_BUMPER, flash: 0 },
    { x: 200, y: 130, r: 14, points: POINTS_BUMPER, flash: 0 },
    { x: 140, y: 90,  r: 14, points: POINTS_BUMPER, flash: 0 },
    { x: 140, y: 180, r: 12, points: POINTS_BUMPER, flash: 0 },
  ];
}

function freshState(): GameState {
  return {
    ball: null,
    leftFlip: freshFlipper("left"),
    rightFlip: freshFlipper("right"),
    bumpers: buildBumpers(),
    slingshots: buildSlingshots(),
    walls: buildWalls(),
    ballsLeft: START_BALLS,
    score: 0,
    drainTimer: 0,
    time: 0,
    frame: 0,
  };
}

function launchBall(): Ball {
  // Drop from near top-center with a slight random sideways nudge.
  return {
    x: FIELD_W / 2 + (Math.random() - 0.5) * 20,
    y: 40,
    vx: (Math.random() - 0.5) * 0.2,
    vy: 0.05,
    alive: true,
  };
}

// ─── Vector / geometry helpers ───

function clampLen(vx: number, vy: number, max: number): [number, number] {
  const s = Math.hypot(vx, vy);
  if (s > max) {
    const k = max / s;
    return [vx * k, vy * k];
  }
  return [vx, vy];
}

// Closest point on line a→b to point p.
function closestPointOnSeg(ax: number, ay: number, bx: number, by: number, px: number, py: number): { x: number; y: number; t: number } {
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
function reflect(vx: number, vy: number, nx: number, ny: number, rest: number): [number, number] {
  const dot = vx * nx + vy * ny;
  const rvx = (vx - 2 * dot * nx) * rest;
  const rvy = (vy - 2 * dot * ny) * rest;
  return [rvx, rvy];
}

// ─── Collision routines ───

// Ball vs line line. Returns true if collision applied.
function collideLine(
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
function collideBumper(b: Ball, bumper: Bumper): boolean {
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

// Ball vs flipper (capsule from pivot toward tip at current angle).
function collideFlipper(b: Ball, f: Flipper, dt: number): boolean {
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

// ─── React component ───

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef<GameState>(freshState());
  const inputRef = useRef<{ left: boolean; right: boolean }>({ left: false, right: false });
  const lastTimeRef = useRef(0);
  const phaseRef = useRef<Phase>("intro");
  const scoreRef = useRef(0);
  const ballsRef = useRef(START_BALLS);

  const [score, setScore] = useState(0);
  const [ballsLeft, setBallsLeft] = useState(START_BALLS);
  const [phase, setPhase] = useState<Phase>("intro");
  const [, force] = useState(0);
  const [bestScore, updateHighScore] = useHighScore("pinball-best");
  const sounds = useGameSounds();
  phaseRef.current = phase;

  const startNewGame = useCallback(() => {
    stateRef.current = freshState();
    scoreRef.current = 0;
    ballsRef.current = START_BALLS;
    lastTimeRef.current = 0;
    setScore(0);
    setBallsLeft(START_BALLS);
    setPhase("ready");
    force((x) => x + 1);
  }, []);

  const launchNextBall = useCallback(() => {
    const s = stateRef.current;
    s.ball = launchBall();
    setPhase("playing");
    phaseRef.current = "playing";
    sounds.playMove();
  }, [sounds]);

  // Keyboard
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowLeft": case "a": case "A": case "z": case "Z":
          inputRef.current.left = true; e.preventDefault(); break;
        case "ArrowRight": case "d": case "D": case "/":
          inputRef.current.right = true; e.preventDefault(); break;
        case " ": case "Enter": case "ArrowUp": case "w": case "W":
          if (phaseRef.current === "ready") {
            launchNextBall();
            e.preventDefault();
          }
          break;
      }
    };
    const up = (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowLeft": case "a": case "A": case "z": case "Z":
          inputRef.current.left = false; break;
        case "ArrowRight": case "d": case "D": case "/":
          inputRef.current.right = false; break;
      }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [launchNextBall]);

  // Canvas sizing
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const fit = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const maxW = parent.clientWidth;
      const maxH = parent.clientHeight;
      const scale = Math.min(maxW / FIELD_W, maxH / FIELD_H);
      const cssW = FIELD_W * scale;
      const cssH = FIELD_H * scale;
      const dpr = window.devicePixelRatio || 1;
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      canvas.width = FIELD_W * dpr;
      canvas.height = FIELD_H * dpr;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.imageSmoothingEnabled = false;
      }
    };
    fit();
    const ro = new ResizeObserver(fit);
    if (canvas.parentElement) ro.observe(canvas.parentElement);
    return () => ro.disconnect();
  }, []);

  // Animation loop
  useEffect(() => {
    let raf = 0;
    const tick = (now: number) => {
      const dt = lastTimeRef.current === 0 ? 16 : Math.min(32, now - lastTimeRef.current);
      lastTimeRef.current = now;
      const s = stateRef.current;
      s.frame++;
      s.time += dt;
      step(s, dt);
      draw(s);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const step = useCallback(
    (s: GameState, dt: number) => {
      // Always animate flippers (even between balls) — better tactile feel
      const lp = inputRef.current.left;
      const rp = inputRef.current.right;
      animateFlipper(s.leftFlip, lp, dt);
      animateFlipper(s.rightFlip, rp, dt);

      // Decay flash timers on bumpers + slingshots
      for (const b of s.bumpers) b.flash = Math.max(0, b.flash - dt);
      for (const sl of s.slingshots) sl.flash = Math.max(0, sl.flash - dt);

      if (phaseRef.current !== "playing") return;

      const ball = s.ball;
      if (!ball || !ball.alive) return;

      // Apply gravity + friction
      ball.vy += GRAVITY * dt;
      const f = Math.pow(FRICTION_PER_MS, dt);
      ball.vx *= f;
      ball.vy *= f;
      [ball.vx, ball.vy] = clampLen(ball.vx, ball.vy, MAX_SPEED);

      // Substepped motion + collisions
      const substeps = 3;
      const sx = ball.vx / substeps;
      const sy = ball.vy / substeps;
      for (let i = 0; i < substeps; i++) {
        ball.x += sx * dt;
        ball.y += sy * dt;

        // Walls
        for (const w of s.walls) {
          if (collideLine(ball, w.ax, w.ay, w.bx, w.by, WALL_RESTITUTION, 1)) {
            s.score += POINTS_WALL_BOUNCE;
          }
        }
        // Slingshots (line + extra push along normal)
        for (const sl of s.slingshots) {
          if (collideLine(ball, sl.ax, sl.ay, sl.bx, sl.by, 1.0, 1)) {
            sl.flash = 180;
            s.score += POINTS_SLINGSHOT;
            // Extra kick along reflection direction (away from surface)
            const speed = Math.hypot(ball.vx, ball.vy);
            if (speed > 0) {
              const k = Math.min(1.4, speed * 1.25);
              const nx = ball.vx / speed;
              const ny = ball.vy / speed;
              ball.vx = nx * k;
              ball.vy = ny * k;
            }
            sounds.playMove();
          }
        }
        // Bumpers
        for (const b of s.bumpers) {
          if (collideBumper(ball, b)) {
            b.flash = 220;
            s.score += b.points;
            sounds.playScore();
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
        sounds.playError();
        if (s.ballsLeft <= 0) {
          updateHighScore(s.score);
          setPhase("over");
          phaseRef.current = "over";
          sounds.playGameOver();
        } else {
          setPhase("ready");
          phaseRef.current = "ready";
        }
      }

      // Sync React state
      if (s.score !== scoreRef.current) {
        scoreRef.current = s.score;
        setScore(s.score);
      }
      if (s.ballsLeft !== ballsRef.current) {
        ballsRef.current = s.ballsLeft;
        setBallsLeft(s.ballsLeft);
      }
    },
    [sounds, updateHighScore],
  );

  const draw = useCallback((s: GameState) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Playfield gradient
    const grad = ctx.createLinearGradient(0, 0, 0, FIELD_H);
    grad.addColorStop(0, "#1a1f2e");
    grad.addColorStop(1, "#0a0d18");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, FIELD_W, FIELD_H);

    // Decorative center lane stripes (subtle)
    ctx.strokeStyle = "rgba(255,255,255,0.04)";
    ctx.lineWidth = 1;
    for (let i = 1; i < 5; i++) {
      const y = (i * FIELD_H) / 5;
      ctx.beginPath();
      ctx.moveTo(8, y);
      ctx.lineTo(FIELD_W - 8, y);
      ctx.stroke();
    }

    // Walls
    ctx.strokeStyle = "#94a3b8";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    for (const w of s.walls) {
      ctx.beginPath();
      ctx.moveTo(w.ax, w.ay);
      ctx.lineTo(w.bx, w.by);
      ctx.stroke();
    }

    // Slingshots (filled triangles)
    for (const sl of s.slingshots) {
      const flashing = sl.flash > 0;
      ctx.fillStyle = flashing ? "#fde68a" : "#475569";
      ctx.beginPath();
      ctx.moveTo(sl.ax, sl.ay);
      ctx.lineTo(sl.bx, sl.by);
      // close to corner — left slingshot closes down-left, right closes down-right
      if (sl.ax < FIELD_W / 2) {
        ctx.lineTo(sl.bx, sl.ay); // right-angle corner at (bx, ay)
      } else {
        ctx.lineTo(sl.ax, sl.by); // right-angle corner at (ax, by)
      }
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = flashing ? "#facc15" : "#94a3b8";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sl.ax, sl.ay);
      ctx.lineTo(sl.bx, sl.by);
      ctx.stroke();
    }

    // Bumpers
    for (const b of s.bumpers) {
      const flashing = b.flash > 0;
      const fillGrad = ctx.createRadialGradient(b.x - b.r * 0.3, b.y - b.r * 0.3, 2, b.x, b.y, b.r);
      fillGrad.addColorStop(0, flashing ? "#fef9c3" : "#f59e0b");
      fillGrad.addColorStop(1, flashing ? "#f59e0b" : "#b45309");
      ctx.fillStyle = fillGrad;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#7c2d12";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      // Inner ring
      ctx.fillStyle = "#fef3c7";
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r * 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#7c2d12";
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r * 0.25, 0, Math.PI * 2);
      ctx.fill();
    }

    // Flippers (rotated capsules)
    drawFlipper(ctx, s.leftFlip);
    drawFlipper(ctx, s.rightFlip);

    // Drain area indicator
    ctx.fillStyle = "rgba(220,38,38,0.18)";
    ctx.fillRect(60, FIELD_H - 12, FIELD_W - 120, 8);

    // Ball
    const ball = s.ball;
    if (ball && ball.alive) {
      const bgrad = ctx.createRadialGradient(ball.x - 2, ball.y - 2, 1, ball.x, ball.y, BALL_R);
      bgrad.addColorStop(0, "#ffffff");
      bgrad.addColorStop(0.7, "#cbd5e1");
      bgrad.addColorStop(1, "#475569");
      ctx.fillStyle = bgrad;
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.35)";
      ctx.lineWidth = 0.6;
      ctx.stroke();
    }
  }, []);

  return (
    <GameShell
      topbar={
        <GameTopbar
          title="Pinball"
          stats={[
            { label: "Score", value: score, accent: true },
            { label: "Balls", value: ballsLeft },
            { label: "Best", value: bestScore },
          ]}
          rules={
            <div>
              <h3 style={{ marginBottom: "0.5rem", fontWeight: 700 }}>Pinball</h3>
              <p>Keep the ball alive. Hit bumpers and slingshots to score.</p>
              <h4 style={{ marginTop: "0.75rem", fontWeight: 600 }}>Controls</h4>
              <ul style={{ paddingLeft: "1.2rem", marginTop: "0.25rem" }}>
                <li>Desktop: ← / A / Z = left flipper · → / D / / = right flipper · Space = launch ball</li>
                <li>Mobile: big flipper buttons left/right, Launch button when ready</li>
              </ul>
              <h4 style={{ marginTop: "0.75rem", fontWeight: 600 }}>Scoring</h4>
              <ul style={{ paddingLeft: "1.2rem", marginTop: "0.25rem" }}>
                <li>Pop bumper — {POINTS_BUMPER} pts</li>
                <li>Slingshot — {POINTS_SLINGSHOT} pts</li>
                <li>Wall bounce — {POINTS_WALL_BOUNCE} pts</li>
                <li>3 balls per game. Drain at the bottom = lose a ball.</li>
              </ul>
            </div>
          }
          actions={<GameAuth />}
        />
      }
    >
      <div
        style={{
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: "0.5rem",
          gap: "0.5rem",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "relative",
            flex: 1,
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: 0,
          }}
        >
          <div
            style={{
              position: "relative",
              maxWidth: "100%",
              maxHeight: "100%",
              padding: "6px",
              background: "linear-gradient(180deg, #422006 0%, #2c1404 100%)",
              border: "3px solid #facc15",
              borderRadius: "0.4rem",
              boxShadow: "0 0 0 1px #000 inset, 0 4px 24px rgba(0,0,0,0.5)",
              display: "flex",
            }}
          >
            <canvas
              ref={canvasRef}
              style={{
                imageRendering: "pixelated",
                background: "#0a0d18",
                display: "block",
                maxWidth: "100%",
                maxHeight: "100%",
                touchAction: "none",
              }}
            />
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                inset: 6,
                pointerEvents: "none",
                background:
                  "repeating-linear-gradient(to bottom, rgba(0,0,0,0.10) 0 1px, transparent 1px 3px)",
                mixBlendMode: "multiply",
                borderRadius: "0.15rem",
              }}
            />
          </div>
          {phase === "intro" && (
            <Overlay>
              <div style={{ fontFamily: "Fraunces, serif", fontWeight: 800, fontSize: "1.5rem", color: "#facc15" }}>
                PINBALL
              </div>
              <div style={{ color: "var(--paper)", fontSize: "0.85rem", textAlign: "center", maxWidth: "18rem" }}>
                Hit bumpers, work the flippers, don't drain.<br />
                ← → flippers · Space launches
              </div>
              <GameButton size="md" variant="primary" onClick={startNewGame}>Start</GameButton>
            </Overlay>
          )}
          {phase === "ready" && (
            <Overlay>
              <div style={{ fontFamily: "Fraunces, serif", fontWeight: 800, fontSize: "1.3rem", color: "#facc15" }}>
                Ball {START_BALLS - ballsLeft + 1} of {START_BALLS}
              </div>
              <GameButton size="md" variant="primary" onClick={launchNextBall}>Launch</GameButton>
            </Overlay>
          )}
          {phase === "over" && (
            <Overlay>
              <div style={{ fontFamily: "Fraunces, serif", fontWeight: 800, fontSize: "1.5rem", color: "#ef4444" }}>
                GAME OVER
              </div>
              <div style={{ color: "#f8fafc" }}>Score: {score}</div>
              <GameButton size="md" variant="primary" onClick={startNewGame}>Play Again</GameButton>
            </Overlay>
          )}
        </div>

        {/* Touch flipper controls */}
        <div
          style={{
            display: "flex",
            width: "100%",
            justifyContent: "space-between",
            gap: "0.5rem",
            paddingBottom: "0.25rem",
          }}
        >
          <FlipperButton label="◀ FLIP" align="left" inputRef={inputRef} side="left" />
          <FlipperButton label="FLIP ▶" align="right" inputRef={inputRef} side="right" />
        </div>

        <a
          href="https://freegamestore.online"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "var(--muted)", fontSize: "0.7rem", textDecoration: "none" }}
        >
          Part of FreeGameStore — free forever
        </a>
      </div>
    </GameShell>
  );
}

function FlipperButton({
  label,
  align,
  inputRef,
  side,
}: {
  label: string;
  align: "left" | "right";
  inputRef: React.MutableRefObject<{ left: boolean; right: boolean }>;
  side: "left" | "right";
}) {
  const set = (v: boolean) => {
    inputRef.current[side] = v;
  };
  return (
    <button
      onPointerDown={(e) => { e.preventDefault(); set(true); }}
      onPointerUp={() => set(false)}
      onPointerLeave={() => set(false)}
      onPointerCancel={() => set(false)}
      aria-label={`${side} flipper`}
      style={{
        flex: 1,
        maxWidth: "10rem",
        height: "4rem",
        background: "var(--accent)",
        color: "var(--paper)",
        border: "none",
        borderRadius: "0.6rem",
        fontFamily: "Fraunces, serif",
        fontWeight: 800,
        fontSize: "1rem",
        touchAction: "manipulation",
        userSelect: "none",
        WebkitUserSelect: "none",
        textAlign: align,
        padding: "0 1rem",
        boxShadow: "0 4px 0 rgba(0,0,0,0.25)",
      }}
    >
      {label}
    </button>
  );
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "0.75rem",
        background: "rgba(0,0,0,0.84)",
        borderRadius: "0.25rem",
      }}
    >
      {children}
    </div>
  );
}

function animateFlipper(f: Flipper, pressed: boolean, dt: number) {
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

function drawFlipper(ctx: CanvasRenderingContext2D, f: Flipper) {
  ctx.save();
  ctx.translate(f.pivot.x, f.pivot.y);
  ctx.rotate(f.angle);
  // Capsule: rectangle plus two semicircle caps
  ctx.fillStyle = "#fbbf24";
  ctx.beginPath();
  ctx.arc(0, 0, FLIPPER_W / 2 + 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(FLIPPER_LEN, 0, FLIPPER_W / 2 - 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#f59e0b";
  ctx.fillRect(0, -FLIPPER_W / 2, FLIPPER_LEN, FLIPPER_W);
  // Highlight
  ctx.fillStyle = "rgba(255,255,255,0.25)";
  ctx.fillRect(2, -FLIPPER_W / 2 + 1, FLIPPER_LEN - 6, 2);
  // Pivot dot
  ctx.fillStyle = "#1f2937";
  ctx.beginPath();
  ctx.arc(0, 0, 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
