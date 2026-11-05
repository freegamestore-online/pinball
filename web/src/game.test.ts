import { describe, expect, it } from "vitest";
import {
  BALL_R, MAX_SPEED, POINTS_ALL_DROP_BONUS, POINTS_DROP_TARGET,
  freshState, stepGame, type Ball, type GameState,
} from "./game";

const idle = { left: false, right: false };

function withBall(x: number, y: number, vx: number, vy: number): GameState {
  const s = freshState();
  s.ball = { x, y, vx, vy, alive: true, trail: [] } satisfies Ball;
  return s;
}

describe("stepGame", () => {
  it("keeps a max-speed ball inside the top wall, even on slow frames", () => {
    for (const dt of [16, 32]) {
      const s = withBall(240, 60, 0, -MAX_SPEED);
      let minY = Infinity;
      for (let t = 0; t < 400; t += dt) {
        stepGame(s, dt, idle, true, null);
        minY = Math.min(minY, s.ball!.y);
      }
      expect(minY).toBeGreaterThan(24);
    }
  });

  it("drains a ball below the field and spends one ball", () => {
    const s = withBall(140, 420, 0, 0.5);
    expect(stepGame(s, 16, idle, true, null)).toBe(true);
    expect(s.ball).toBeNull();
    expect(s.ballsLeft).toBe(2);
  });

  it("does not move the ball unless playing", () => {
    const s = withBall(140, 60, 0, 0.5);
    stepGame(s, 16, idle, false, null);
    expect(s.ball).toMatchObject({ x: 140, y: 60 });
  });

  it("awards the row bonus and 2x multiplier when the last drop target falls", () => {
    const s = freshState();
    s.dropTargets.slice(0, 3).forEach((t) => (t.down = true));
    const last = s.dropTargets[3]!;
    s.ball = { x: last.x + last.w / 2, y: last.y + last.h + BALL_R - 1, vx: 0, vy: -0.3, alive: true, trail: [] };
    stepGame(s, 16, idle, true, null);
    expect(last.down).toBe(true);
    expect(s.score).toBe(POINTS_DROP_TARGET + POINTS_ALL_DROP_BONUS);
    expect(s.multiplier).toBe(2);
  });
});
