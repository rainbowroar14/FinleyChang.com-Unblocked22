(function () {
  const catcher = document.getElementById("catcher");
  const textEl = document.getElementById("text");
  const promptEl = document.getElementById("prompt");
  const eqMark = document.getElementById("eq-mark");
  const liveAns = document.getElementById("live-ans");
  const hintEl = document.getElementById("hint");
  const blocksEl = document.getElementById("blocks");

  const COLORS = [
    "#ffffff",
    "#ff3b3b",
    "#ff9f1a",
    "#ffe066",
    "#4ade80",
    "#38bdf8",
    "#a78bfa",
    "#f472b6",
  ];

  const SIZE = 12;
  const GAP = 4;

  const state = {
    buffer: "",
    caret: 0,
    liveDisplay: "",
    liveValue: null,
    autoTimer: 0,
    animId: 0,
    blockAnimId: 0,
    burstTimer: 0,
    particles: [],
    layoutBase: { x: 0, y: 0 },
  };

  function focusCatcher() {
    catcher.focus({ preventScroll: true });
  }

  function setBuffer(value, caret) {
    state.buffer = value;
    state.caret = caret == null ? value.length : caret;
    if (catcher.value !== value) catcher.value = value;
    const c = Math.max(0, Math.min(value.length, state.caret));
    try {
      catcher.setSelectionRange(c, c);
    } catch {
      /* ignore */
    }
    renderPrompt();
  }

  function cleanExpr(raw) {
    return String(raw || "")
      .replace(/=/g, "")
      .trim();
  }

  function isComplete(ast) {
    return ast && (ast.type === "bin" || ast.type === "call");
  }

  function renderPrompt() {
    const before = state.buffer.slice(0, state.caret);
    const after = state.buffer.slice(state.caret);
    textEl.textContent = before;
    promptEl.querySelector(".after").textContent = after;
    eqMark.textContent = state.liveDisplay !== "" && state.liveDisplay != null ? " = " : "";
    if (!liveAns.querySelector(".flip")) {
      liveAns.textContent = state.liveDisplay || "";
    }
    hintEl.classList.toggle("gone", state.buffer.length > 0);
  }

  function originPoint() {
    const box = liveAns.getBoundingClientRect();
    return {
      x: box.left + box.width / 2 - SIZE / 2,
      y: box.top + box.height / 2 - SIZE / 2,
    };
  }

  function colorForTier(tier) {
    return COLORS[((tier % COLORS.length) + COLORS.length) % COLORS.length];
  }

  function buildTargets(n) {
    let left = Math.round(Math.abs(n));
    if (!Number.isFinite(left) || left <= 0) {
      return { targets: [], width: 0, height: 0 };
    }

    let tier = 0;
    const groups = [];

    while (left > 0 && tier < 24) {
      const chunk = left % 1000;
      const hundreds = Math.floor(chunk / 100);
      const tens = Math.floor((chunk % 100) / 10);
      const ones = chunk % 10;
      const color = colorForTier(tier);

      for (let h = 0; h < hundreds; h += 1) groups.push({ count: 100, cols: 10, color });
      for (let t = 0; t < tens; t += 1) groups.push({ count: 10, cols: 10, color });
      for (let o = 0; o < ones; o += 1) groups.push({ count: 1, cols: 1, color });

      left = Math.floor(left / 1000);
      tier += 1;
    }

    const total = groups.reduce((s, g) => s + g.count, 0);
    if (total > 500) return buildCompactTargets(Math.round(Math.abs(n)));

    const targets = [];
    const cell = SIZE + GAP;
    let cursorX = 0;
    let cursorY = 0;
    let rowH = 0;
    const maxW = Math.min(window.innerWidth * 0.72, 560);
    const groupGap = 18;

    groups.forEach((g) => {
      const cols = g.cols;
      const rows = Math.ceil(g.count / cols);
      const gw = cols * cell - GAP;
      const gh = rows * cell - GAP;

      if (cursorX + gw > maxW && cursorX > 0) {
        cursorX = 0;
        cursorY += rowH + groupGap;
        rowH = 0;
      }

      for (let i = 0; i < g.count; i += 1) {
        const c = i % cols;
        const r = Math.floor(i / cols);
        targets.push({
          x: cursorX + c * cell,
          y: cursorY + r * cell,
          color: g.color,
        });
      }

      cursorX += gw + groupGap;
      rowH = Math.max(rowH, gh);
    });

    const width = targets.reduce((m, t) => Math.max(m, t.x + SIZE), 0);
    const height = targets.reduce((m, t) => Math.max(m, t.y + SIZE), 0);
    return { targets, width, height };
  }

  function buildCompactTargets(n) {
    const targets = [];
    let left = n;
    let tier = 0;
    const pieces = [];
    while (left > 0 && tier < 24) {
      const chunk = left % 1000;
      const hundreds = Math.floor(chunk / 100);
      const tens = Math.floor((chunk % 100) / 10);
      const ones = chunk % 10;
      const color = colorForTier(tier);
      for (let i = 0; i < hundreds; i += 1) pieces.push(color);
      for (let i = 0; i < tens; i += 1) pieces.push(color);
      for (let i = 0; i < ones; i += 1) pieces.push(color);
      left = Math.floor(left / 1000);
      tier += 1;
    }
    const cell = SIZE + GAP;
    pieces.forEach((color, i) => {
      targets.push({ x: (i % 20) * cell, y: Math.floor(i / 20) * cell, color });
    });
    const width = targets.reduce((m, t) => Math.max(m, t.x + SIZE), 0);
    const height = targets.reduce((m, t) => Math.max(m, t.y + SIZE), 0);
    return { targets, width, height };
  }

  function makeBlock(color) {
    const el = document.createElement("div");
    el.className = "block";
    el.style.background = color;
    el.style.borderColor = color;
    el.style.width = SIZE + "px";
    el.style.height = SIZE + "px";
    blocksEl.appendChild(el);
    return el;
  }

  function stopBlockLoop() {
    cancelAnimationFrame(state.blockAnimId);
    state.blockAnimId = 0;
  }

  function runParticles() {
    stopBlockLoop();
    let last = performance.now();

    function tick(now) {
      const dt = Math.min(32, now - last) / 16.67;
      last = now;
      let busy = false;
      const ox = originPoint();

      state.particles = state.particles.filter((p) => {
        if (p.gone) {
          p.el.remove();
          return false;
        }

        if (p.settled && p.phase === "idle") {
          p.el.style.transform = `translate(${p.tx}px, ${p.ty}px)`;
          p.el.style.opacity = "1";
          return true;
        }

        busy = true;
        p.age += dt * 16.67;

        if (p.phase === "burst") {
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.vx *= Math.pow(0.92, dt);
          p.vy *= Math.pow(0.92, dt);
          p.vy += 0.12 * dt;
          if (p.age >= 260) {
            p.phase = "home";
            p.age = 0;
          }
        } else if (p.phase === "home" || p.phase === "rehome") {
          const dx = p.tx - p.x;
          const dy = p.ty - p.y;
          const dist = Math.hypot(dx, dy) || 1;
          const progress = Math.min(1, p.age / 850);
          const pull = 0.1 + progress * progress * 0.6;
          p.vx += (dx / dist) * pull * dt * 18;
          p.vy += (dy / dist) * pull * dt * 18;
          p.vx *= Math.pow(0.86, dt);
          p.vy *= Math.pow(0.86, dt);
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          if (dist < 2 || (progress > 0.88 && dist < 7)) {
            p.x = p.tx;
            p.y = p.ty;
            p.vx = 0;
            p.vy = 0;
            p.settled = true;
            p.phase = "idle";
          }
        } else if (p.phase === "retract") {
          const dx = ox.x - p.x;
          const dy = ox.y - p.y;
          const dist = Math.hypot(dx, dy) || 1;
          const progress = Math.min(1, p.age / 700);
          const pull = 0.12 + progress * progress * 0.7;
          p.vx += (dx / dist) * pull * dt * 20;
          p.vy += (dy / dist) * pull * dt * 20;
          p.vx *= Math.pow(0.84, dt);
          p.vy *= Math.pow(0.84, dt);
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.el.style.opacity = String(Math.max(0, 1 - progress));
          if (dist < 4 || progress >= 1) {
            p.gone = true;
            p.el.remove();
            return false;
          }
        }

        p.el.style.transform = `translate(${p.x}px, ${p.y}px)`;
        if (p.phase !== "retract") p.el.style.opacity = "1";
        return true;
      });

      if (busy || state.particles.some((p) => p.phase !== "idle")) {
        state.blockAnimId = requestAnimationFrame(tick);
      } else {
        state.blockAnimId = 0;
      }
    }

    state.blockAnimId = requestAnimationFrame(tick);
  }

  function syncBlocks(value, mode) {
    window.clearTimeout(state.burstTimer);
    const abs = Math.abs(Number(value));
    if (!Number.isFinite(abs) || abs === 0) {
      // retract everything
      const ox = originPoint();
      state.particles.forEach((p) => {
        if (p.phase === "retract") return;
        p.phase = "retract";
        p.age = 0;
        p.settled = false;
        p.vx = (Math.random() - 0.5) * 4;
        p.vy = (Math.random() - 0.5) * 4;
        p.tx = ox.x;
        p.ty = ox.y;
      });
      runParticles();
      return;
    }

    const built = buildTargets(abs);
    if (!built.targets.length) return;

    const baseX = (window.innerWidth - built.width) / 2;
    const baseY = Math.min(window.innerHeight - built.height - 36, window.innerHeight * 0.64);
    state.layoutBase = { x: baseX, y: baseY };

    const targets = built.targets.map((t) => ({
      x: baseX + t.x,
      y: baseY + t.y,
      color: t.color,
    }));

    const keepers = state.particles.filter((p) => p.phase !== "retract" && !p.gone);
    const reuse = Math.min(keepers.length, targets.length);

    // Rehome keepers we can reuse
    for (let i = 0; i < reuse; i += 1) {
      const p = keepers[i];
      const t = targets[i];
      p.tx = t.x;
      p.ty = t.y;
      p.el.style.background = t.color;
      p.el.style.borderColor = t.color;
      p.settled = false;
      p.phase = "rehome";
      p.age = 0;
      p.vx *= 0.3;
      p.vy *= 0.3;
    }

    // Excess go back into the number
    for (let i = reuse; i < keepers.length; i += 1) {
      const p = keepers[i];
      p.phase = "retract";
      p.age = 0;
      p.settled = false;
      p.vx = (Math.random() - 0.5) * 6;
      p.vy = (Math.random() - 0.5) * 6;
    }

    // Need more: burst out after a short beat when changing, immediate-ish when first
    const need = targets.length - reuse;
    const ox = originPoint();
    const spawnDelay = mode === "change" ? 180 : 0;

    function spawnExtras() {
      for (let i = 0; i < need; i += 1) {
        const t = targets[reuse + i];
        const el = makeBlock(t.color);
        const angle = Math.random() * Math.PI * 2;
        const power = 7 + Math.random() * 13;
        state.particles.push({
          el,
          x: ox.x,
          y: ox.y,
          vx: Math.cos(angle) * power,
          vy: Math.sin(angle) * power,
          tx: t.x,
          ty: t.y,
          phase: "burst",
          age: 0,
          settled: false,
          gone: false,
        });
      }
      runParticles();
    }

    if (need > 0) {
      if (spawnDelay) {
        state.burstTimer = window.setTimeout(spawnExtras, spawnDelay);
        runParticles();
      } else {
        spawnExtras();
      }
    } else {
      runParticles();
    }
  }

  function flipNumber(oldDisplay, newDisplay, direction) {
    // direction: 1 = went up (flip up), -1 = went down (flip down)
    liveAns.innerHTML = "";
    const wrap = document.createElement("span");
    wrap.className = "flip " + (direction > 0 ? "up" : "down");

    const oldEl = document.createElement("span");
    oldEl.className = "flip-face flip-old";
    oldEl.textContent = oldDisplay;

    const newEl = document.createElement("span");
    newEl.className = "flip-face flip-new";
    newEl.textContent = newDisplay;

    wrap.appendChild(oldEl);
    wrap.appendChild(newEl);
    liveAns.appendChild(wrap);
    eqMark.textContent = " = ";

    // force reflow then play
    void wrap.offsetWidth;
    wrap.classList.add("play");

    return new Promise((resolve) => {
      const done = () => {
        liveAns.textContent = newDisplay;
        resolve();
      };
      wrap.addEventListener("animationend", done, { once: true });
      window.setTimeout(done, 700);
    });
  }

  function slideInFirst(display) {
    liveAns.classList.add("waiting");
    liveAns.textContent = display;
    eqMark.textContent = " = ";
    void promptEl.offsetWidth;

    const dest = liveAns.getBoundingClientRect();
    const el = document.createElement("div");
    el.className = "fall";
    el.textContent = display;
    const cs = getComputedStyle(promptEl);
    el.style.fontSize = cs.fontSize;
    el.style.fontFamily = cs.fontFamily;
    document.body.appendChild(el);

    const startX = dest.left;
    const startY = -Math.max(40, el.offsetHeight);
    const endY = dest.top;
    const duration = 780;
    const t0 = performance.now();

    return new Promise((resolve) => {
      function frame(now) {
        const t = Math.min(1, (now - t0) / duration);
        const e = Math.pow(t, 3.4);
        el.style.transform = `translate(${startX}px, ${startY + (endY - startY) * e}px)`;
        if (t < 1) {
          state.animId = requestAnimationFrame(frame);
          return;
        }
        el.remove();
        liveAns.classList.remove("waiting");
        liveAns.textContent = display;
        resolve();
      }
      el.style.transform = `translate(${startX}px, ${startY}px)`;
      state.animId = requestAnimationFrame(frame);
    });
  }

  async function presentAnswer(display, value) {
    cancelAnimationFrame(state.animId);
    window.clearTimeout(state.burstTimer);

    const prev = state.liveValue;
    const prevDisplay = state.liveDisplay;
    const had = prev != null && prevDisplay !== "" && Number.isFinite(Number(prev));

    state.liveDisplay = display;
    state.liveValue = value;

    if (!had) {
      await slideInFirst(display);
      state.burstTimer = window.setTimeout(() => syncBlocks(value, "first"), 300);
      return;
    }

    const oldN = Number(prev);
    const newN = Number(value);
    const direction = newN >= oldN ? 1 : -1;

    await flipNumber(String(prevDisplay), String(display), direction);
    syncBlocks(value, "change");
  }

  function clearLive() {
    cancelAnimationFrame(state.animId);
    window.clearTimeout(state.burstTimer);
    stopBlockLoop();

    // retract boxes into wherever the answer was
    if (state.particles.length) {
      const ox = originPoint();
      state.particles.forEach((p) => {
        p.phase = "retract";
        p.age = 0;
        p.settled = false;
        p.vx = (Math.random() - 0.5) * 5;
        p.vy = (Math.random() - 0.5) * 5;
        p.tx = ox.x;
        p.ty = ox.y;
      });
      runParticles();
    }

    state.liveDisplay = "";
    state.liveValue = null;
    liveAns.textContent = "";
    liveAns.classList.remove("waiting");
    eqMark.textContent = "";
    document.querySelectorAll(".fall").forEach((n) => n.remove());
  }

  function tryAuto() {
    const expr = cleanExpr(state.buffer);
    if (!expr) {
      clearLive();
      return;
    }

    try {
      const result = window.VisualMath.evaluate(expr);
      if (!isComplete(result.ast)) {
        clearLive();
        return;
      }
      if (result.display === state.liveDisplay) return;
      presentAnswer(result.display, result.value);
    } catch {
      clearLive();
    }
  }

  function scheduleAuto() {
    window.clearTimeout(state.autoTimer);
    state.autoTimer = window.setTimeout(tryAuto, 100);
  }

  function insert(ch) {
    const next = state.buffer.slice(0, state.caret) + ch + state.buffer.slice(state.caret);
    setBuffer(next, state.caret + ch.length);
    scheduleAuto();
  }

  function onKey(event) {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.isComposing) return;

    if (event.key === "Enter" || event.key === "=") {
      event.preventDefault();
      tryAuto();
      return;
    }

    if (event.key === "Backspace") {
      event.preventDefault();
      if (state.caret === 0) return;
      const next = state.buffer.slice(0, state.caret - 1) + state.buffer.slice(state.caret);
      setBuffer(next, state.caret - 1);
      scheduleAuto();
      return;
    }

    if (event.key === "Delete") {
      event.preventDefault();
      const next = state.buffer.slice(0, state.caret) + state.buffer.slice(state.caret + 1);
      setBuffer(next, state.caret);
      scheduleAuto();
      return;
    }

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setBuffer(state.buffer, Math.max(0, state.caret - 1));
      return;
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      setBuffer(state.buffer, Math.min(state.buffer.length, state.caret + 1));
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      setBuffer(state.buffer, 0);
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      setBuffer(state.buffer, state.buffer.length);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setBuffer("", 0);
      clearLive();
      return;
    }

    if (event.key.length === 1) {
      event.preventDefault();
      insert(event.key);
    }
  }

  window.addEventListener("keydown", onKey, true);
  document.addEventListener("click", focusCatcher);

  setBuffer("", 0);
  focusCatcher();
})();
