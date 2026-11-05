import {
  BALL_R, FIELD_H, FIELD_W, FLIPPER_LEN, FLIPPER_W, MULTIPLIER_DURATION, SHAKE_MS,
  type Flipper, type GameState, type ScorePopup,
} from "./game";

export function drawGame(canvas: HTMLCanvasElement, s: GameState) {
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

