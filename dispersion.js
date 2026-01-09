(function() {
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canvas = document.getElementById('dispersion');
  if (!canvas || prefersReducedMotion) return;

  const ctx = canvas.getContext('2d', { alpha: true });
  let width = 0, height = 0;
  function getDPR() { return Math.min(window.devicePixelRatio || 1, 2); }
  let dpr = getDPR();

  // Advection–diffusion plume parameters (deterministic)
  let windSpeed = 190; // px/s, mean along-wind speed (slightly faster)
  let baseAngle = 0.0; // radians; 0 = purely eastward
  let turnAcrossScreen = 0.0; // radians of veer across the full screen width (set to 0 for straight downwind)
  let shearCoeff = 0.12; // >0 => faster aloft relative to source height
  let minUx = 36; // px/s minimum eastward advection to guarantee rightward motion
  
  // Random wind shear downwind (spatial variations that increase with distance)
  let windShearStrength = 1.13; // radians (~65°), max random angle variation downwind
  let windShearSpeedVariation = 0.15; // fraction, max random speed variation downwind
  let windShearScale = 0.0025; // spatial frequency of shear variations (smaller = larger eddies, sharper transitions)

  // Anisotropic turbulent diffusivity (px^2/s); variance ~ 2 K t
  // Grow diffusion with downwind distance so plume spreads more as it travels
  let Kx0 = 6.0;    // base along-wind diffusion (larger)
  let Ky0 = 120.0;  // base cross-wind diffusion (larger for more spread)
  let KxGrow = 12.0;  // along-wind diffusion growth across screen
  let KyGrow = 320.0; // cross-wind diffusion growth across screen

  // Source (single-point origin)
  const source = { x: 0, y: 0 };
  const sourceSpread = 6; // px Gaussian spread at emission

  // High-res density grid for cumulative plume rendering (jet: blue->cyan->yellow->red)
  let gridW = 0, gridH = 0, density = null;
  const targetCell = 2;       // px per cell (smaller => higher resolution)
  const depositAmount = 1.1;  // deposit per step (slightly higher to build plume faster)
  const densityPrimeBoost = 120; // modest pre-seed at source

  // Cumulative global maximum density for stable normalization (never decreases)
  let globalMaxD = 1;
  let calibrationMaxD = 0;     // max seen during calibration before lock
  let normalizationLocked = false; // lock after first full pass

  // Pass limiting: allow exactly 1 full pass, then stop tracers
  let passCount = 0;
  const maxPasses = 1;
  const cohortDoneRatio = 0.9; // consider pass complete when 90% particles are done
  let showOnlyPlume = false;   // after 1 pass, keep only cumulative plume visible

  // Windy-style flow field (many short streaks advecting with the wind)
  let flowParticles = [];
  let numFlowParticles = 800;
  const flowStepScale = 1.0;       // match tracer advection speed
  const flowJitter = 2.0;          // smaller jitter for cleaner motion
  const flowColor = 'rgba(210,230,255,0.5)';
  const flowThinColor = 'rgba(210,230,255,0.25)';

  function computeWindAt(x, y) {
    const progress = Math.max(0, Math.min(1, x / Math.max(1, width)));
    const angle = baseAngle + turnAcrossScreen * progress;
    
    // Add random wind shear downwind
    const shear = getWindShear(x, y);
    const totalAngle = angle + shear.angleShear;
    const speedMultiplier = shear.speedShear;
    
    let Ux = windSpeed * speedMultiplier * Math.cos(totalAngle) * (1 + shearCoeff * ((y - source.y) / Math.max(1, height)));
    let Uy = windSpeed * speedMultiplier * Math.sin(totalAngle);
    if (Ux < minUx) Ux = minUx;
    return { Ux, Uy };
  }

  function spawnFlowParticle(p) {
    p.x = Math.random() * width;
    p.y = Math.random() * height;
    p.px = p.x; // previous position for drawing short streak
    p.py = p.y;
    p.life = 0;
  }

  function initFlowField() {
    // Massively reduce flow particle count for performance
    numFlowParticles = Math.floor((width * height) / 12000) + 240;
    numFlowParticles = Math.min(numFlowParticles, 600);
    flowParticles.length = 0;
    for (let i = 0; i < numFlowParticles; i++) {
      const p = { x: 0, y: 0, px: 0, py: 0, life: 0 };
      spawnFlowParticle(p);
      flowParticles.push(p);
    }
  }

  function randn() {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }

  // Hash function for pseudo-random but spatially consistent noise
  function hash(x, y) {
    const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return n - Math.floor(n);
  }

  // Smooth noise using bilinear interpolation
  function smoothNoise(x, y) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const n00 = hash(ix, iy);
    const n10 = hash(ix + 1, iy);
    const n01 = hash(ix, iy + 1);
    const n11 = hash(ix + 1, iy + 1);
    const nx0 = n00 * (1 - fx) + n10 * fx;
    const nx1 = n01 * (1 - fx) + n11 * fx;
    return nx0 * (1 - fy) + nx1 * fy;
  }

  // Compute random wind shear at position (varies smoothly in space, stronger downwind)
  function getWindShear(x, y) {
    const progress = Math.max(0, Math.min(1, x / Math.max(1, width)));
    const shearScale = windShearScale * width; // normalize to screen size
    const noiseX = x / shearScale;
    const noiseY = y / shearScale;
    // Use multiple octaves for more realistic turbulence
    const n1 = smoothNoise(noiseX, noiseY);
    const n2 = smoothNoise(noiseX * 2.3, noiseY * 2.3) * 0.5;
    const n3 = smoothNoise(noiseX * 4.7, noiseY * 4.7) * 0.25;
    const noise = (n1 + n2 + n3) / 1.75; // normalize to ~0-1 range
    // Shear increases with downwind distance (linear to max at end for full 65° variation)
    const shearFactor = progress; // linear growth so full strength at end of screen
    const angleShear = (noise - 0.5) * 2 * windShearStrength * shearFactor;
    const speedShear = 1 + (noise - 0.5) * 2 * windShearSpeedVariation * shearFactor;
    return { angleShear, speedShear };
  }

  function initGrid() {
    gridW = Math.max(24, Math.round(width / targetCell));
    gridH = Math.max(14, Math.round(height / targetCell));
    density = new Float32Array(gridW * gridH);
  }

  function gridIndex(gx, gy) {
    if (gx < 0) gx = 0; else if (gx >= gridW) gx = gridW - 1;
    if (gy < 0) gy = 0; else if (gy >= gridH) gy = gridH - 1;
    return gy * gridW + gx;
  }

  // Bilinear deposit for smooth accumulation (updates only when a tracer passes)
  function deposit(x, y, amt) {
    const cx = width / gridW, cy = height / gridH;
    const gx = x / cx, gy = y / cy;
    const x0 = Math.floor(gx), y0 = Math.floor(gy);
    const tx = gx - x0, ty = gy - y0;
    const x1 = x0 + 1, y1 = y0 + 1;
    const w00 = (1 - tx) * (1 - ty);
    const w10 = tx * (1 - ty);
    const w01 = (1 - tx) * ty;
    const w11 = tx * ty;
    density[gridIndex(x0, y0)] += amt * w00;
    density[gridIndex(x1, y0)] += amt * w10;
    density[gridIndex(x0, y1)] += amt * w01;
    density[gridIndex(x1, y1)] += amt * w11;
  }

  function sampleDensity(x, y) {
    const cx = width / gridW, cy = height / gridH;
    const gx = Math.max(0, Math.min(gridW - 1, x / cx));
    const gy = Math.max(0, Math.min(gridH - 1, y / cy));
    const x0 = Math.floor(gx), y0 = Math.floor(gy);
    const tx = gx - x0, ty = gy - y0;
    const x1 = Math.min(gridW - 1, x0 + 1);
    const y1 = Math.min(gridH - 1, y0 + 1);
    const d00 = density[gridIndex(x0, y0)];
    const d10 = density[gridIndex(x1, y0)];
    const d01 = density[gridIndex(x0, y1)];
    const d11 = density[gridIndex(x1, y1)];
    const d0 = d00 * (1 - tx) + d10 * tx;
    const d1 = d01 * (1 - tx) + d11 * tx;
    return d0 * (1 - ty) + d1 * ty;
  }

  // Jet colormap (0..1 -> blue->cyan->yellow->red)
  function jetRGB(t) {
    const clamp01 = (x) => Math.max(0, Math.min(1, x));
    t = clamp01(t);
    const r = clamp01(1.5 - Math.abs(4 * t - 3));
    const g = clamp01(1.5 - Math.abs(4 * t - 2));
    const b = clamp01(1.5 - Math.abs(4 * t - 1));
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
  }

  // Relative (but stabilized) mapping to jet with red bias, using cumulative/locked max
  function colorForDensityJetRelative(d, normMax) {
    if (normMax <= 1e-9) return 'rgb(0,0,80)';
    let norm = d / normMax;
    // Moderate bias toward reds
    norm = Math.pow(norm, 0.42);      // slightly lower gamma for some red
    norm = Math.min(1, norm * 1.25);  // moderate gain
    // Moderate top-end pull to red
    norm = 1 - Math.pow(1 - norm, 1.2);
    const [r, g, b] = jetRGB(norm);
    return `rgb(${r},${g},${b})`;
  }

  // Draw simple black map background
  function drawMapBackground() {
    // Simple black background
    ctx.fillStyle = 'rgba(0,0,0,1)';
    ctx.fillRect(0, 0, width, height);
  }

  let resizeTimeout = null;
  function resize() {
    // Update DPR on resize to handle zoom
    dpr = getDPR();
    const rect = canvas.getBoundingClientRect();
    width = Math.max(320, Math.floor(rect.width));
    height = Math.max(200, Math.floor(rect.height));
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineWidth = 1.0;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    source.x = Math.max(8, width * 0.06);
    source.y = height * 0.58;

    initGrid();
    for (let i = 0; i < densityPrimeBoost; i++) deposit(source.x, source.y, 1.0);

    if (!normalizationLocked) {
      globalMaxD = Math.max(1, globalMaxD);
      calibrationMaxD = 0;
    }

    initFlowField();
  }
  function debouncedResize() {
    if (resizeTimeout) clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(resize, 100);
  }
  resize();
  window.addEventListener('resize', debouncedResize);
  // Handle zoom changes
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', debouncedResize);
  }
  // Also listen for zoom events
  window.addEventListener('orientationchange', debouncedResize);

  // Particles (increase density)
  // Fewer particles to reduce load
  const numParticles = Math.floor((width * height) / 4000) + 600;
  const particles = [];

  function spawnParticle(p) {
    p.x = source.x + randn() * sourceSpread;
    p.y = source.y + randn() * sourceSpread;
    p.age = 0;
    p.alpha = 0.7;
    p.active = true;
  }

  for (let i = 0; i < numParticles; i++) {
    const p = { x: 0, y: 0, age: 0, alpha: 0.7, active: true };
    spawnParticle(p);
    particles.push(p);
  }

  let last = performance.now();
  function frame(now) {
    const dtMs = Math.min(32, now - last);
    last = now;
    const dt = dtMs / 1000;

    // No density decay: bins only increase when tracers pass

    // Track calibration max until first pass lock
    let frameMax = 0;
    for (let i = 0; i < density.length; i++) if (density[i] > frameMax) frameMax = density[i];
    if (!normalizationLocked) calibrationMaxD = Math.max(calibrationMaxD, frameMax);

    // Detect first pass completion to lock normalization
    if (!normalizationLocked) {
      let maxParticleX = 0;
      for (let i = 0; i < particles.length; i++) if (particles[i].x > maxParticleX) maxParticleX = particles[i].x;
      if (maxParticleX >= width * 0.95) {
        globalMaxD = Math.max(1, calibrationMaxD);
        normalizationLocked = true;
      }
    }

    // Clear frame and draw map background
    ctx.globalCompositeOperation = 'source-over';
    drawMapBackground();

    const normMax = normalizationLocked ? globalMaxD : Math.max(1, calibrationMaxD);
    // Lower the effective max to make red appear at lower densities (70% of max)
    const effectiveMax = normMax * 0.7;

    // Draw cumulative plume heatmap
    const cx = width / gridW, cy = height / gridH;
    for (let gy = 0; gy < gridH; gy++) {
      for (let gx = 0; gx < gridW; gx++) {
        // 5x5 smoothing with Gaussian-like weights for very smooth transitions
        const dC = density[gridIndex(gx, gy)];
        if (dC <= 0.0001) continue;
        
        // Get 5x5 neighborhood (all neighbors within 2 cells)
        const dNNW = density[gridIndex(gx - 1, gy - 2)];
        const dNN = density[gridIndex(gx, gy - 2)];
        const dNNE = density[gridIndex(gx + 1, gy - 2)];
        const dNW = density[gridIndex(gx - 1, gy - 1)];
        const dN = density[gridIndex(gx, gy - 1)];
        const dNE = density[gridIndex(gx + 1, gy - 1)];
        const dWW = density[gridIndex(gx - 2, gy)];
        const dW = density[gridIndex(gx - 1, gy)];
        const dE = density[gridIndex(gx + 1, gy)];
        const dEE = density[gridIndex(gx + 2, gy)];
        const dSW = density[gridIndex(gx - 1, gy + 1)];
        const dS = density[gridIndex(gx, gy + 1)];
        const dSE = density[gridIndex(gx + 1, gy + 1)];
        const dSSW = density[gridIndex(gx - 1, gy + 2)];
        const dSS = density[gridIndex(gx, gy + 2)];
        const dSSE = density[gridIndex(gx + 1, gy + 2)];
        
        // Gaussian-like weights: center=8, immediate neighbors=4, next ring=2, outer corners=1
        const dAvg = (dC * 8 + 
                      (dN + dS + dE + dW) * 4 + 
                      (dNW + dNE + dSW + dSE) * 2 +
                      (dNN + dSS + dEE + dWW) * 2 +
                      (dNNW + dNNE + dSSW + dSSE) * 1) / 44;
        ctx.fillStyle = colorForDensityJetRelative(dAvg, effectiveMax);
        ctx.fillRect(gx * cx, gy * cy, cx + 0.5, cy + 0.5);
      }
    }

    // Windy-style flow streaks: many short segments moving with flow
    ctx.lineWidth = 1.0;
    for (let i = 0; i < flowParticles.length; i++) {
      const p = flowParticles[i];
      const { Ux, Uy } = computeWindAt(p.x, p.y);
      // previous position
      const ox = p.x, oy = p.y;
      // step with jitter for organic look
      const jx = (Math.random() - 0.5) * flowJitter * dt;
      const jy = (Math.random() - 0.5) * flowJitter * dt;
      p.x = ox + (Ux * flowStepScale) * dt + jx;
      p.y = oy + (Uy * flowStepScale) * dt + jy;

      // draw segment
      ctx.strokeStyle = (i % 3 === 0) ? flowThinColor : flowColor;
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();

      p.life++;
      // respawn if out or too old
      if (p.x < -12 || p.x > width + 12 || p.y < -12 || p.y > height + 12 || p.life > 240) {
        spawnFlowParticle(p);
      }
    }

    // Update tracers unless we've finished all passes
    if (!showOnlyPlume) {
      let doneCount = 0;

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        if (!p.active) { doneCount++; continue; }

        // Deposit before moving
        deposit(p.x, p.y, depositAmount);

        const progress = Math.max(0, Math.min(1, p.x / Math.max(1, width)));
        const angle = baseAngle + turnAcrossScreen * progress;
        
        // Add random wind shear downwind
        const shear = getWindShear(p.x, p.y);
        const totalAngle = angle + shear.angleShear;
        const speedMultiplier = shear.speedShear;
        
        let Ux = windSpeed * speedMultiplier * Math.cos(totalAngle) * (1 + shearCoeff * ((p.y - source.y) / Math.max(1, height)));
        let Uy = windSpeed * speedMultiplier * Math.sin(totalAngle);
        if (Ux < minUx) Ux = minUx;

        const KxEff = Kx0 + KxGrow * progress;
        const KyEff = Ky0 + KyGrow * progress;
        const sigX = Math.sqrt(Math.max(0, 2 * KxEff * dt));
        const sigY = Math.sqrt(Math.max(0, 2 * KyEff * dt));
        const nx = p.x + (Ux * dt) + (sigX * randn());
        const ny = p.y + (Uy * dt) + (sigY * randn());

        // Draw small circle
        ctx.beginPath();
        ctx.arc(nx, ny, 0.8, 0, Math.PI * 2);
        ctx.fillStyle = '#000000';
        ctx.globalAlpha = p.alpha;
        ctx.fill();
        ctx.globalAlpha = 1;

        p.x = nx; p.y = ny; p.age++;

        // Out of bounds => mark inactive for this pass
        if (nx > width + 60 || ny < -60 || ny > height + 60) {
          p.active = false;
          doneCount++;
        }
      }

      // If cohort is mostly done, advance pass
      const doneRatio = doneCount / particles.length;
      if (doneRatio >= cohortDoneRatio) {
        passCount++;
        if (passCount >= maxPasses) {
          showOnlyPlume = true; // stop tracer updates and respawns
        } else {
          // Respawn all particles at source for next pass
          for (let i = 0; i < particles.length; i++) spawnParticle(particles[i]);
        }
      }
    }

    requestAnimationFrame(frame);
  }

  // Initial clear and draw map background
  drawMapBackground();
  requestAnimationFrame(frame);
})();
