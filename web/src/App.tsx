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
import { drawGame } from "./draw";
import {
  FIELD_H, FIELD_W, POINTS_BUMPER, POINTS_SLINGSHOT, POINTS_WALL_BOUNCE, START_BALLS,
  freshState, launchBall, stepGame, type GameState,
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
    if (canvasRef.current) drawGame(canvasRef.current, s);
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
