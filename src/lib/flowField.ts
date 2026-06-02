/* ============================================================
   Backdrop effect for the optimizer pool — "flow field".
   Hundreds of slim particles drift along a smooth swirling
   field and leave fading trails; a few brighter motes course
   through faster. Ported from the design prototype (effect.js),
   recoloured to the blue accent.
   ============================================================ */

// blue accent ≈ oklch(0.55 0.15 250)
const BLUE: [number, number, number] = [70, 120, 220];
const rgba = (a: number) => `rgba(${BLUE[0]},${BLUE[1]},${BLUE[2]},${a})`;

export interface FlowField {
  start: () => void;
  stop: () => void;
  resize: () => void;
  init: () => void;
}

interface Particle { x: number; y: number; px: number; py: number; sp: number; a: number; life: number; }
interface Mote { x: number; y: number; sp: number; r: number; ph: number; }

export function createFlowField(canvas: HTMLCanvasElement): FlowField {
  const ctx = canvas.getContext("2d")!;
  let W = 0, H = 0;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let parts: Particle[] = [];
  let motes: Mote[] = [];
  let raf: number | null = null;
  let t0 = performance.now();
  let running = false;

  const rand = (a: number, b: number) => a + Math.random() * (b - a);

  function build() {
    const n = Math.min(320, Math.max(90, Math.floor((W * H) / 1700)));
    parts = [];
    for (let i = 0; i < n; i++) {
      parts.push({ x: Math.random() * W, y: Math.random() * H, px: 0, py: 0, sp: rand(0.5, 1.5), a: rand(0.16, 0.42), life: rand(60, 320) });
    }
    const m = Math.min(10, Math.max(4, Math.floor(W / 150)));
    motes = [];
    for (let i = 0; i < m; i++) {
      motes.push({ x: Math.random() * W, y: Math.random() * H, sp: rand(1.6, 2.8), r: rand(1.2, 2.0), ph: Math.random() * 6.28 });
    }
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    build();
  }

  // smooth swirling field — layered trig, no external noise
  function angle(x: number, y: number, t: number) {
    return (
      Math.sin(x * 0.0026 + t * 0.16) * 1.7 +
      Math.cos(y * 0.0028 - t * 0.13) * 1.7 +
      Math.sin((x + y) * 0.0016 + t * 0.22) * 0.9
    );
  }

  function draw(now: number) {
    const t = (now - t0) / 1000;

    // fade existing trails toward transparent (theme-independent)
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = "rgba(0,0,0,0.055)";
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = "source-over";

    ctx.lineCap = "round";
    for (const p of parts) {
      const a = angle(p.x, p.y, t) * Math.PI;
      p.px = p.x; p.py = p.y;
      p.x += Math.cos(a) * p.sp;
      p.y += Math.sin(a) * p.sp;
      p.life -= 1;

      if (p.x < -4 || p.x > W + 4 || p.y < -4 || p.y > H + 4 || p.life <= 0) {
        p.x = Math.random() * W; p.y = Math.random() * H;
        p.px = p.x; p.py = p.y; p.life = rand(60, 320);
        continue;
      }
      ctx.strokeStyle = rgba(p.a);
      ctx.lineWidth = 1.15;
      ctx.beginPath();
      ctx.moveTo(p.px, p.py);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }

    for (const m of motes) {
      const a = angle(m.x, m.y, t) * Math.PI;
      m.x += Math.cos(a) * m.sp;
      m.y += Math.sin(a) * m.sp;
      if (m.x < -6 || m.x > W + 6 || m.y < -6 || m.y > H + 6) {
        m.x = Math.random() * W; m.y = Math.random() * H;
      }
      const pulse = 0.55 + 0.45 * Math.sin(t * 2.4 + m.ph);
      ctx.save();
      ctx.shadowColor = rgba(0.7);
      ctx.shadowBlur = 8;
      ctx.fillStyle = rgba(0.55 + 0.35 * pulse);
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    if (running) raf = requestAnimationFrame(draw);
  }

  return {
    start() { if (running) return; running = true; t0 = performance.now(); raf = requestAnimationFrame(draw); },
    stop() { running = false; if (raf) cancelAnimationFrame(raf); },
    resize,
    init() { t0 = performance.now(); resize(); ctx.clearRect(0, 0, W, H); },
  };
}
