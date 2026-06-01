/* ============================================================
   Backdrop effects for the optimizer ("Paper / Clay").

   · createFlowField — the active pool backdrop. Hundreds of slim
     clay particles drift along a smooth swirling flow field and
     leave fading trails; a handful of brighter "data motes" course
     through faster. Theme-independent (trails fade via compositing,
     canvas stays transparent over the panel).

   · createWaveField — the older sweeping waveform (kept for reuse).

   window.createScanField points at the active effect.
   ============================================================ */
(function () {
  const CLAY = [183, 93, 58];
  const rgba = (a) => `rgba(${CLAY[0]},${CLAY[1]},${CLAY[2]},${a})`;

  /* ---------- flow field ---------- */
  function createFlowField(canvas) {
    const ctx = canvas.getContext('2d');
    let W = 0, H = 0, dpr = Math.min(window.devicePixelRatio || 1, 2);
    let parts = [], motes = [];
    let raf = null, t0 = performance.now(), running = false;

    function resize() {
      const r = canvas.getBoundingClientRect();
      W = r.width; H = r.height;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      build();
    }

    function rand(a, b) { return a + Math.random() * (b - a); }

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

    // smooth swirling field — layered trig, no external noise
    function angle(x, y, t) {
      return (
        Math.sin(x * 0.0026 + t * 0.16) * 1.7 +
        Math.cos(y * 0.0028 - t * 0.13) * 1.7 +
        Math.sin((x + y) * 0.0016 + t * 0.22) * 0.9
      );
    }

    function draw(now) {
      const t = (now - t0) / 1000;

      // fade existing trails toward transparent (theme-independent)
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0,0,0,0.055)';
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'source-over';

      // drifting particle streaks
      ctx.lineCap = 'round';
      for (const p of parts) {
        const a = angle(p.x, p.y, t) * Math.PI;
        p.px = p.x; p.py = p.y;
        p.x += Math.cos(a) * p.sp;
        p.y += Math.sin(a) * p.sp;
        p.life -= 1;

        // wrap / respawn
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

      // brighter data motes — same field, faster, with a soft glow
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

  /* ---------- legacy wave field ---------- */
  function createWaveField(canvas) {
    const ctx = canvas.getContext('2d');
    let W = 0, H = 0, dpr = Math.min(window.devicePixelRatio || 1, 2);
    let bars = [];
    let raf = null, t0 = performance.now(), running = false;

    function resize() {
      const r = canvas.getBoundingClientRect();
      W = r.width; H = r.height;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      buildBars();
    }
    function buildBars() {
      bars = [];
      const gap = 9;
      const n = Math.max(8, Math.floor(W / gap));
      const offX = (W - (n - 1) * gap) / 2;
      for (let i = 0; i < n; i++) bars.push({ x: offX + i * gap, seed: Math.random() * 6.28, w: 2.6 });
    }
    function draw(now) {
      const t = (now - t0) / 1000;
      ctx.clearRect(0, 0, W, H);
      const mid = H / 2;
      const maxH = Math.min(H * 0.34, 120);
      const period = 3.6;
      const s = (t % period) / period;
      const fx = s * W;
      const band = 130;
      ctx.strokeStyle = rgba(0.10); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, mid + 0.5); ctx.lineTo(W, mid + 0.5); ctx.stroke();
      for (const b of bars) {
        const wave = 0.5 + 0.32 * Math.sin(b.x * 0.018 + t * 1.5 + b.seed) + 0.18 * Math.sin(b.x * 0.006 - t * 0.9);
        const baseAmp = Math.max(0.06, wave);
        const d = b.x - fx;
        const energy = Math.exp(-(d * d) / (2 * (band * 0.5) * (band * 0.5)));
        let amp, alpha;
        if (d <= 0) { amp = baseAmp * (0.42 + 0.18 * energy); alpha = 0.30 + 0.45 * energy; }
        else { const fade = Math.max(0, 1 - d / (W * 0.6)); amp = baseAmp * (0.14 + 0.6 * energy) * (0.5 + 0.5 * fade); alpha = (0.10 + 0.6 * energy) * (0.4 + 0.6 * fade); }
        const h = amp * maxH, x = b.x, w = b.w;
        ctx.fillStyle = rgba(Math.min(0.85, alpha));
        roundBar(ctx, x - w / 2, mid - h, w, h * 2, w / 2); ctx.fill();
      }
      if (running) raf = requestAnimationFrame(draw);
    }
    function roundBar(c, x, y, w, h, r) {
      r = Math.min(r, w / 2, h / 2);
      c.beginPath(); c.moveTo(x + r, y);
      c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
      c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
    }
    return {
      start() { if (running) return; running = true; t0 = performance.now(); raf = requestAnimationFrame(draw); },
      stop() { running = false; if (raf) cancelAnimationFrame(raf); },
      resize,
      init() { t0 = performance.now(); resize(); draw(performance.now()); },
    };
  }

  window.createFlowField = createFlowField;
  window.createWaveField = createWaveField;
  window.createScanField = createFlowField; // active backdrop
})();
