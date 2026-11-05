import { useEffect, useRef, useState, useCallback } from "react";
import {
  GameShell,
  GameTopbar,
  GameAuth,
  GameButton,
  useGameSounds,
} from "@freegamestore/games";
import { useHighScore } from "./hooks/useHighScore";
import { bindKeyboard, type FlipperInput } from "./input";
import {
  BALL_R, FIELD_H, FIELD_W, FLIPPER_LEN, FLIPPER_W, MULTIPLIER_DURATION, POINTS_BUMPER,
  POINTS_SLINGSHOT, POINTS_WALL_BOUNCE, SHAKE_MS, START_BALLS,
  freshState, launchBall, stepGame, type Flipper, type GameState, type ScorePopup,
} from "./game";

// useGameSounds reads SoundContext which GameShell provides INTERNALLY.
// Calling it directly above <GameShell> would get a disconnected (muted)
// default; AudioBridge is a tiny no-render child of GameShell that exposes
// the real sounds API via ref to the App scope.
type SoundsApi = ReturnType<typeof useGameSounds>;

function AudioBridge({ apiRef }: { apiRef: React.MutableRefObject<SoundsApi | null> }) {
  const sounds = useGameSounds();
  apiRef.current = sounds;
  return null;
}


type Phase = "intro" | "ready" | "playing" | "over";

