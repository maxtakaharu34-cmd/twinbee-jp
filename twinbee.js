// くもベル — TwinBee-style vertical shooter (vanilla JS, canvas)
(() => {
  'use strict';

  const W = 360, H = 540;
  const PLAYER_R = 14;
  const $ = (id) => document.getElementById(id);
  const canvas = $('game');
  const ctx = canvas.getContext('2d');
  const scoreEl = $('score'), bestEl = $('best'), pwrEl = $('pwr'), livesEl = $('lives');
  const banner = $('banner'), bannerText = $('banner-text');
  const startOv = $('start-overlay'), endOv = $('end-overlay');
  const endTitle = $('end-title'), endScore = $('end-score');
  const btnStart = $('btn-start'), btnAgain = $('btn-again'), btnRestart = $('btn-restart'), btnMute = $('btn-mute');

  // dpr
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = W * dpr; canvas.height = H * dpr;
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // ---------- Audio ----------
  const Sound = (() => {
    let ac = null, muted = localStorage.getItem('tb_muted') === '1';
    const en = () => { if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)(); if (ac.state === 'suspended') ac.resume(); return ac; };
    const beep = (f, d, t = 'square', g = 0.1) => {
      if (muted) return;
      const a = en(); const o = a.createOscillator(); const gn = a.createGain();
      o.type = t; o.frequency.value = f; gn.gain.value = g;
      gn.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + d);
      o.connect(gn).connect(a.destination); o.start(); o.stop(a.currentTime + d);
    };
    return {
      prime: en,
      shoot: () => beep(880, 0.05, 'square', 0.06),
      hit: () => beep(220, 0.08, 'sawtooth', 0.14),
      cloud: () => beep(440, 0.06, 'triangle', 0.1),
      bell: () => beep(1200, 0.06, 'sine', 0.12),
      power: () => [523, 784, 1047].forEach((f, i) => setTimeout(() => beep(f, 0.1, 'triangle', 0.16), i * 70)),
      die: () => [400, 320, 240, 160].forEach((f, i) => setTimeout(() => beep(f, 0.18, 'sawtooth', 0.18), i * 100)),
      toggle: () => { muted = !muted; localStorage.setItem('tb_muted', muted ? '1' : '0'); return muted; },
      isMuted: () => muted
    };
  })();
  btnMute.textContent = Sound.isMuted() ? '🔇' : '🔊';

  // ---------- State ----------
  // Power levels: 'N' normal, 'S' speed, 'R' rapid, 'W' 3-way
  const state = {
    player: { x: W / 2, y: H - 80, alive: true, fireCool: 0, blink: 0 },
    bullets: [],         // player bullets {x,y,dx,dy}
    enemies: [],         // {x,y,dx,dy,hp,kind,t}
    enemyBullets: [],
    clouds: [],          // {x,y,r,hp}
    bells: [],           // {x,y,vy,colorIdx}
    particles: [],
    score: 0, best: +(localStorage.getItem('tb_best') || 0),
    lives: 3,
    power: 'N',
    bgY: 0,
    spawnT: 0,
    cloudT: 0,
    over: false, paused: true,
    readyUntil: 0, dyingUntil: 0,
    invulnUntil: 0,
    keys: { up: false, down: false, left: false, right: false, fire: false }
  };
  bestEl.textContent = state.best;

  const POWER_LABEL = { N: '通常', S: 'スピード', R: '連射', W: '3WAY' };
  // Bell colors cycle when shot: yellow(score)→blue(speed)→white(rapid)→red(3way)
  const BELL_COLORS = ['#ffe066', '#5aa9ff', '#ffffff', '#ff5577'];
  const BELL_LABEL  = ['+500', 'S', 'R', '3W'];

  function reset() {
    state.player.x = W / 2;
    state.player.y = H - 80;
    state.player.alive = true;
    state.player.fireCool = 0;
    state.bullets.length = 0;
    state.enemies.length = 0;
    state.enemyBullets.length = 0;
    state.clouds.length = 0;
    state.bells.length = 0;
    state.particles.length = 0;
    state.score = 0;
    state.lives = 3;
    state.power = 'N';
    state.bgY = 0;
    state.spawnT = 0;
    state.cloudT = 0;
    state.over = false;
    state.paused = false;
    state.dyingUntil = 0;
    state.invulnUntil = performance.now() + 2000;
    state.readyUntil = performance.now() + 800;
    showBanner('READY!', '');
    updateHud();
  }

  function updateHud() {
    scoreEl.textContent = state.score;
    bestEl.textContent = state.best;
    livesEl.textContent = state.lives;
    pwrEl.textContent = POWER_LABEL[state.power];
  }

  function showBanner(t, cls, ms = 1000) {
    bannerText.textContent = t;
    banner.classList.remove('go', 'win');
    if (cls) banner.classList.add(cls);
    banner.classList.add('show');
    clearTimeout(showBanner._t);
    showBanner._t = setTimeout(() => banner.classList.remove('show'), ms);
  }

  // ---------- Spawning ----------
  function spawnEnemy() {
    const kinds = ['scout', 'wave', 'tough'];
    const kind = kinds[Math.floor(Math.random() * kinds.length)];
    const x = 30 + Math.random() * (W - 60);
    // All enemies take 1 hit; speeds reduced
    const e = { x, y: -20, dx: 0, dy: 0.9, hp: 1, kind, t: 0 };
    if (kind === 'wave') e.dy = 1.0;
    if (kind === 'tough') { e.dy = 0.8; }
    state.enemies.push(e);
  }
  function spawnCloud() {
    const x = 30 + Math.random() * (W - 60);
    state.clouds.push({ x, y: -30, r: 18 + Math.random() * 8, hp: 2, dy: 0.6 });
  }

  function fire() {
    if (state.player.fireCool > 0 || !state.player.alive) return;
    Sound.shoot();
    const x = state.player.x, y = state.player.y - 14;
    if (state.power === 'W') {
      state.bullets.push({ x, y, dx: 0, dy: -7 });
      state.bullets.push({ x, y, dx: -2.5, dy: -6.5 });
      state.bullets.push({ x, y, dx: 2.5, dy: -6.5 });
    } else {
      state.bullets.push({ x: x - 5, y, dx: 0, dy: -7 });
      state.bullets.push({ x: x + 5, y, dx: 0, dy: -7 });
    }
    state.player.fireCool = state.power === 'R' ? 6 : 11;
  }

  function applyBell(idx) {
    Sound.power();
    if (idx === 0) { state.score += 500; showBanner('+500', 'win', 700); }
    else if (idx === 1) { state.power = 'S'; showBanner('スピードUP', 'win', 700); }
    else if (idx === 2) { state.power = 'R'; showBanner('連射UP', 'win', 700); }
    else if (idx === 3) { state.power = 'W'; showBanner('3WAY!', 'win', 700); }
    updateHud();
  }

  function emitParticles(x, y, color, n = 8) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.5;
      const sp = 1 + Math.random() * 2.4;
      state.particles.push({ x, y, dx: Math.cos(a) * sp, dy: Math.sin(a) * sp, life: 25, color });
    }
  }

  // ---------- Update ----------
  function update() {
    const now = performance.now();
    if (state.paused || state.over) return;
    state.bgY = (state.bgY + 1.2) % 64;

    if (now < state.readyUntil) return;

    // Player
    const speed = state.power === 'S' ? 4.4 : 3.2;
    const p = state.player;
    if (p.alive) {
      if (state.keys.up)    p.y -= speed;
      if (state.keys.down)  p.y += speed;
      if (state.keys.left)  p.x -= speed;
      if (state.keys.right) p.x += speed;
      p.x = Math.max(16, Math.min(W - 16, p.x));
      p.y = Math.max(40, Math.min(H - 30, p.y));
      if (p.fireCool > 0) p.fireCool--;
      if (state.keys.fire) fire();
    }

    // Spawn (much slower than before)
    state.spawnT++;
    if (state.spawnT > 90 + Math.random() * 40) {
      state.spawnT = 0;
      spawnEnemy();
    }
    state.cloudT++;
    if (state.cloudT > 80) {
      state.cloudT = 0;
      spawnCloud();
    }

    // Bullets
    for (let i = state.bullets.length - 1; i >= 0; i--) {
      const b = state.bullets[i];
      b.x += b.dx; b.y += b.dy;
      if (b.y < -10 || b.x < -10 || b.x > W + 10) state.bullets.splice(i, 1);
    }

    // Clouds
    for (let i = state.clouds.length - 1; i >= 0; i--) {
      const c = state.clouds[i];
      c.y += c.dy;
      if (c.y > H + 30) state.clouds.splice(i, 1);
    }

    // Enemies
    for (let i = state.enemies.length - 1; i >= 0; i--) {
      const e = state.enemies[i];
      e.t++;
      if (e.kind === 'wave') {
        e.x += Math.sin(e.t / 18) * 1.3;
      } else if (e.kind === 'tough') {
        // gentle homing
        e.x += Math.sign(p.x - e.x) * 0.4;
      }
      e.y += e.dy;
      // shoot rarely (reduced and slower)
      if (Math.random() < 0.0015 + (e.kind === 'tough' ? 0.002 : 0)) {
        const ang = Math.atan2(p.y - e.y, p.x - e.x);
        state.enemyBullets.push({ x: e.x, y: e.y, dx: Math.cos(ang) * 1.6, dy: Math.sin(ang) * 1.6 });
      }
      if (e.y > H + 20) state.enemies.splice(i, 1);
    }

    // Enemy bullets
    for (let i = state.enemyBullets.length - 1; i >= 0; i--) {
      const b = state.enemyBullets[i];
      b.x += b.dx; b.y += b.dy;
      if (b.y < -10 || b.y > H + 10 || b.x < -10 || b.x > W + 10) state.enemyBullets.splice(i, 1);
    }

    // Bells
    for (let i = state.bells.length - 1; i >= 0; i--) {
      const b = state.bells[i];
      b.y += b.vy;
      if (b.vy < 1.4) b.vy += 0.02;
      if (b.y > H + 20) state.bells.splice(i, 1);
    }

    // Player bullet vs enemy / cloud / bell
    for (let i = state.bullets.length - 1; i >= 0; i--) {
      const b = state.bullets[i];
      let hit = false;
      // enemy
      for (let j = 0; j < state.enemies.length; j++) {
        const e = state.enemies[j];
        if (Math.abs(b.x - e.x) < 14 && Math.abs(b.y - e.y) < 14) {
          e.hp--;
          Sound.hit();
          if (e.hp <= 0) {
            state.score += e.kind === 'tough' ? 200 : e.kind === 'wave' ? 150 : 100;
            emitParticles(e.x, e.y, '#ff8855', 10);
            state.enemies.splice(j, 1);
          }
          hit = true;
          break;
        }
      }
      if (hit) { state.bullets.splice(i, 1); continue; }
      // cloud
      for (let j = 0; j < state.clouds.length; j++) {
        const c = state.clouds[j];
        if (Math.hypot(b.x - c.x, b.y - c.y) < c.r + 2) {
          c.hp--;
          Sound.cloud();
          if (c.hp <= 0) {
            // pop bell out
            state.bells.push({ x: c.x, y: c.y, vy: -2, colorIdx: 0 });
            emitParticles(c.x, c.y, '#fff', 6);
            state.clouds.splice(j, 1);
          }
          hit = true;
          break;
        }
      }
      if (hit) { state.bullets.splice(i, 1); continue; }
      // bell — cycle color
      for (let j = 0; j < state.bells.length; j++) {
        const bell = state.bells[j];
        if (Math.abs(b.x - bell.x) < 12 && Math.abs(b.y - bell.y) < 12) {
          bell.colorIdx = (bell.colorIdx + 1) % BELL_COLORS.length;
          bell.vy = -1.2; // little bounce
          Sound.bell();
          hit = true;
          break;
        }
      }
      if (hit) { state.bullets.splice(i, 1); continue; }
    }

    // Player collide (bells always pick up; damage skipped during invulnerability)
    if (p.alive) {
      // Bell pickup (no invuln required — picking up powerups is always safe)
      for (let j = state.bells.length - 1; j >= 0; j--) {
        const bell = state.bells[j];
        if (Math.abs(p.x - bell.x) < 16 && Math.abs(p.y - bell.y) < 16) {
          applyBell(bell.colorIdx);
          state.bells.splice(j, 1);
        }
      }
      const invuln = now < state.invulnUntil;
      if (!state.dyingUntil && !invuln) {
        // Enemy bullet
        for (let j = state.enemyBullets.length - 1; j >= 0; j--) {
          const b = state.enemyBullets[j];
          if (Math.abs(p.x - b.x) < 12 && Math.abs(p.y - b.y) < 12) {
            state.enemyBullets.splice(j, 1);
            loseLife();
            return;
          }
        }
        // Enemy body collision (smaller hitbox so weaving is doable)
        for (let j = state.enemies.length - 1; j >= 0; j--) {
          const e = state.enemies[j];
          if (Math.abs(p.x - e.x) < 14 && Math.abs(p.y - e.y) < 14) {
            loseLife();
            return;
          }
        }
      }
    }

    // Particles
    for (let i = state.particles.length - 1; i >= 0; i--) {
      const pt = state.particles[i];
      pt.x += pt.dx; pt.y += pt.dy; pt.dy += 0.05; pt.life--;
      if (pt.life <= 0) state.particles.splice(i, 1);
    }
  }

  function loseLife() {
    state.player.alive = false;
    state.lives--;
    Sound.die();
    state.power = 'N';
    showBanner('やられた…', 'go', 1100);
    state.dyingUntil = performance.now() + 1100;
    updateHud();
    setTimeout(() => {
      // Lives is the number of remaining ships; <=0 means no ships left
      if (state.lives <= 0) {
        gameOver();
        return;
      }
      state.player.alive = true;
      state.player.x = W / 2;
      state.player.y = H - 80;
      state.dyingUntil = 0;
      // 2 seconds of invulnerability after respawn (prevents being one-shot
      // back to the menu by a bullet that was already on screen).
      state.invulnUntil = performance.now() + 2000;
      // Also clear any active enemy bullets so the player has air to breathe
      state.enemyBullets.length = 0;
      updateHud();
    }, 1100);
  }
  function gameOver() {
    state.over = true;
    if (state.score > state.best) {
      state.best = state.score;
      localStorage.setItem('tb_best', String(state.best));
    }
    endTitle.textContent = 'GAME OVER';
    endScore.textContent = state.score;
    endOv.classList.add('show');
  }

  // ---------- Render ----------
  function render() {
    // sky / sea bg
    ctx.fillStyle = '#1a4a8c';
    ctx.fillRect(0, 0, W, H);
    // moving stripes
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    for (let y = -64 + state.bgY; y < H; y += 64) {
      ctx.fillRect(0, y, W, 32);
    }
    // distant clouds (decorative)
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    for (let i = 0; i < 6; i++) {
      const cx = (i * 73 + 30) % W;
      const cy = ((i * 113 + state.bgY * 0.6) % (H + 60)) - 30;
      ctx.beginPath();
      ctx.arc(cx, cy, 14, 0, Math.PI * 2);
      ctx.arc(cx + 12, cy + 4, 12, 0, Math.PI * 2);
      ctx.arc(cx - 12, cy + 4, 12, 0, Math.PI * 2);
      ctx.fill();
    }

    // Solid clouds (shootable)
    for (const c of state.clouds) {
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
      ctx.arc(c.x + c.r * 0.6, c.y + 4, c.r * 0.85, 0, Math.PI * 2);
      ctx.arc(c.x - c.r * 0.6, c.y + 4, c.r * 0.85, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#444';
      ctx.stroke();
    }

    // Bells
    for (const b of state.bells) {
      const color = BELL_COLORS[b.colorIdx];
      ctx.save();
      // body
      ctx.fillStyle = color;
      ctx.strokeStyle = '#222';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(b.x - 9, b.y + 7);
      ctx.lineTo(b.x - 11, b.y + 4);
      ctx.quadraticCurveTo(b.x - 12, b.y - 8, b.x, b.y - 10);
      ctx.quadraticCurveTo(b.x + 12, b.y - 8, b.x + 11, b.y + 4);
      ctx.lineTo(b.x + 9, b.y + 7);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // clapper
      ctx.fillStyle = '#222';
      ctx.beginPath(); ctx.arc(b.x, b.y + 9, 2.5, 0, Math.PI * 2); ctx.fill();
      // eyes
      ctx.fillStyle = '#222';
      ctx.beginPath(); ctx.arc(b.x - 3, b.y - 1, 1.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(b.x + 3, b.y - 1, 1.5, 0, Math.PI * 2); ctx.fill();
      // letter (only when not yellow)
      if (b.colorIdx !== 0) {
        ctx.fillStyle = '#222';
        ctx.font = 'bold 9px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(BELL_LABEL[b.colorIdx], b.x, b.y + 4);
      }
      ctx.restore();
    }

    // Enemies
    for (const e of state.enemies) {
      ctx.save();
      ctx.translate(e.x, e.y);
      const c = e.kind === 'tough' ? '#ff5577' : e.kind === 'wave' ? '#a855ff' : '#5cdc8b';
      ctx.fillStyle = c;
      ctx.strokeStyle = '#222';
      ctx.lineWidth = 2;
      ctx.beginPath();
      // saucer-ish enemy
      ctx.ellipse(0, 0, 14, 6, 0, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(0, -2, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.arc(0, -2, 2, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    // Bullets
    ctx.fillStyle = '#ffe066';
    for (const b of state.bullets) ctx.fillRect(b.x - 1.5, b.y - 5, 3, 10);
    ctx.fillStyle = '#ff5577';
    for (const b of state.enemyBullets) {
      ctx.beginPath(); ctx.arc(b.x, b.y, 3, 0, Math.PI * 2); ctx.fill();
    }

    // Player (TwinBee-ish: round body, big eyes, two side cannons)
    const p = state.player;
    const invuln = performance.now() < state.invulnUntil;
    if (p.alive) {
      // Blink during invulnerability
      if (!invuln || Math.floor(performance.now() / 80) % 2 === 0) {
        drawTwinbee(p.x, p.y);
      }
    } else {
      // explosion-ish blink
      ctx.fillStyle = '#ff8855';
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        ctx.fillRect(p.x + Math.cos(a) * 14 - 1, p.y + Math.sin(a) * 14 - 1, 3, 3);
      }
    }

    // Particles
    for (const pt of state.particles) {
      ctx.fillStyle = pt.color;
      ctx.fillRect(pt.x, pt.y, 2, 2);
    }
  }

  function drawTwinbee(x, y) {
    ctx.save();
    ctx.translate(x, y);
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.ellipse(0, 12, 14, 3, 0, 0, Math.PI * 2); ctx.fill();
    // side wings/cannons
    ctx.fillStyle = '#bdf';
    ctx.strokeStyle = '#003a73';
    ctx.lineWidth = 2;
    ctx.fillRect(-18, -2, 6, 12); ctx.strokeRect(-18, -2, 6, 12);
    ctx.fillRect(12, -2, 6, 12); ctx.strokeRect(12, -2, 6, 12);
    // body (yellow)
    const grad = ctx.createRadialGradient(-3, -3, 1, 0, 0, PLAYER_R);
    grad.addColorStop(0, '#fff');
    grad.addColorStop(0.4, '#ffe066');
    grad.addColorStop(1, '#ffaa00');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(0, 0, PLAYER_R, 0, Math.PI * 2); ctx.fill();
    ctx.stroke();
    // cockpit
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.ellipse(0, -2, 8, 6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.stroke();
    // eyes
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.arc(-3, -2, 1.6, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(3, -2, 1.6, 0, Math.PI * 2); ctx.fill();
    // smile
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(0, 1, 3, 0, Math.PI); ctx.stroke();
    ctx.restore();
  }

  // ---------- Loop ----------
  function loop() {
    update();
    render();
    updateHud();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // ---------- Input ----------
  const setKey = (k, v) => { state.keys[k] = v; };
  document.querySelectorAll('.pad-btn').forEach((b) => {
    const act = b.dataset.act;
    const on = (e) => { e.preventDefault(); Sound.prime(); setKey(act, true); };
    const off = (e) => { e.preventDefault(); setKey(act, false); };
    b.addEventListener('touchstart', on, { passive: false });
    b.addEventListener('touchend', off, { passive: false });
    b.addEventListener('touchcancel', off);
    b.addEventListener('mousedown', on);
    b.addEventListener('mouseup', off);
    b.addEventListener('mouseleave', off);
  });
  window.addEventListener('keydown', (e) => {
    const k = e.key;
    if (k === 'ArrowUp' || k === 'w' || k === 'W') { setKey('up', true); e.preventDefault(); }
    else if (k === 'ArrowDown' || k === 's' || k === 'S') { setKey('down', true); e.preventDefault(); }
    else if (k === 'ArrowLeft' || k === 'a' || k === 'A') { setKey('left', true); e.preventDefault(); }
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') { setKey('right', true); e.preventDefault(); }
    else if (k === ' ' || k === 'Spacebar' || k === 'z' || k === 'Z') { setKey('fire', true); e.preventDefault(); Sound.prime(); }
  }, { passive: false });
  window.addEventListener('keyup', (e) => {
    const k = e.key;
    if (k === 'ArrowUp' || k === 'w' || k === 'W') setKey('up', false);
    else if (k === 'ArrowDown' || k === 's' || k === 'S') setKey('down', false);
    else if (k === 'ArrowLeft' || k === 'a' || k === 'A') setKey('left', false);
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') setKey('right', false);
    else if (k === ' ' || k === 'Spacebar' || k === 'z' || k === 'Z') setKey('fire', false);
  });

  btnStart.addEventListener('click', () => { Sound.prime(); startOv.classList.remove('show'); reset(); });
  btnAgain.addEventListener('click', () => { Sound.prime(); endOv.classList.remove('show'); reset(); });
  btnRestart.addEventListener('click', () => {
    if (!confirm('リスタートしますか？')) return;
    endOv.classList.remove('show');
    reset();
  });
  btnMute.addEventListener('click', () => {
    const m = Sound.toggle();
    btnMute.textContent = m ? '🔇' : '🔊';
  });

  // initial render so canvas isn't blank
  render();
})();