// ─── React component ───

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef<GameState>(freshState());
  const inputRef = useRef<FlipperInput>({ left: false, right: false });
  const lastTimeRef = useRef(0);
  const phaseRef = useRef<Phase>("intro");
  const pausedRef = useRef(false);
  const scoreRef = useRef(0);
  const ballsRef = useRef(START_BALLS);
  const soundsRef = useRef<SoundsApi | null>(null);

  const [score, setScore] = useState(0);
  const [ballsLeft, setBallsLeft] = useState(START_BALLS);
  const [phase, setPhase] = useState<Phase>("intro");
  const [paused, setPaused] = useState(false);
  const [, force] = useState(0);
  const [bestScore, updateHighScore] = useHighScore("pinball-best");
  phaseRef.current = phase;
  pausedRef.current = paused;

  const startNewGame = useCallback(() => {
    stateRef.current = freshState();
    scoreRef.current = 0;
    ballsRef.current = START_BALLS;
    lastTimeRef.current = 0;
    setScore(0);
    setBallsLeft(START_BALLS);
    setPaused(false);
    setPhase("ready");
    force((x) => x + 1);
  }, []);

  const launchNextBall = useCallback(() => {
    const s = stateRef.current;
    s.ball = launchBall();
    setPhase("playing");
    phaseRef.current = "playing";
    soundsRef.current?.playMove();
  }, []);

  // Keyboard
  useEffect(
    () =>
      bindKeyboard(inputRef.current, () => {
        if (phaseRef.current !== "ready") return false;
        launchNextBall();
        return true;
      }),
    [launchNextBall],
  );

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
      if (!pausedRef.current) step(s, dt);
      draw(s);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const step = useCallback(
    (s: GameState, dt: number) => {
      if (stepGame(s, dt, inputRef.current, phaseRef.current === "playing", soundsRef.current)) {
        if (s.ballsLeft <= 0) {
          updateHighScore(s.score);
          setPhase("over");
          phaseRef.current = "over";
          soundsRef.current?.playGameOver();
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
    [updateHighScore],
  );


  const draw = useCallback((s: GameState) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Tilt-shake offset on drain — small random jitter for SHAKE_MS
    if (s.shake > 0) {
      const intensity = (s.shake / SHAKE_MS) * 3;
      const sx = (Math.random() - 0.5) * 2 * intensity;
      const sy = (Math.random() - 0.5) * 2 * intensity;
      ctx.translate(sx, sy);
    }

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

    // Drop targets row
    for (const t of s.dropTargets) {
      if (t.down) {
        // Faint ghost outline for dropped-down state
        ctx.strokeStyle = "rgba(34, 197, 94, 0.18)";
        ctx.lineWidth = 1;
        ctx.strokeRect(t.x, t.y + t.h - 1, t.w, 1);
        continue;
      }
      const flashing = t.hitFlash > 0;
      ctx.fillStyle = flashing ? "#bbf7d0" : "#22c55e";
      ctx.fillRect(t.x, t.y, t.w, t.h);
      ctx.fillStyle = flashing ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.25)";
      ctx.fillRect(t.x + 1, t.y + 1, t.w - 2, 2);
      ctx.strokeStyle = "#14532d";
      ctx.lineWidth = 1;
      ctx.strokeRect(t.x + 0.5, t.y + 0.5, t.w - 1, t.h - 1);
    }

    // Flippers (rotated capsules)
    drawFlipper(ctx, s.leftFlip);
    drawFlipper(ctx, s.rightFlip);

    // Drain area indicator
    ctx.fillStyle = "rgba(220,38,38,0.18)";
    ctx.fillRect(60, FIELD_H - 12, FIELD_W - 120, 8);

    // Ball trail (fading dots behind ball)
    const ball = s.ball;
    if (ball && ball.alive) {
      for (let i = 0; i < ball.trail.length; i++) {
        const p = ball.trail[i]!;
        const alpha = (i + 1) / (ball.trail.length + 1) * 0.45;
        const r = BALL_R * (0.3 + 0.6 * (i + 1) / ball.trail.length);
        ctx.fillStyle = `rgba(226, 232, 240, ${alpha})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      // Ball itself
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

    // Score popups
    for (const p of s.popups) drawPopup(ctx, p);

    // Multiplier banner (top-center)
    if (s.multiplier > 1) {
      const remain = s.multiplierTimer / MULTIPLIER_DURATION;
      const w = 64;
      const h = 16;
      const x = FIELD_W / 2 - w / 2;
      const y = 4;
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = "#facc15";
      ctx.fillRect(x, y, w * remain, h);
      ctx.fillStyle = "#0a0a0a";
      ctx.font = "bold 11px 'Fraunces', serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(`${s.multiplier}× SCORE`, x + w / 2, y + h / 2);
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
          onPlayPause={phase === "playing" ? () => setPaused((p) => !p) : undefined}
          paused={paused}
          actions={<GameAuth />}
        />
      }
    >
      <AudioBridge apiRef={soundsRef} />
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
          {phase === "playing" && paused && (
            <Overlay>
              <div style={{ fontFamily: "Fraunces, serif", fontWeight: 800, fontSize: "1.5rem", color: "#facc15" }}>
                PAUSED
              </div>
              <GameButton size="md" variant="primary" onClick={() => setPaused(false)}>Resume</GameButton>
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

export function FlipperButton({
  label,
  align,
  inputRef,
  side,
}: {
  label: string;
  align: "left" | "right";
  inputRef: React.MutableRefObject<FlipperInput>;
  side: "left" | "right";
}) {
  const set = (v: boolean) => {
    inputRef.current[side] = v;
  };
  return (
    <button
      // Capture the pointer so a finger drifting off the button keeps the
      // flipper up until it lifts.
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        set(true);
      }}
      onPointerUp={() => set(false)}
      onPointerCancel={() => set(false)}
      onLostPointerCapture={() => set(false)}
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
        touchAction: "none",
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


function drawPopup(ctx: CanvasRenderingContext2D, p: ScorePopup) {
  const t = p.age / 900;
  const yOff = -18 * t;
  const alpha = Math.max(0, 1 - t);
  ctx.font = "bold 11px 'Fraunces', serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = `rgba(0,0,0,${alpha * 0.7})`;
  ctx.fillText(p.text, p.x + 1, p.y + yOff + 1);
  // Convert hex/short color to rgba with alpha; if non-hex string given (e.g. css name), still works in canvas via globalAlpha fallback.
  ctx.globalAlpha = alpha;
  ctx.fillStyle = p.color;
  ctx.fillText(p.text, p.x, p.y + yOff);
  ctx.globalAlpha = 1;
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

