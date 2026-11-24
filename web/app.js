// Meta-intersecting pentagon visualizer. Data comes from data.js (export.py).
(function () {
  "use strict";

  const D = window.PENTA;
  if (!D) {
    document.body.innerHTML = "<p style='padding:20px'>web/data.js is missing. Run <code>python export.py</code> first.</p>";
    return;
  }
  // The dataset on screen: the exact regular pentagon from data.js, or a live
  // (float) computation for one of the 15 tiling types. Both have the same shape.
  let P = D.points;             // [x, y, birthRound, gasketLayer]
  let R = D.rounds;
  let maxRound = R.length - 1;

  const $ = (id) => document.getElementById(id);
  const cv = $("cv"), wrap = $("wrap"), tip = $("tip");
  const ctx = cv.getContext("2d");
  const state = { k: 0, gasket: true, scale: 1, ox: 0, oy: 0, hover: -1, layerHi: -1,
                  shape: 0, hoverVertex: -1, vec: "none", vecK: 2 };      // shape 0 = regular, 1..15 = tiling type
  const G = D.golden, R4 = D.round4, FIT = D.fits;

  // ---------------------------------------------------------- tiling types ---
  const TT = window.TileTypes, LE = window.LiveEngine, LA = window.LiveAnalysis, LS = window.LiveSpectral;

  // Laplacian eigen-solves run in a Web Worker (round 3 of a tiling type takes
  // several seconds). Falls back to the page thread if workers are unavailable.
  function spectralRunner() {
    let w = null, id = 0;
    const jobs = new Map();
    function worker() {
      if (w !== null) return w;
      try {
        w = new Worker(URL.createObjectURL(new Blob([LS.workerSource], { type: "text/javascript" })));
        w.onmessage = (e) => { const j = jobs.get(e.data.id); if (j) { jobs.delete(e.data.id); j(e.data.r); } };
      } catch (err) { w = false; }
      return w;
    }
    return {
      run(csr) {
        const wk = worker();
        if (!wk) return new Promise((res) => setTimeout(() => res(LS.run(csr)), 0));
        return new Promise((res) => { const i = ++id; jobs.set(i, res); wk.postMessage({ id: i, off: csr.off, nbr: csr.nbr }); });
      },
      cancel() { if (w && jobs.size) { w.terminate(); w = null; jobs.clear(); } },
    };
  }
  const mainRunner = spectralRunner(), exportRunner = spectralRunner();
  const LIVE_ROUNDS = 3;
  const shapes = {};            // type n -> 10 coords [xA, yA, ..., xE, yE] (world units)
  const typeInfo = {};          // type n -> {dof}
  const summaries = {};         // type n -> per-round counts at the current shape
  const isType = () => state.shape > 0;
  const curType = () => TT.TYPES[state.shape - 1];
  const vertsOf = (x) => [0, 1, 2, 3, 4].map((i) => [x[2 * i], x[2 * i + 1]]);
  TT.TYPES.forEach((T) => {
    shapes[T.n] = TT.initial(T);
    typeInfo[T.n] = TT.dof(T, shapes[T.n]);
  });

  // Run the engine on a normalised copy (centred, circumradius 1) so its
  // absolute tolerances mean the same at any zoom or size, then map back.
  function computeLive(x, rounds) {
    const v = vertsOf(x);
    const cx = v.reduce((s, p) => s + p[0], 0) / 5, cy = v.reduce((s, p) => s + p[1], 0) / 5;
    const r = Math.max(...v.map((p) => Math.hypot(p[0] - cx, p[1] - cy)));
    const out = LE.compute(v.map((p) => [(p[0] - cx) / r, (p[1] - cy) / r]), rounds);
    for (const p of out.points) { p[0] = p[0] * r + cx; p[1] = p[1] * r + cy; }
    out.layers = out.layers.map((L) => L.map((p) => [p[0] * r + cx, p[1] * r + cy]));
    return out;
  }
  let live = null;
  function recomputeLive() {
    mainRunner.cancel();               // spectra of the previous shape are stale
    live = computeLive(shapes[state.shape], LIVE_ROUNDS);
    P = live.points; R = live.rounds; maxRound = R.length - 1;
    summaries[state.shape] = R.map((rd) => rd.counts);
  }
  // data.js stores each regular-pentagon line as spans only. The live engine
  // reproduces the regular rounds exactly, so recompute them once and attach
  // the full point lists (mapped onto data.js point indices) for the Laplacian.
  (function attachRegularLines() {
    const v = D.points.slice(0, 5).map((p) => [p[0], p[1]]);
    const L = LE.compute(v, D.rounds.length - 1);
    const key = (x, y) => `${Math.round(x * 1e6)},${Math.round(y * 1e6)}`;
    const idx = new Map();
    D.points.forEach((p, i) => idx.set(key(p[0], p[1]), i));
    const find = (p) => {
      const kx = Math.round(p[0] * 1e6), ky = Math.round(p[1] * 1e6);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        const i = idx.get(`${kx + a},${ky + b}`);
        if (i !== undefined && Math.hypot(D.points[i][0] - p[0], D.points[i][1] - p[1]) < 1e-9) return i;
      }
      return -1;
    };
    const map = L.points.map(find);
    const ok = map.every((i) => i >= 0) && L.rounds.every((rd, k) => rd.counts.points === D.rounds[k].counts.points &&
      rd.counts.segments === D.rounds[k].counts.segments);
    if (!ok) { console.warn("regular rounds: live engine does not match data.js"); return; }
    L.rounds.forEach((rd, k) => {
      D.rounds[k].lines = rd.lines.map((ln) => {
        const pts = ln.pts.map((i) => map[i]), span = [pts[0], pts[pts.length - 1]];
        return { pts, gasket: ln.gasket.length ? [span] : [], ng: ln.ng.length ? [span] : [] };
      });
    });
  })();

  function useRegular() { P = D.points; R = D.rounds; maxRound = R.length - 1; live = null; }

  const fmt = (n) => n.toLocaleString("en-US");
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  // ------------------------------------------------------------ view ---
  function fit() {
    const w = wrap.clientWidth, h = wrap.clientHeight;
    // fit the outer pentagon (the first 5 points) with a margin
    const xs = P.slice(0, 5).map((p) => p[0]), ys = P.slice(0, 5).map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    state.scale = 0.86 * Math.min(w / (x1 - x0), h / (y1 - y0));
    state.ox = w / 2 - state.scale * (x0 + x1) / 2;
    state.oy = h / 2 + state.scale * (y0 + y1) / 2;
  }
  const sx = (x) => state.ox + x * state.scale;
  const sy = (y) => state.oy - y * state.scale;

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(wrap.clientWidth * dpr);
    cv.height = Math.round(wrap.clientHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  function zoomAt(px, py, f) {
    state.ox = px - (px - state.ox) * f;
    state.oy = py - (py - state.oy) * f;
    state.scale *= f;
    draw();
  }

  // ------------------------------------------------------------ draw ---
  function seg(a, b) {
    ctx.moveTo(sx(P[a][0]), sy(P[a][1]));
    ctx.lineTo(sx(P[b][0]), sy(P[b][1]));
  }

  function draw() {
    const rd = R[state.k];
    const w = wrap.clientWidth, h = wrap.clientHeight;
    ctx.clearRect(0, 0, w, h);
    const line = css("--line"), s1 = css("--s1"), s2 = css("--s2"), ink = css("--ink");
    const many = rd.lines.length > 40;
    ctx.lineCap = "round";

    // non-gasket coverage of every line
    ctx.strokeStyle = `rgba(${line}, ${many ? 0.5 : 0.75})`;
    ctx.lineWidth = many ? 0.8 : 1.2;
    ctx.beginPath();
    for (const L of rd.lines) for (const [a, b] of L.ng) seg(a, b);
    ctx.stroke();

    // pentagasket segments
    if (state.gasket) {
      ctx.strokeStyle = s2;
      ctx.lineWidth = many ? 1.6 : 2;
      ctx.beginPath();
      for (const L of rd.lines) for (const [a, b] of L.gasket) seg(a, b);
      ctx.stroke();
    }

    // points: older = ink, new this round = s1; without gasket, new points
    // that only exist because of gasket segments are drawn as rings
    const n = rd.counts.points;
    const ngSet = state.gasket ? null : new Set(rd.ng_points);
    const huge = n > 5000;                       // tens of thousands of points: square dots
    const r = huge ? 1.2 : n > 200 ? 2 : 3.5;
    const W = w, H = h;
    const dot = huge
      ? (i, rr) => { const X = sx(P[i][0]), Y = sy(P[i][1]); if (X > -2 && X < W + 2 && Y > -2 && Y < H + 2) ctx.rect(X - rr, Y - rr, 2 * rr, 2 * rr); }
      : (i, rr) => { ctx.moveTo(sx(P[i][0]) + rr, sy(P[i][1])); ctx.arc(sx(P[i][0]), sy(P[i][1]), rr, 0, 2 * Math.PI); };
    const vecView = shownVector();
    if (vecView) drawVector(vecView, n, r, dot, huge);
    else {
      ctx.fillStyle = ink;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        if (P[i][2] === state.k && state.k > 0) continue;
        dot(i, r);
      }
      ctx.fill();
      if (state.k > 0) {
        const rn = huge ? r : r + 0.5;
        ctx.fillStyle = s1;
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          if (P[i][2] !== state.k || (ngSet && !ngSet.has(i))) continue;
          dot(i, rn);
        }
        ctx.fill();
        if (ngSet && !huge) {
          ctx.strokeStyle = s1;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          for (let i = 0; i < n; i++) {
            if (P[i][2] !== state.k || ngSet.has(i)) continue;
            ctx.moveTo(sx(P[i][0]) + rn, sy(P[i][1]));
            ctx.arc(sx(P[i][0]), sy(P[i][1]), rn, 0, 2 * Math.PI);
          }
          ctx.stroke();
        }
      }
    }

    // outline of a nested pentagon hovered in the table
    if (state.layerHi >= 0) {
      const vs = [];
      for (let i = 0; i < P.length; i++) if (P[i][3] === state.layerHi) vs.push(P[i]);
      if (vs.length === 5) {
        const mx = vs.reduce((t, p) => t + p[0], 0) / 5, my = vs.reduce((t, p) => t + p[1], 0) / 5;
        vs.sort((p, q) => Math.atan2(p[1] - my, p[0] - mx) - Math.atan2(q[1] - my, q[0] - mx));
        ctx.strokeStyle = s2;
        ctx.lineWidth = 3;
        ctx.beginPath();
        vs.forEach((p, i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, sx(p[0]), sy(p[1])));
        ctx.closePath();
        ctx.stroke();
      }
    }

    if (isType()) drawLabels(ink, s1);

    // hovered point ring
    if (state.hover >= 0) {
      const p = P[state.hover];
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(sx(p[0]), sy(p[1]), r + 4, 0, 2 * Math.PI);
      ctx.stroke();
    }
  }

  // points coloured by an eigenvector: blue < 0 < orange, alpha by |value|
  function drawVector({ ids, v }, n, r, dot, huge) {
    ctx.fillStyle = css("--muted");
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    const inGraph = new Uint8Array(n);
    for (const i of ids) if (i < n) inGraph[i] = 1;
    for (let i = 0; i < n; i++) if (!inGraph[i]) dot(i, r * 0.7);
    ctx.fill();
    let m = 0;
    for (const x of v) m = Math.max(m, Math.abs(x));
    if (!m) m = 1;
    const B = 8, s1 = css("--s1"), s2 = css("--s2"), rr = huge ? r + 0.3 : r + 1;
    for (const [sign, color] of [[-1, s1], [1, s2]]) {
      ctx.fillStyle = color;
      for (let b = 0; b < B; b++) {
        ctx.globalAlpha = 0.15 + 0.85 * (b + 1) / B;
        ctx.beginPath();
        for (let j = 0; j < ids.length; j++) {
          const t = sign * v[j] / m;
          if (t <= 0 && !(sign > 0 && t === 0)) continue;
          if (Math.min(B - 1, Math.floor(Math.abs(t) * B)) === b) dot(ids[j], rr);
        }
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  // vertex labels A-E, side labels a-e and drag handles for a tiling type
  function drawLabels(ink, s1) {
    const v = vertsOf(shapes[state.shape]);
    const cx = v.reduce((t, p) => t + p[0], 0) / 5, cy = v.reduce((t, p) => t + p[1], 0) / 5;
    const draggable = typeInfo[state.shape].dof > 0;
    ctx.font = "600 13px system-ui, -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const out = (x, y, d) => {               // screen point d px outward from the centre
      const X = sx(x), Y = sy(y), ux = X - sx(cx), uy = Y - sy(cy), l = Math.hypot(ux, uy) || 1;
      return [X + ux / l * d, Y + uy / l * d];
    };
    v.forEach((p, i) => {
      if (draggable) {
        ctx.beginPath();
        ctx.arc(sx(p[0]), sy(p[1]), i === state.hoverVertex ? 8 : 6, 0, 2 * Math.PI);
        ctx.fillStyle = css("--surface");
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = s1;
        ctx.stroke();
      }
      const [X, Y] = out(p[0], p[1], 18);
      ctx.fillStyle = ink;
      ctx.fillText("ABCDE"[i], X, Y);
    });
    ctx.font = "italic 12px system-ui, -apple-system, sans-serif";
    ctx.fillStyle = css("--ink2");
    // side a = EA, b = AB, c = BC, d = CD, e = DE
    "abcde".split("").forEach((name, k) => {
      const p = v[(k + 4) % 5], q = v[k];
      const [X, Y] = out((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, 14);
      ctx.fillText(name, X, Y);
    });
  }

  // ------------------------------------------------------------ legend ---
  function legend() {
    const k = state.k;
    const items = [];
    if (state.vec !== "none") {
      const name = state.vec === "fiedler" ? "Fiedler vector" : state.vec === "max" ? "top eigenvector" : `eigenvector #${state.vecK}`;
      items.push(`<span><i class="sw-grad"></i>${name}: negative · 0 · positive</span>`);
    } else if (k > 0) {
      items.push(`<span><i class="sw-dot" style="background:var(--s1)"></i>New in round ${k}</span>`);
      if (!state.gasket) items.push(`<span><i class="sw-ring"></i>New only via gasket</span>`);
      items.push(`<span><i class="sw-dot" style="background:var(--ink)"></i>Earlier points</span>`);
    } else {
      items.push(`<span><i class="sw-dot" style="background:var(--ink)"></i>Vertices</span>`);
    }
    if (state.gasket) items.push(`<span><i class="sw-line" style="background:var(--s2)"></i>Pentagasket</span>`);
    items.push(`<span><i class="sw-line" style="background:rgba(${css("--line")},.75)"></i>Other segments</span>`);
    $("legend").innerHTML = items.join("");
  }

  // ------------------------------------------------------------ panel ---
  function countsTable() {
    $("countsBody").innerHTML = R.map((rd) => `
      <tr data-k="${rd.k}" class="${rd.k === state.k ? "current" : ""}">
        <td>${rd.k}</td><td>${fmt(rd.counts.points)}</td>
        <td>${rd.k ? fmt(rd.counts.new) : "–"}</td><td>${rd.k ? fmt(rd.counts.new_ng) : "–"}</td>
        <td>${fmt(rd.counts.segments)}</td><td>${fmt(rd.counts.gasket_segments)}</td>
      </tr>`).join("");
  }

  function tile(label, value, sub) {
    return `<div class="tile"><div class="lbl">${label}</div><div class="val">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ""}</div>`;
  }

  // live rounds compute their geometry and graph stats on first use
  const geomOf = (rd) => rd.geom || (rd.geom = LA.geometry(P, rd));
  function graphOf(rd, key) {
    rd.graph = rd.graph || {};
    return rd.graph[key] || (rd.graph[key] = LA.graph(P, rd, key === "without"));
  }

  function geometry() {
    const rd = R[state.k], g = geomOf(rd), c = rd.counts;
    $("geomTitle").textContent = `Geometry · round ${state.k}`;
    const last = isType()
      ? tile("Points where ≥ 3 lines meet", fmt(g.multi), `up to ${g.max_lines} lines through one point`)
      : tile("φ-power lengths", fmt(g.phi_power_segments),
             `side × φ^n, n ∈ {${g.phi_power_values.join(", ")}}`);
    $("geomTiles").innerHTML =
      tile("New intersections", state.k ? fmt(state.gasket ? c.new : c.new_ng) : "–",
           state.k ? (state.gasket ? `${fmt(c.new_ng)} without gasket` : `${fmt(c.new)} with gasket`) : "") +
      tile("Lines drawn", fmt(c.lines), g.n_dir_mult18 == null ? `${g.n_dir} directions`
           : `${g.n_dir} directions · ${g.n_dir_mult18} at multiples of 18°`) +
      tile("Smallest angle", `${g.min_angle.toPrecision(4)}°`, "between lines through one point") +
      tile("Closest two points", g.min_dist.toPrecision(3), isType()
           ? (g.near_pairs ? `${fmt(g.near_pairs)} pair${g.near_pairs > 1 ? "s" : ""} closer than 10⁻⁶` : "outer pentagon at its drawn size")
           : "circumradius = 1") +
      tile("Segment lengths", fmt(g.n_lengths), `distinct, over ${fmt(g.n_segments)} segments`) +
      last;
    histogram($("dirChart"), g.dir_hist, "lines", "°");
    histogram($("angChart"), g.angle_hist, "angles", "°");
  }

  const NS = "http://www.w3.org/2000/svg";
  function svgEl(tag, attrs) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  function histogram(host, h, unit, suffix) {
    host.innerHTML = "";
    const W = 360, H = 118, ml = 30, mr = 8, mt = 8, mb = 20;
    const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, role: "img" });
    const max = Math.max(1, ...h.counts);
    const n = h.counts.length, bw = (W - ml - mr) / n;
    const y = (v) => mt + (H - mt - mb) * (1 - v / max);
    // grid + y ticks
    for (const v of [0, Math.ceil(max / 2), max]) {
      svg.appendChild(svgEl("line", { x1: ml, x2: W - mr, y1: y(v), y2: y(v), stroke: "var(--grid)", "stroke-width": 1 }));
      const t = svgEl("text", { x: ml - 5, y: y(v) + 3.5, "text-anchor": "end", "font-size": 9.5, fill: "var(--muted)" });
      t.textContent = v;
      svg.appendChild(t);
    }
    for (let d = 0; d <= 180; d += 36) {
      const t = svgEl("text", { x: ml + (d / h.step) * bw, y: H - 6, "text-anchor": d === 180 ? "end" : "middle", "font-size": 9.5, fill: "var(--muted)" });
      t.textContent = d + suffix;
      svg.appendChild(t);
    }
    h.counts.forEach((v, i) => {
      const x = ml + i * bw;
      if (v > 0) {
        const top = y(v), bh = Math.max(1, y(0) - top);
        const rr = Math.min(2, bw / 2 - 0.5, bh);
        // bar with rounded data end, anchored to the baseline, 1px gap between bars
        const x0 = x + 0.5, x1 = x + bw - 0.5, yb = y(0);
        svg.appendChild(svgEl("path", {
          d: `M${x0},${yb} V${top + rr} Q${x0},${top} ${x0 + rr},${top} H${x1 - rr} Q${x1},${top} ${x1},${top + rr} V${yb} Z`,
          fill: "var(--s1)",
        }));
      }
      const hit = svgEl("rect", { x, y: mt, width: bw, height: H - mt - mb, fill: "transparent" });
      hit.addEventListener("mousemove", (ev) =>
        showTip(ev, `<b>${(i * h.step).toFixed(0)}–${((i + 1) * h.step).toFixed(0)}${suffix}</b><br>${fmt(v)} ${unit}`));
      hit.addEventListener("mouseleave", hideTip);
      svg.appendChild(hit);
    });
    svg.appendChild(svgEl("line", { x1: ml, x2: W - mr, y1: y(0), y2: y(0), stroke: "var(--axis)", "stroke-width": 1 }));
    host.appendChild(svg);
  }

  function spectrumChart(host, eigs) {
    host.innerHTML = "";
    const vals = [];
    for (const [v, m, form] of eigs) for (let i = 0; i < m; i++) vals.push([v, m, form]);
    const W = 360, H = 130, ml = 30, mr = 8, mt = 8, mb = 18;
    const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, role: "img" });
    const max = Math.max(1, ...vals.map((v) => v[0]));
    const x = (i) => ml + (W - ml - mr) * (vals.length > 1 ? i / (vals.length - 1) : 0.5);
    const y = (v) => mt + (H - mt - mb) * (1 - v / max);
    for (const v of [0, max / 2, max]) {
      svg.appendChild(svgEl("line", { x1: ml, x2: W - mr, y1: y(v), y2: y(v), stroke: "var(--grid)" }));
      const t = svgEl("text", { x: ml - 5, y: y(v) + 3.5, "text-anchor": "end", "font-size": 9.5, fill: "var(--muted)" });
      t.textContent = v.toFixed(v < 10 ? 1 : 0);
      svg.appendChild(t);
    }
    const t = svgEl("text", { x: (W + ml) / 2, y: H - 4, "text-anchor": "middle", "font-size": 9.5, fill: "var(--muted)" });
    t.textContent = "eigenvalue index (ascending)";
    svg.appendChild(t);
    const rDot = vals.length > 100 ? 2.2 : 4;
    vals.forEach(([v, m, form], i) => {
      const phi = form && form.includes("φ");
      const c = svgEl("circle", {
        cx: x(i), cy: y(v), r: phi ? rDot + 0.8 : rDot,
        fill: phi ? "var(--s2)" : "var(--s1)", stroke: "var(--surface)", "stroke-width": phi ? 1.5 : 0.6,
      });
      c.addEventListener("mousemove", (ev) => showTip(ev,
        `<b>λ = ${v.toFixed(8)}</b><br>multiplicity ${m}${form ? `<br>= ${form}` : "<br>not in Q(√5)"}`));
      c.addEventListener("mouseleave", hideTip);
      svg.appendChild(c);
    });
    host.appendChild(svg);
  }

  function graphPanel() {
    const key = state.gasket ? "with" : "without";
    const g = graphOf(R[state.k], key);
    $("graphTitle").textContent = `Arrangement graph · round ${state.k} · ${state.gasket ? "with" : "without"} pentagasket`;
    const body = $("graphBody");
    if (!g.E) {
      body.innerHTML = `<p class="empty">No segments remain in round ${state.k} once the pentagasket is removed. Every segment drawn so far lies along a side or diagonal of a nested pentagon.</p>`;
      return;
    }
    const euler = g.euler_ok
      ? `<span class="status ok">✓ Euler check holds: V − E + F = C</span>`
      : `<span class="status bad">✕ Euler check fails${isType() ? ": two crossings closer than the 10⁻¹¹ tolerance were probably merged, so treat this round's counts as approximate" : ""}</span>`;
    const maxF = Math.max(1, ...Object.values(g.faces));
    const faces = Object.entries(g.faces).map(([c, m]) =>
      `<tr><td>${c}-gon</td><td>${fmt(m)}</td><td style="width:55%"><span class="bar" style="width:${(100 * m / maxF).toFixed(1)}%"></span></td></tr>`).join("");
    const maxD = Math.max(...Object.values(g.degrees));
    const degs = Object.entries(g.degrees).map(([d, m]) =>
      `<tr><td>${d}</td><td>${fmt(m)}</td><td style="width:55%"><span class="bar" style="width:${(100 * m / maxD).toFixed(1)}%"></span></td></tr>`).join("");
    body.innerHTML = graphSummary(g, euler, faces, degs);
  }


  // ------------------------------------------------------------ spectrum ---
  // Spectral results for a round and graph ("with"/"without" gasket), cached on
  // the round. s.r is filled in asynchronously by the worker.
  function specOf(rd, key, runner, onReady) {
    rd.spec = rd.spec || {};
    let s = rd.spec[key];
    if (!s) {
      const csr = LA.laplacianCSR(rd, key === "without", LS.DENSE_MAX);
      s = rd.spec[key] = { csr, r: null, done: !csr.ids.length, promise: null };
      if (csr.ids.length) {
        s.promise = (runner || mainRunner).run(csr).then((r) => { s.r = summarizeSpec(s.csr, r); s.done = true; return s; });
      } else s.promise = Promise.resolve(s);
    }
    if (onReady && !s.done) s.promise.then(onReady);
    return s;
  }
  function summarizeSpec(csr, r) {
    const V = csr.ids.length;
    if (r.method === "dense") {
      const vals = r.vals, zeros = vals.filter((v) => v === 0).length;
      let mult = 0;
      for (const v of vals) if (Math.abs(v - vals[1]) < 1e-7) mult++;
      let logTau = null;
      if (zeros === 1) {
        logTau = -Math.log10(V);
        for (let i = 1; i < V; i++) logTau += Math.log10(vals[i]);
        if (Math.abs(logTau) < 1e-9) logTau = 0;       // a tree: exactly one spanning tree
      }
      else if (zeros > 1) logTau = -Infinity;          // disconnected: no spanning tree
      const trace = vals.reduce((t, v) => t + v, 0);
      return { method: "dense", V, vals, vecs: r.vecs, lambda2: V > 1 ? vals[1] : 0, mult2: mult, lambdaMax: vals[V - 1],
               zeros, logTau, trace, maxRes: r.maxRes, fiedler: V > 1 ? r.vecs[1] : null, vecMax: r.vecs[V - 1] };
    }
    return { method: "sparse", V, lambda2: r.low[0], lambda3: r.low[1], lambda4: r.low[2], lambdaMax: r.lambdaMax,
             fiedler: r.fiedler, vecMax: r.vecMax, res2: r.resLow[0], resMax: r.resMax, partial: csr.partial };
  }
  const isCurrent = (rd) => R.includes(rd);
  const refreshSpec = (rd) => () => { if (isCurrent(rd)) { specPanel(); if (state.vec !== "none") draw(); } };

  function fmtLog10(x) {
    if (x === null) return "–";
    if (x === -Infinity) return "0";
    if (x < 15) return fmt(Math.round(10 ** x));
    return `≈ ${(10 ** (x - Math.floor(x))).toFixed(2)} × 10^${Math.floor(x)}`;
  }

  function specPanel() {
    const key = state.gasket ? "with" : "without", rd = R[state.k];
    const s = specOf(rd, key, null, refreshSpec(rd));
    $("specTitle").textContent = `Laplacian matrix and eigenvalues · round ${state.k}`;
    const body = $("specBody"), c = s.csr, V = c.ids.length;
    const intro = `<p class="prose">The Laplacian of the arrangement graph is <b>L = D − A</b>. D is diagonal and holds each vertex’s degree, and A has a 1 wherever two vertices are joined by an edge, so every row of L sums to 0.
      Its eigenvalues 0 = λ₁ ≤ λ₂ ≤ … ≤ λ<sub>max</sub> describe how the graph is connected. They depend only on which points are joined, not on where the points are.</p>`;
    if (!V) { body.innerHTML = intro + `<p class="empty">This graph has no edges.</p>`; return; }
    const size = `<p class="note">Here L is ${fmt(V)} × ${fmt(V)}, with ${fmt(2 * c.E)} off-diagonal entries equal to −1 (two per edge) and every other off-diagonal entry 0${c.partial ? `. The graph has ${c.comps} pieces, so only the largest is used` : ""}.</p>`;
    if (!s.done) {
      body.innerHTML = intro + size + `<p class="empty">Computing the eigenvalues${V > LS.DENSE_MAX ? ` (Lanczos iteration on ${fmt(V)} vertices, a few seconds)` : ""}…</p>`;
      return;
    }
    const r = s.r;
    const bounds = `between Δ + 1 = ${c.maxDeg + 1} and max(d<sub>u</sub> + d<sub>v</sub>) = ${c.edgeBound}`;
    let tiles =
      tile("λ₂ · algebraic connectivity", r.lambda2 === 0 ? "0" : r.lambda2.toPrecision(6),
        r.method === "dense" ? (r.lambda2 === 0 ? "0 because the graph is in pieces" : `multiplicity ${r.mult2}`)
          : `Lanczos estimate, residual ${r.res2.toExponential(0)}`) +
      tile("λ<sub>max</sub> · largest eigenvalue", r.lambdaMax.toPrecision(6), bounds);
    if (r.method === "dense") {
      tiles +=
        tile("Zero eigenvalues", r.zeros, `${r.zeros === c.comps ? "✓" : "✕"} equals the number of pieces (${c.comps})`) +
        tile("Spanning trees", fmtLog10(r.logTau), "matrix-tree theorem: λ₂ ⋯ λ<sub>V</sub> / V") +
        tile("Sum of eigenvalues", r.trace.toFixed(6), `${Math.abs(r.trace - 2 * c.E) < 1e-6 ? "✓" : "✕"} equals 2E = ${fmt(2 * c.E)} (the trace of L)`) +
        tile("Accuracy", r.maxRes.toExponential(1), "largest |Lv − λv| over all eigenvectors");
    } else {
      tiles +=
        tile("λ₃, λ₄", `${r.lambda3.toPrecision(4)}, ${r.lambda4.toPrecision(4)}`, "next smallest eigenvalues") +
        tile("Accuracy of λ<sub>max</sub>", r.resMax.toExponential(1), "|Lv − λv| for its eigenvector");
    }
    const meaning = `<p class="prose" style="margin-top:10px"><b>λ₂</b> (algebraic connectivity) is 0 exactly when the graph falls into pieces. When it is small, the graph is held together through a bottleneck that a few edge cuts would split.
      <b>λ<sub>max</sub></b> is set by the busiest vertices: it is at least the largest degree Δ plus 1, and at most the largest d<sub>u</sub> + d<sub>v</sub> over an edge.
      Its eigenvector is the most oscillating one, with neighbouring vertices tending to have opposite signs. As the rounds go on, the matrix grows and the busiest vertices gain neighbours, so λ<sub>max</sub> rises.
      λ₂ rises from round 0 to round 1, when the pentagram adds cross-links, and then falls sharply: the graph gets much bigger, and its paths get longer when counted in edges. The table below shows the trend for this shape.</p>`;

    // full spectrum (dense only) + the a + bφ test from LA.graph
    let full = "";
    if (r.method === "dense") {
      const g = graphOf(rd, key);
      const phiEigs = g.eigs.filter((e) => e[2] && e[2].includes("φ"));
      const phiList = phiEigs.length
        ? `<ul class="eig-list">${phiEigs.map(([v, m, f]) => `<li>${v.toFixed(6)} = ${f}${m > 1 ? ` (×${m})` : ""}</li>`).join("")}</ul>`
        : `<p class="empty">None. No eigenvalue lies in Q(√5) apart from ${g.int_count === 1 ? "0" : "integers"}.</p>`;
      full = `<h3>All ${fmt(V)} eigenvalues</h3><div class="chart" id="specChart"></div>
        <h3>Eigenvalues of the form a + bφ (b ≠ 0): ${g.zphi_count} of ${g.n_eigs}</h3>${phiList}
        <p class="note">Found by pairing each eigenvalue with its Galois conjugate a + bφ′. This test is complete, so any eigenvalue in Q(√5) would show up here.</p>`;
    } else {
      full = `<p class="note">With ${fmt(V)} vertices the full spectrum is too large to compute here. λ<sub>max</sub> comes from Lanczos iteration, and λ₂–λ₄ and the Fiedler vector from Lanczos applied to the inverse of L, using conjugate-gradient solves. The residuals show how accurate they are.</p>`;
    }

    // across rounds
    const rows = R.map((rr) => {
      const t = specOf(rr, key, null, refreshSpec(rd));
      const cur = rr.k === state.k ? "current" : "";
      if (!t.csr.ids.length) return `<tr class="${cur}" data-k="${rr.k}"><td>${rr.k}</td><td>0</td><td>–</td><td>–</td><td>–</td></tr>`;
      const v = t.done ? t.r : null;
      return `<tr class="${cur}" data-k="${rr.k}"><td>${rr.k}</td><td>${fmt(t.csr.ids.length)}</td><td>${t.csr.maxDeg}</td>` +
        `<td>${v ? (v.lambda2 === 0 ? "0" : v.lambda2.toPrecision(5)) : "…"}</td><td>${v ? v.lambdaMax.toPrecision(5) : "…"}</td></tr>`;
    }).join("");
    const across = `<h3>Across the rounds (${state.gasket ? "with" : "without"} pentagasket)</h3>
      <table class="mini" id="specRounds"><thead><tr><th>Round</th><th>Vertices</th><th>Max degree Δ</th><th>λ₂</th><th>λ<sub>max</sub></th></tr></thead><tbody>${rows}</tbody></table>`;

    // eigenvector view
    const opts = [["none", "Off"], ["fiedler", "Fiedler vector (λ₂)"], ["max", "Top eigenvector (λmax)"]]
      .concat(r.method === "dense" ? [["k", "Eigenvector number…"]] : []);
    if (state.vec === "k" && r.method !== "dense") state.vec = "fiedler";
    const k = Math.min(Math.max(1, state.vecK), V);
    const vecInfo = state.vec === "k" ? ` λ<sub>${k}</sub> = ${r.vals[k - 1].toPrecision(6)}` : "";
    const vec = `<h3>Eigenvectors on the drawing</h3>
      <div class="vecpick"><select id="vecSel" aria-label="Colour points by eigenvector">${opts.map(([v, l]) =>
        `<option value="${v}" ${state.vec === v ? "selected" : ""}>${l}</option>`).join("")}</select>
        ${state.vec === "k" ? `<input type="range" id="vecK" min="1" max="${V}" value="${k}" aria-label="Eigenvector number"><span>#${k}${vecInfo}</span>` : ""}</div>
      <p class="note">An eigenvector gives every vertex a number. Points are coloured blue where it is negative and orange where it is positive, more strongly for larger values.
        The Fiedler vector changes slowly across the graph, and its sign splits the graph into two well-connected halves (spectral partitioning).
        Eigenvectors with small λ vary smoothly, and ones with large λ flip sign from vertex to vertex.</p>`;

    body.innerHTML = intro + size + `<div class="tiles">${tiles}</div>` + meaning + vec + across + full;
    if (r.method === "dense") spectrumChart($("specChart"), graphOf(rd, key).eigs);
    $("vecSel").addEventListener("change", (e) => { state.vec = e.target.value; specPanel(); legend(); draw(); });
    if ($("vecK")) $("vecK").addEventListener("input", (e) => { state.vecK = +e.target.value; specPanel(); draw(); });
    $("specRounds").addEventListener("click", (e) => { const tr = e.target.closest("tr[data-k]"); if (tr) setRound(+tr.dataset.k); });
  }

  // the vector being shown, as {ids, v} or null
  function shownVector() {
    if (state.vec === "none") return null;
    const s = R[state.k].spec && R[state.k].spec[state.gasket ? "with" : "without"];
    if (!s || !s.done || !s.r) return null;
    const r = s.r;
    const v = state.vec === "fiedler" ? r.fiedler : state.vec === "max" ? r.vecMax
      : r.vecs ? r.vecs[Math.min(Math.max(1, state.vecK), r.V) - 1] : null;
    return v ? { ids: s.csr.ids, v } : null;
  }

  // Round 0 is the pentagon's outline: the 5-cycle C5, the same graph for any pentagon.
  function cyclePanel() {
    const ex = [0, 1, 2, 3, 4].map((k) => 2 - 2 * Math.cos(2 * Math.PI * k / 5));
    const exact = ["0", "3 − φ", "2 + φ", "2 + φ", "3 − φ"];
    const s0 = specOf(R[0], "with", null, () => { if (isCurrent(R[0])) cyclePanel(); });
    const got = s0.done && s0.r ? s0.r.vals : null;
    const s1 = specOf(R[1], "with", null, () => { if (isCurrent(R[1])) cyclePanel(); });
    const v1 = s1.done && s1.r ? s1.r.vals : null;
    $("cycleBody").innerHTML = `
      <p class="prose">In round 0 the graph is just the pentagon’s outline: 5 vertices, each joined to its 2 neighbours, which is the cycle C<sub>5</sub>.
        Its Laplacian eigenvalues have a closed form:</p>
      <p class="formula">λ<sub>k</sub> = 2 − 2 cos(2πk / 5),&nbsp;&nbsp; k = 0, 1, 2, 3, 4</p>
      <table class="mini"><thead><tr><th>k</th><th>2 − 2cos(2πk/5)</th><th>Exact</th><th>Computed, round 0</th></tr></thead><tbody>
      ${ex.map((v, k) => `<tr><td>${k}</td><td>${v.toFixed(9)}</td><td>${exact[k]}</td><td>${got ? `${got.slice().sort((a, b) => a - b)[[0, 1, 3, 4, 2][k]].toFixed(9)}` : "…"}</td></tr>`).join("")}
      </tbody></table>
      <p class="prose" style="margin-top:8px">So 3 − φ ≈ 1.382 and 2 + φ ≈ 3.618 each appear twice (k and 5 − k give the same value).
        The eigenvectors are the waves cos(2πkj/5) and sin(2πkj/5) around the cycle. The pentagram (the 5 diagonals on their own) is also a 5-cycle, so it has exactly the same eigenvalues.
        All of this holds for every pentagon, regular or not, because the Laplacian only sees which vertices are joined.</p>
      <p class="prose">Round 1 is also the same graph for every convex pentagon: the outline plus the pentagram, with each diagonal cut into 3 edges (10 vertices, 20 edges).
        Its eigenvalues are ${v1 ? v1.map((v) => v.toFixed(4)).join(", ") : "…"}. The shapes first differ in round 2, where the regular pentagon has 26 points and a generic one has 45.</p>`;
  }

  function graphSummary(g, euler, faces, degs) {
    return `
      <div class="tiles">
        ${tile("Vertices · edges", `${fmt(g.V)} · ${fmt(g.E)}`, `${g.C} component${g.C > 1 ? "s" : ""}`)}
        ${tile("Bounded faces", fmt(g.F), g.nonsimple ? `${g.nonsimple} non-simple` : "")}
      </div>
      <p style="margin:8px 0 0">${euler}</p>
      <h3>Faces by number of corners</h3>
      ${faces ? `<table class="mini"><tbody>${faces}</tbody></table>` : `<p class="empty">No bounded faces: the graph has no cycles${g.C === 1 ? " (it is a tree)" : ""}.</p>`}
      <h3>Degree distribution</h3>
      <table class="mini"><thead><tr><th>Degree</th><th>Vertices</th><th></th></tr></thead><tbody>${degs}</tbody></table>`;
  }

  // ------------------------------------------------------------ growth ---
  // Points and segments per round on a log scale, actual counts joined by lines.
  function growthChart(host) {
    host.innerHTML = "";
    const W = 360, H = 190, ml = 40, mr = 14, mt = 12, mb = 22;
    const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, role: "img" });
    const ks = R.map((r) => r.k).concat(R4 ? [R.length] : []);
    const maxV = R4 ? R4.points_before + R4.new_points_high : R[R.length - 1].counts.points;
    const top = Math.ceil(Math.log10(maxV));
    const x = (k) => ml + (W - ml - mr) * (k / (ks.length - 1));
    const y = (v) => mt + (H - mt - mb) * (1 - Math.log10(Math.max(v, 1)) / top);
    for (let e = 0; e <= top; e += top > 6 ? 2 : 1) {
      svg.appendChild(svgEl("line", { x1: ml, x2: W - mr, y1: y(10 ** e), y2: y(10 ** e), stroke: "var(--grid)" }));
      const t = svgEl("text", { x: ml - 5, y: y(10 ** e) + 3.5, "text-anchor": "end", "font-size": 9.5, fill: "var(--muted)" });
      t.textContent = e < 4 ? String(10 ** e) : `10^${e}`;
      svg.appendChild(t);
    }
    ks.forEach((k) => {
      const t = svgEl("text", { x: x(k), y: H - 6, "text-anchor": "middle", "font-size": 9.5, fill: "var(--muted)" });
      t.textContent = `R${k}`;
      svg.appendChild(t);
    });
    const k4 = R.length, last = R.length - 1;
    const est = R4 ? R4.points_before + R4.new_points_est : 0;
    // the actual counts, joined by straight lines
    for (const [key, color] of [["points", "var(--s1)"], ["segments", "var(--s2)"]]) {
      const pts = R.map((r, k) => `${x(k)},${y(r.counts[key])}`).join(" ");
      svg.appendChild(svgEl("polyline", { points: pts, fill: "none", stroke: color, "stroke-width": 2, "stroke-linejoin": "round" }));
    }
    if (R4) {
      svg.appendChild(svgEl("line", { x1: x(last), y1: y(R[last].counts.points), x2: x(k4), y2: y(est),
        stroke: "var(--s1)", "stroke-width": 2, "stroke-dasharray": "4 3" }));
      svg.appendChild(svgEl("line", { x1: x(last), y1: y(R[last].counts.segments), x2: x(k4), y2: y(R4.segments),
        stroke: "var(--s2)", "stroke-width": 2 }));
    }
    if (R4) {
      const lo = R4.points_before + R4.new_points_low, hi = R4.points_before + R4.new_points_high;
      svg.appendChild(svgEl("line", { x1: x(k4), x2: x(k4), y1: y(lo), y2: y(hi), stroke: "var(--s1)", "stroke-width": 1.5 }));
      for (const yy of [lo, hi]) svg.appendChild(svgEl("line", { x1: x(k4) - 4, x2: x(k4) + 4, y1: y(yy), y2: y(yy), stroke: "var(--s1)", "stroke-width": 1.5 }));
    }
    const marker = (cx, cy, color, hollow, html) => {
      svg.appendChild(svgEl("circle", { cx, cy, r: 4.5, fill: hollow ? "var(--surface)" : color, stroke: hollow ? color : "var(--surface)", "stroke-width": hollow ? 2 : 1.5 }));
      const hit = svgEl("circle", { cx, cy, r: 11, fill: "transparent" });
      hit.addEventListener("mousemove", (ev) => showTip(ev, html));
      hit.addEventListener("mouseleave", hideTip);
      svg.appendChild(hit);
    };
    R.forEach((r, k) => {
      marker(x(k), y(r.counts.points), "var(--s1)", false, `<b>Round ${k}</b><br>${fmt(r.counts.points)} points`);
      marker(x(k), y(r.counts.segments), "var(--s2)", false, `<b>Round ${k}</b><br>${fmt(r.counts.segments)} segments`);
    });
    if (R4) {
      marker(x(k4), y(est), "var(--s1)", true,
        `<b>Round 4 (estimate)</b><br>≈ ${(est / 1e9).toFixed(2)} billion points<br>range ${(R4.new_points_low / 1e9).toFixed(1)}–${(R4.new_points_high / 1e9).toFixed(1)} billion new`);
      marker(x(k4), y(R4.segments), "var(--s2)", false, `<b>Round 4 (exact)</b><br>${fmt(R4.segments)} segments`);
    }
    host.appendChild(svg);
  }

  // Best-fit curves N(k) = exp(a + b·c^k) out to FIT_MAX_ROUND. The counts
  // explode (≈10^2000 by round 8), so the y axis is the number of digits of N
  // (log10 N) on a log scale: gridlines at 10, 10^10, 10^100, 10^1000.
  const FIT_MAX_ROUND = 8;
  function fitChart(host) {
    host.innerHTML = "";
    if (!FIT) return;
    const W = 360, H = 210, ml = 44, mr = 14, mt = 12, mb = 22;
    const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, role: "img" });
    const lastData = R4 ? R.length : R.length - 1;
    const lnN = (f, k) => f.a + f.b * f.c ** k;                 // natural log of the fitted count
    const digits = (ln) => ln / Math.LN10;                      // log10 N
    const lo = Math.log10(digits(Math.log(4))), hiDigits = digits(lnN(FIT.points, FIT_MAX_ROUND));
    const hi = Math.log10(hiDigits) + 0.15;
    const x = (k) => ml + (W - ml - mr) * (k / FIT_MAX_ROUND);
    const y = (ln) => mt + (H - mt - mb) * (1 - (Math.log10(digits(ln)) - lo) / (hi - lo));
    // shaded band for the extrapolated rounds
    svg.appendChild(svgEl("rect", { x: x(lastData), y: mt, width: x(FIT_MAX_ROUND) - x(lastData), height: H - mt - mb,
      fill: "var(--grid)", opacity: 0.35 }));
    const lab = svgEl("text", { x: (x(lastData) + x(FIT_MAX_ROUND)) / 2, y: mt + 11, "text-anchor": "middle", "font-size": 9.5, fill: "var(--muted)" });
    lab.textContent = "predicted (no data)";
    svg.appendChild(lab);
    for (const e of [1, 3, 10, 30, 100, 300, 1000, 3000]) {
      if (Math.log10(e) < lo || Math.log10(e) > hi) continue;
      const yy = y(e * Math.LN10);
      svg.appendChild(svgEl("line", { x1: ml, x2: W - mr, y1: yy, y2: yy, stroke: "var(--grid)" }));
      const t = svgEl("text", { x: ml - 5, y: yy + 3.5, "text-anchor": "end", "font-size": 9.5, fill: "var(--muted)" });
      t.textContent = e === 1 ? "10" : `10^${e}`;
      svg.appendChild(t);
    }
    for (let k = 0; k <= FIT_MAX_ROUND; k++) {
      const t = svgEl("text", { x: x(k), y: H - 6, "text-anchor": "middle", "font-size": 9.5, fill: "var(--muted)" });
      t.textContent = `R${k}`;
      svg.appendChild(t);
    }
    const series = [["points", "var(--s1)"], ["segments", "var(--s2)"]];
    for (const [name, color] of series) {
      const f = FIT[name];
      const path = (k0, k1) => { const p = []; for (let k = k0; k <= k1 + 1e-9; k += 0.05) p.push(`${x(k)},${y(lnN(f, k))}`); return p.join(" "); };
      svg.appendChild(svgEl("polyline", { points: path(0, lastData), fill: "none", stroke: color, "stroke-width": 1.8 }));
      svg.appendChild(svgEl("polyline", { points: path(lastData, FIT_MAX_ROUND), fill: "none", stroke: color, "stroke-width": 1.8, "stroke-dasharray": "4 3" }));
    }
    const dot = (k, ln, color, hollow, html) => {
      svg.appendChild(svgEl("circle", { cx: x(k), cy: y(ln), r: hollow ? 3.5 : 4.5, fill: hollow ? "var(--surface)" : color,
        stroke: hollow ? color : "var(--surface)", "stroke-width": hollow ? 1.8 : 1.5 }));
      const hit = svgEl("circle", { cx: x(k), cy: y(ln), r: 10, fill: "transparent" });
      hit.addEventListener("mousemove", (ev) => showTip(ev, html));
      hit.addEventListener("mouseleave", hideTip);
      svg.appendChild(hit);
    };
    const big = (ln) => {
      const d = digits(ln);
      if (d < 15) return fmt(Math.round(Math.exp(ln)));
      const m = 10 ** (d - Math.floor(d));
      return `≈ ${m.toFixed(2)} × 10^${fmt(Math.floor(d))} (${fmt(Math.floor(d) + 1)} digits)`;
    };
    // actual counts (filled) and predictions for later rounds (hollow)
    R.forEach((r, k) => {
      dot(k, Math.log(r.counts.points), "var(--s1)", false, `<b>Round ${k}: ${fmt(r.counts.points)} points</b><br>fit: ${big(lnN(FIT.points, k))}`);
      dot(k, Math.log(r.counts.segments), "var(--s2)", false, `<b>Round ${k}: ${fmt(r.counts.segments)} segments</b><br>fit: ${big(lnN(FIT.segments, k))}`);
    });
    if (R4) {
      const k4 = R.length, est = R4.points_before + R4.new_points_est;
      dot(k4, Math.log(est), "var(--s1)", true, `<b>Round 4: ≈ ${(est / 1e9).toFixed(2)} billion points (estimate)</b><br>fit: ${big(lnN(FIT.points, k4))}`);
      dot(k4, Math.log(R4.segments), "var(--s2)", false, `<b>Round 4: ${fmt(R4.segments)} segments</b><br>fit: ${big(lnN(FIT.segments, k4))}`);
    }
    for (let k = lastData + 1; k <= FIT_MAX_ROUND; k++) {
      for (const [name, color] of series) {
        const ln = lnN(FIT[name], k);
        dot(k, ln, color, true, `<b>Round ${k} (predicted)</b><br>${name}: ${big(ln)}`);
      }
    }
    host.appendChild(svg);
  }

  function growthText() {
    if (R4) $("growthNote").textContent =
      `Round 4: ${fmt(R4.segments)} segments, counted exactly. The point count is an estimate: ` +
      `${fmt(R4.samples)} random pairs of segments were sampled, ${(100 * R4.crossing_fraction).toFixed(1)}% cross at a new spot, ` +
      `and several segments can cross at one point, giving about ${(R4.new_points_low / 1e9).toFixed(1)}–${(R4.new_points_high / 1e9).toFixed(1)} billion new points.`;
    if (!FIT) return;
    const eq = (f) => `N(k) = e<sup>${f.a.toFixed(3)} + ${f.b.toFixed(4)}·${f.c.toFixed(3)}<sup>k</sup></sup>`;
    $("fitEqs").innerHTML =
      `<div><i class="sw-line" style="background:var(--s1)"></i><b>Points:</b> ${eq(FIT.points)}</div>` +
      `<div><i class="sw-line" style="background:var(--s2)"></i><b>Segments:</b> ${eq(FIT.segments)}</div>`;
    $("fitNote").innerHTML =
      `N is the count and k is the round number (0, 1, 2, …). The curves are fitted by least squares on ln N and are typically within ` +
      `×${Math.exp(FIT.points.rms_log).toFixed(2)} (points) and ×${Math.exp(FIT.segments.rms_log).toFixed(2)} (segments) of the real counts. ` +
      `A plain exponential a·bᵏ is off by ×${Math.exp(FIT.points.exp_rms_log).toFixed(0)} on points. ` +
      `The points curve includes the round-4 estimate, because four rounds alone can’t pin it down. ` +
      `c ≈ ${FIT.points.c.toFixed(2)} is close to 4, which fits each round’s points growing like the previous round’s to the 4th power.`;
  }

  // ------------------------------------------------------------ layers ---
  function layerTable() {
    const body = $("layerTable").querySelector("tbody");
    body.innerHTML = G.layers.map((L) => `
      <tr data-layer="${L.layer}" class="${L.born <= state.k ? "" : "future"}">
        <td>P${L.layer}</td><td>round ${L.born}</td>
        <td>${L.side.toFixed(6)}</td><td>${L.diagonal.toFixed(6)}</td>
        <td>${L.ratio_prev ? `${L.ratio_prev.toFixed(6)} = φ²` : "–"}</td>
      </tr>`).join("");
  }

  // ------------------------------------------------------------ golden ---
  function goldenPanel() {
    $("goldenChecks").innerHTML = G.checks.map((c) => `
      <li><span class="${c.holds ? "ok" : "bad"}">${c.holds ? "✓" : "✕"}</span>
        <span class="claim">${c.claim}</span><br>
        <span class="val">${c.exact} ≈ ${Math.abs(c.value) < 1 ? c.value.toFixed(9) : c.value.toFixed(9)}</span>
        <br><span class="claim" style="color:var(--muted)">${c.detail}</span></li>`).join("");
    const m = G.map;
    $("mapText").innerHTML =
      `Each nested pentagon is the previous one shrunk and flipped through the centre: every vertex <i>v</i> goes to ` +
      `<b>−<i>v</i>/φ²</b>. As a map of the plane this is the matrix ${m.matrix.replace(" (exact, in any coordinates)", "")}, ` +
      `so its eigenvalue is <b>${m.eigenvalue_exact} ≈ ${m.eigenvalue.toFixed(6)}</b>. ` +
      `Repeating it n times multiplies by (−1/φ²)ⁿ, so sizes shrink by φ², φ⁴, φ⁶, … ` +
      `This is the “mapping ratio becomes higher powers of φ” from your notes. It belongs to this geometric map, ` +
      `not to the Laplacian of the drawing (see the spectrum below).`;
    $("mapTable").querySelector("tbody").innerHTML = m.powers.map((p) =>
      `<tr><td>${p.n}</td><td>${p.value.toFixed(9)}</td><td>${p.exact}</td></tr>`).join("");
  }

  // ------------------------------------------------------------ tooltip ---
  function showTip(ev, html) {
    tip.innerHTML = html;
    tip.style.display = "block";
    const pad = 14, tw = tip.offsetWidth, th = tip.offsetHeight;
    let x = ev.clientX + pad, y = ev.clientY + pad;
    if (x + tw > window.innerWidth - 4) x = ev.clientX - tw - pad;
    if (y + th > window.innerHeight - 4) y = ev.clientY - th - pad;
    tip.style.left = x + "px";
    tip.style.top = y + "px";
  }
  function hideTip() { tip.style.display = "none"; }

  function pointTip(ev) {
    const rect = cv.getBoundingClientRect();
    const mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
    const n = R[state.k].counts.points;
    let best = -1, bd = 10 * 10;
    for (let i = 0; i < n; i++) {
      const dx = sx(P[i][0]) - mx, dy = sy(P[i][1]) - my, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = i; }
    }
    if (best !== state.hover) { state.hover = best; draw(); }
    if (best < 0) return hideTip();
    const p = P[best];
    const layer = p[3] >= 0 ? `<br>Pentagasket layer P${p[3]}` : "";
    let via = "";
    if (p[2] === state.k && state.k > 0)
      via = R[state.k].ng_points.includes(best) ? "<br>Also made without the gasket" : "<br>Made only by gasket segments";
    let vv = "";
    const view = shownVector();
    if (view) { const j = view.ids.indexOf(best); if (j >= 0) vv = `<br>Eigenvector value ${view.v[j].toExponential(3)}`; }
    showTip(ev, `<b>Point #${best}</b><br>Born in round ${p[2]}${layer}${via}<br>(${p[0].toFixed(6)}, ${p[1].toFixed(6)})${vv}`);
  }

  // ------------------------------------------------------------ type panel ---
  const PHI4 = ((1 + Math.sqrt(5)) / 2) ** 4;
  function polyArea(v) {
    let a = 0;
    for (let i = 0; i < v.length; i++) a += v[i][0] * v[(i + 1) % v.length][1] - v[(i + 1) % v.length][0] * v[i][1];
    return Math.abs(a) / 2;
  }

  function typePanel() {
    if (!isType()) return;
    const T = curType(), x = shapes[T.n], m = TT.measure(x), info = typeInfo[T.n];
    $("typeTitle").textContent = `Type ${T.n} · ${T.by}`;
    $("typeConds").innerHTML = T.shown.join("<br>");
    const res = TT.residual(T, x);
    $("typeChecks").innerHTML = T.eq.map(([label], i) => {
      const err = Math.abs(res[i]), ok = err < 1e-9;
      return `<li><span class="${ok ? "ok" : "bad"}">${ok ? "✓" : "✕"}</span><span>${label}</span>` +
             `<span class="err">residual ${err === 0 ? "0" : err.toExponential(0)}</span></li>`;
    }).join("") + (T.derived || []).map(([label, f]) =>
      `<li><span class="derived">⇒</span><span>${label}</span><span class="err">now ${f(m.ang).toFixed(4)}°</span></li>`).join("");
    $("typeTiles").innerHTML =
      tile("Free parameters", info.dof, info.dof > 0
        ? `drag any vertex to explore the ${info.dof === 1 ? "1-parameter family" : `${info.dof}-parameter family`}`
        : "rigid: only one shape, so its vertices can’t be dragged") +
      tile("Conditions", T.eq.length, `${info.rank} independent, on 6 shape parameters`);
    const shortest = Math.min(...Object.values(m.s));
    $("typeTable").querySelector("tbody").innerHTML = "ABCDE".split("").map((V, i) => {
      const side = "abcde"[i];
      return `<tr><td>${V}</td><td>${m.ang[V].toFixed(4)}°</td><td>${side}</td><td>${(m.s[side] / shortest).toFixed(4)}</td></tr>`;
    }).join("");
    const layers = live.layers.slice(0, LIVE_ROUNDS + 2), a0 = polyArea(layers[0]);
    $("typeLayers").querySelector("tbody").innerHTML = layers.map((L, j) => {
      const a = polyArea(L), prev = j ? polyArea(layers[j - 1]) / a : null;
      return `<tr data-layer="${j}" class="${j <= state.k ? "" : "future"}"><td>P${j}</td><td>${j}</td>` +
             `<td>${(a / a0).toPrecision(5)}</td><td>${prev ? `×${prev.toFixed(4)}` : "–"}</td></tr>`;
    }).join("");
    $("typeLayersNote").textContent =
      `Areas relative to P0. For the regular pentagon every step is ×φ⁴ ≈ ${PHI4.toFixed(4)}. Area ratios don’t change under ` +
      `affine maps, so a different ratio means this pentagon is not an affine image of the regular one. Hover a row to outline that layer.`;
    $("liveNote").textContent =
      `Type ${T.n} is computed in the browser in floating point, so it updates while you drag. Crossings closer than 10⁻¹¹ ` +
      `count as one point (true concurrences agree to about 10⁻¹³), and a point within 10⁻¹¹ of a line counts as on it. ` +
      `The same code reproduces the exact regular-pentagon counts. Genuinely distinct crossings can come within about 10⁻⁹ ` +
      `of each other in round 3; if a shape ever brings two below 10⁻¹¹, they merge and the Euler check below flags it.`;
  }

  // ------------------------------------------------------- all-types table ---
  function thumb(v) {
    const xs = v.map((p) => p[0]), ys = v.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const k = Math.min(26 / (x1 - x0), 22 / (y1 - y0));
    const pts = v.map((p) => `${(15 + (p[0] - (x0 + x1) / 2) * k).toFixed(1)},${(13 - (p[1] - (y0 + y1) / 2) * k).toFixed(1)}`).join(" ");
    return `<svg viewBox="0 0 30 26" aria-hidden="true"><polygon points="${pts}" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>`;
  }
  function typesTable() {
    const rows = [[0, "Regular", D.points.slice(0, 5), 0, D.rounds.map((r) => r.counts)]]
      .concat(TT.TYPES.map((T) => [T.n, `Type ${T.n}`, vertsOf(shapes[T.n]), typeInfo[T.n].dof, summaries[T.n]]));
    $("typesTable").querySelector("tbody").innerHTML = rows.map(([n, name, v, dof, c]) => {
      const cell = (fn) => (c ? fmt(fn(c)) : `<span class="pending">…</span>`);
      return `<tr data-shape="${n}" class="${n === state.shape ? "current" : ""}"><td class="thumb">${thumb(v)}</td><td>${name}</td><td>${dof}</td>` +
        `<td>${cell((c) => c[3].points)}</td><td>${cell((c) => c[3].segments)}</td><td>${cell((c) => c[3].new_ng)}</td></tr>`;
    }).join("");
  }
  // fill in the other types' rows in the background, one per tick
  function fillSummaries() {
    const T = TT.TYPES.find((t) => !summaries[t.n]);
    if (!T) return;
    summaries[T.n] = computeLive(shapes[T.n], LIVE_ROUNDS).rounds.map((rd) => rd.counts);
    typesTable();
    setTimeout(fillSummaries, 0);
  }

  // ---------------------------------------------------------------- csv ---
  function download(name, text) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  const shapeSlug = () => (isType() ? `type${state.shape}` : "regular");
  const toCSV = (rows) => rows.map((r) => r.map((v) => {
    const t = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  }).join(",")).join("\n") + "\n";
  const num = (v, d) => (v === null || v === undefined || !isFinite(v) ? "" : +v.toPrecision(d || 12));
  const gkey = () => (state.gasket ? "with" : "without");

  function csvSummary() {
    const v = vertsOf(isType() ? shapes[state.shape] : D.points.slice(0, 5).flatMap((p) => [p[0], p[1]]));
    const m = TT.measure(v.flat());
    const head = ["shape", "round", "points", "new_points", "new_points_without_gasket", "segments", "gasket_segments",
      "directions", "free_parameters", "lambda2_with_gasket", "lambda_max_with_gasket", "lambda2_without_gasket", "lambda_max_without_gasket"]
      .concat("ABCDE".split("").flatMap((V) => [`x${V}`, `y${V}`]),
        "ABCDE".split("").map((V) => `angle_${V}_deg`), "abcde".split("").map((e) => `side_${e}`));
    const spec = (rd, key) => { const t = rd.spec && rd.spec[key]; return t && t.done && t.r ? t.r : null; };
    const rows = R.map((rd) => {
      const c = rd.counts, sw = spec(rd, "with"), so = spec(rd, "without");
      return [isType() ? `type ${state.shape}` : "regular", rd.k, c.points, rd.k ? c.new : "", rd.k ? c.new_ng : "",
        c.segments, c.gasket_segments, c.directions, isType() ? typeInfo[state.shape].dof : 0,
        num(sw && sw.lambda2), num(sw && sw.lambdaMax), num(so && so.lambda2), num(so && so.lambdaMax)]
        .concat(v.flatMap((p) => [num(p[0]), num(p[1])]),
          "ABCDE".split("").map((V) => num(m.ang[V])), "abcde".split("").map((e) => num(m.s[e])));
    });
    download(`${shapeSlug()}_summary.csv`, toCSV([head].concat(rows)));
  }

  function csvPoints() {
    const rd = R[state.k], ng = new Set(rd.ng_points), n = rd.counts.points;
    const rows = [["index", "x", "y", "birth_round", "gasket_layer", "new_this_round_without_gasket"]];
    for (let i = 0; i < n; i++) {
      const p = P[i];
      rows.push([i, num(p[0]), num(p[1]), p[2], p[3], p[2] === state.k && state.k > 0 ? (ng.has(i) ? 1 : 0) : ""]);
    }
    download(`${shapeSlug()}_round${state.k}_points.csv`, toCSV(rows));
  }

  // the current round's spectrum, waiting for it if needed
  async function currentSpec() {
    const rd = R[state.k], s = specOf(rd, gkey(), null, refreshSpec(rd));
    if (!s.done) $("csvStatus").textContent = "Waiting for the eigenvalues of this round…";
    await s.promise;
    $("csvStatus").textContent = "";
    return s;
  }

  async function csvEigs() {
    const s = await currentSpec(), r = s.r, name = `${shapeSlug()}_round${state.k}_${gkey()}_gasket_eigenvalues.csv`;
    if (!r) return download(name, "no edges\n");
    if (r.method === "dense") {
      const forms = graphOf(R[state.k], gkey()).eigs;      // [value, multiplicity, a+bφ form]
      const formOf = (v) => { const f = forms.find((e) => Math.abs(e[0] - v) < 1e-7); return f ? [f[1], f[2]] : ["", ""]; };
      const rows = [["index", "eigenvalue", "multiplicity", "in_Z[phi]_as_a+b*phi", "residual_|Lv-lv|"]];
      r.vals.forEach((v, i) => { const [m, f] = formOf(v); rows.push([i + 1, num(v, 15), m, f, num(LS.residual(s.csr, r.vecs[i], v), 3)]); });
      download(name, toCSV(rows));
    } else {
      download(name, toCSV([["which", "eigenvalue", "residual_|Lv-lv|", "method"],
        ["lambda2", num(r.lambda2, 15), num(r.res2, 3), "shift-invert Lanczos"],
        ["lambda3", num(r.lambda3, 15), "", "shift-invert Lanczos"],
        ["lambda4", num(r.lambda4, 15), "", "shift-invert Lanczos"],
        ["lambda_max", num(r.lambdaMax, 15), num(r.resMax, 3), "Lanczos"]]));
    }
  }

  async function csvVecs() {
    const s = await currentSpec(), r = s.r, name = `${shapeSlug()}_round${state.k}_${gkey()}_gasket_eigenvectors.csv`;
    if (!r) return download(name, "no edges\n");
    const ids = s.csr.ids, off = s.csr.off;
    const all = r.method === "dense" && r.V <= 300;            // small graphs: every eigenvector
    const head = ["point_index", "x", "y", "degree"];
    const cols = [];
    if (all) r.vecs.forEach((v, j) => { head.push(`v${j + 1} (lambda=${num(r.vals[j], 8)})`); cols.push(v); });
    else {
      head.push(`fiedler (lambda2=${num(r.lambda2, 8)})`, `top (lambda_max=${num(r.lambdaMax, 8)})`); cols.push(r.fiedler, r.vecMax);
      if (state.vec === "k" && r.vecs) { const k = Math.min(Math.max(1, state.vecK), r.V); head.push(`v${k} (lambda=${num(r.vals[k - 1], 8)})`); cols.push(r.vecs[k - 1]); }
    }
    const rows = [head];
    for (let j = 0; j < ids.length; j++) {
      const p = P[ids[j]];
      rows.push([ids[j], num(p[0]), num(p[1]), off[j + 1] - off[j]].concat(cols.map((v) => num(v[j], 10))));
    }
    download(name, toCSV(rows));
  }

  // every shape × round × graph, computed fresh (types at their current shapes)
  let exporting = false;
  async function csvAll() {
    if (exporting) return;
    exporting = true;
    const btn = $("csvAll"), includeR3 = $("csvAllR3").checked;
    btn.disabled = true;
    const status = (t) => { $("csvStatus").textContent = t; };
    const head = ["shape", "free_parameters", "round", "graph", "points", "new_points", "new_points_without_gasket", "segments",
      "gasket_segments", "directions", "smallest_angle_deg", "closest_two_points", "points_with_3plus_lines",
      "V", "E", "components", "bounded_faces", "euler_check", "faces_by_corners", "degree_counts", "max_degree",
      "lambda2", "lambda2_multiplicity", "lambda3", "lambda_max", "zero_eigenvalues", "log10_spanning_trees",
      "eigenvalues_a+b*phi", "spectrum_method"]
      .concat("ABCDE".split("").map((V) => `angle_${V}_deg`), "abcde".split("").map((e) => `side_${e}`));
    const out = [head];
    const shapesList = [0].concat(TT.TYPES.map((T) => T.n));
    const total = shapesList.length * (LIVE_ROUNDS + 1) * 2;
    let done = 0;
    try {
      for (const n of shapesList) {
        const ds = n ? computeLive(shapes[n], LIVE_ROUNDS) : { points: D.points, rounds: D.rounds };
        const v = n ? vertsOf(shapes[n]) : D.points.slice(0, 5).map((p) => [p[0], p[1]]);
        const m = TT.measure(v.flat());
        for (const rd of ds.rounds) {
          const geom = LA.geometry(ds.points, rd), c = rd.counts;
          for (const key of ["with", "without"]) {
            status(`Working: ${n ? `type ${n}` : "regular"}, round ${rd.k}, ${key} pentagasket (${++done} of ${total})…`);
            await new Promise((res) => setTimeout(res, 0));
            const g = n ? LA.graph(ds.points, rd, key === "without") : rd.graph[key];
            const csr = LA.laplacianCSR(rd, key === "without", LS.DENSE_MAX);
            let sp = null, method = "";
            if (!csr.ids.length) method = "no edges";
            else if (csr.ids.length <= LS.DENSE_MAX || includeR3) {
              const cached = !n && rd.spec && rd.spec[key] && rd.spec[key].done ? rd.spec[key].r : null;
              sp = cached || summarizeSpec(csr, await exportRunner.run(csr));
              method = sp.method === "dense" ? "full (dense)" : "Lanczos" + (csr.partial ? " (largest piece)" : "");
            } else method = "skipped (round 3, see checkbox)";
            const faces = Object.entries(g.faces || {}).map(([k2, c2]) => `${k2}:${c2}`).join(" ");
            const degs = Object.entries(g.degrees || {}).map(([k2, c2]) => `${k2}:${c2}`).join(" ");
            out.push([n ? `type ${n}` : "regular", n ? typeInfo[n].dof : 0, rd.k, `${key}_gasket`, c.points,
              rd.k ? c.new : "", rd.k ? c.new_ng : "", c.segments, c.gasket_segments, c.directions,
              num(geom.min_angle), num(geom.min_dist), geom.multi,
              g.V, g.E, g.C, g.F, g.E ? (g.euler_ok ? "ok" : "fails") : "", faces, degs, csr.maxDeg || "",
              num(sp && sp.lambda2), sp && sp.method === "dense" ? sp.mult2 : "",
              num(sp && (sp.method === "dense" ? sp.vals[2] : sp.lambda3)), num(sp && sp.lambdaMax),
              sp && sp.method === "dense" ? sp.zeros : "", sp && sp.method === "dense" && sp.logTau !== null ? (isFinite(sp.logTau) ? num(sp.logTau, 10) : "none") : "",
              g.eigs && g.eigs.length ? g.zphi_count : "", method]
              .concat("ABCDE".split("").map((V) => num(m.ang[V])), "abcde".split("").map((e) => num(m.s[e]))));
          }
        }
      }
      download("all_shapes_all_rounds.csv", toCSV(out));
      status(`Done: ${out.length - 1} rows.`);
    } finally {
      exporting = false;
      btn.disabled = false;
    }
  }

  // ------------------------------------------------------------ update ---
  function writeHash() {
    const parts = [];
    if (isType()) {
      parts.push(`type=${state.shape}`);
      const x = shapes[state.shape], x0 = TT.initial(curType());
      if (x.some((v, i) => Math.abs(v - x0[i]) > 1e-12)) parts.push(`v=${x.map((v) => v.toFixed(15)).join(",")}`);
    }
    parts.push(`round=${state.k}`, `gasket=${state.gasket ? 1 : 0}`);
    history.replaceState(null, "", "#" + parts.join("&"));
  }
  function setRound(k) {
    state.k = Math.max(0, Math.min(maxRound, k));
    state.hover = -1;
    $("slider").max = maxRound;
    $("slider").value = state.k;
    $("roundLabel").textContent = `Round ${state.k} of ${maxRound}`;
    $("prev").disabled = state.k === 0;
    $("next").disabled = state.k === maxRound;
    writeHash();
    render();
  }
  function render() {
    countsTable();
    if (isType()) typePanel(); else layerTable();
    typesTable();
    geometry();
    graphPanel();
    specPanel();
    cyclePanel();
    legend();
    draw();
  }
  // while dragging: only the cheap parts; geometry and graph once it settles
  let heavyTimer = 0;
  function renderLight() {
    countsTable();
    typePanel();
    typesTable();
    draw();
    clearTimeout(heavyTimer);
    heavyTimer = setTimeout(() => { geometry(); graphPanel(); specPanel(); cyclePanel(); writeHash(); }, 250);
  }

  function setShape(n) {
    state.shape = n;
    state.hover = state.layerHi = state.hoverVertex = -1;
    document.body.classList.toggle("mode-type", n > 0);
    $("shape").value = n;
    if (n) {
      recomputeLive();
      const T = curType(), rigid = typeInfo[n].dof === 0;
      $("subtitle").textContent = `Type ${n} tiling pentagon (${T.by}) · computed live in floating point · collinear points share one segment`;
      $("hint").textContent = (rigid ? "Rigid shape: no free parameters · drag to pan" : "Drag a vertex to reshape · drag elsewhere to pan") +
        " · scroll to zoom · ←/→ rounds · G toggles gasket";
    } else {
      useRegular();
      $("subtitle").textContent = "Regular pentagon · every point exact in Q(√5) · collinear points share one segment";
      $("hint").textContent = "Scroll to zoom · drag to pan · ←/→ rounds · G toggles gasket";
    }
    fit();
    setRound(state.k);
  }

  // Move vertex i towards (tx, ty) while keeping the type's conditions. The
  // dragged vertex is weighted heavily, the two vertices across from it
  // moderately, so the shape bends near the cursor. Moves in small steps and
  // stops at the last shape that is still convex and on the constraints.
  function dragVertexTo(i, tx, ty) {
    const T = curType();
    let x = shapes[T.n];
    const size = Math.sqrt(TT.measure(x).area);
    const fx = x[2 * i], fy = x[2 * i + 1];
    const steps = Math.min(40, Math.max(1, Math.ceil(Math.hypot(tx - fx, ty - fy) / (0.03 * size))));
    const w = new Array(10).fill(1);
    w[2 * i] = w[2 * i + 1] = 1e6;
    for (const j of [(i + 2) % 5, (i + 3) % 5]) w[2 * j] = w[2 * j + 1] = 1e2;
    let moved = false;
    for (let s = 1; s <= steps; s++) {
      const tgt = x.slice();
      tgt[2 * i] = fx + (tx - fx) * s / steps;
      tgt[2 * i + 1] = fy + (ty - fy) * s / steps;
      const r = TT.project(T, tgt, w, 30);
      if (!(r.res < 1e-10) || !TT.valid(r.x)) break;
      x = r.x;
      moved = true;
    }
    if (moved) shapes[T.n] = x;
    return moved;
  }
  function vertexAt(mx, my) {
    if (!isType() || typeInfo[state.shape].dof === 0) return -1;
    const x = shapes[state.shape];
    let best = -1, bd = 13 * 13;
    for (let i = 0; i < 5; i++) {
      const dx = sx(x[2 * i]) - mx, dy = sy(x[2 * i + 1]) - my, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  // ------------------------------------------------------------ events ---
  $("shape").innerHTML = `<option value="0">Regular pentagon (exact)</option>` +
    TT.TYPES.map((T) => `<option value="${T.n}">Type ${T.n}</option>`).join("");
  $("shape").addEventListener("change", (e) => setShape(+e.target.value));
  $("resetShape").addEventListener("click", () => {
    if (!isType()) return;
    shapes[state.shape] = TT.initial(curType());
    setShape(state.shape);
  });
  $("typesTable").addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-shape]");
    if (tr) setShape(+tr.dataset.shape);
  });
  $("csvSummary").addEventListener("click", csvSummary);
  $("csvPoints").addEventListener("click", csvPoints);
  $("csvEigs").addEventListener("click", csvEigs);
  $("csvVecs").addEventListener("click", csvVecs);
  $("csvAll").addEventListener("click", csvAll);
  $("slider").addEventListener("input", (e) => setRound(+e.target.value));
  $("prev").addEventListener("click", () => setRound(state.k - 1));
  $("next").addEventListener("click", () => setRound(state.k + 1));
  $("gasket").addEventListener("change", (e) => { state.gasket = e.target.checked; setRound(state.k); });
  $("countsBody").addEventListener("click", (e) => {
    const tr = e.target.closest("tr");
    if (tr) setRound(+tr.dataset.k);
  });
  for (const id of ["layerTable", "typeLayers"]) {
    $(id).addEventListener("mouseover", (e) => {
      const tr = e.target.closest("tr[data-layer]");
      const j = tr ? +tr.dataset.layer : -1;
      if (j !== state.layerHi) { state.layerHi = j; draw(); }
    });
    $(id).addEventListener("mouseleave", () => { state.layerHi = -1; draw(); });
  }
  $("zoomIn").addEventListener("click", () => zoomAt(wrap.clientWidth / 2, wrap.clientHeight / 2, 1.5));
  $("zoomOut").addEventListener("click", () => zoomAt(wrap.clientWidth / 2, wrap.clientHeight / 2, 1 / 1.5));
  $("reset").addEventListener("click", () => { fit(); draw(); });
  document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "SELECT") return;
    if (e.target.tagName === "INPUT" && e.target.type !== "checkbox" && e.target.type !== "range") return;
    if (e.key === "ArrowRight") { setRound(state.k + 1); e.preventDefault(); }
    else if (e.key === "ArrowLeft") { setRound(state.k - 1); e.preventDefault(); }
    else if (e.key === "g" || e.key === "G") { $("gasket").click(); }
  });

  cv.addEventListener("wheel", (e) => {
    e.preventDefault();
    const rect = cv.getBoundingClientRect();
    zoomAt(e.clientX - rect.left, e.clientY - rect.top, Math.exp(-e.deltaY * 0.0015));
  }, { passive: false });

  let drag = null, pending = null, frame = 0;
  const canvasXY = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  cv.addEventListener("pointerdown", (e) => {
    const [mx, my] = canvasXY(e);
    const vi = vertexAt(mx, my);
    drag = vi >= 0 ? { vertex: vi } : { x: e.clientX, y: e.clientY, ox: state.ox, oy: state.oy };
    cv.setPointerCapture(e.pointerId);
    cv.classList.add("dragging");
    state.hover = -1;
    hideTip();
  });
  cv.addEventListener("pointermove", (e) => {
    if (drag && drag.vertex != null) {
      const [mx, my] = canvasXY(e);
      pending = [(mx - state.ox) / state.scale, (state.oy - my) / state.scale];
      if (!frame) frame = requestAnimationFrame(() => {
        frame = 0;
        if (!pending || !drag) return;
        const [tx, ty] = pending;
        pending = null;
        if (dragVertexTo(drag.vertex, tx, ty)) { recomputeLive(); renderLight(); }
      });
    } else if (drag) {
      state.ox = drag.ox + e.clientX - drag.x;
      state.oy = drag.oy + e.clientY - drag.y;
      draw();
    } else {
      const [mx, my] = canvasXY(e);
      const vi = vertexAt(mx, my);
      cv.classList.toggle("over-vertex", vi >= 0);
      if (vi !== state.hoverVertex) { state.hoverVertex = vi; draw(); }
      if (vi >= 0) {
        const m = TT.measure(shapes[state.shape]), V = "ABCDE"[vi];
        showTip(e, `<b>Vertex ${V}</b><br>angle ${m.ang[V].toFixed(4)}°<br>drag to reshape`);
      } else pointTip(e);
    }
  });
  const endDrag = () => { drag = null; cv.classList.remove("dragging"); };
  cv.addEventListener("pointerup", endDrag);
  cv.addEventListener("pointercancel", endDrag);
  cv.addEventListener("pointerleave", () => { if (!drag) { state.hover = state.hoverVertex = -1; hideTip(); draw(); } });
  cv.addEventListener("dblclick", () => { fit(); draw(); });

  new ResizeObserver(() => { fit(); resize(); }).observe(wrap);
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", render);

  // initial state from the URL, e.g. index.html#type=7&round=2&gasket=1
  // (v= holds a dragged shape: xA,yA,...,xE,yE)
  const hash = new URLSearchParams(location.hash.slice(1));
  if (hash.get("gasket") === "0") { state.gasket = false; $("gasket").checked = false; }
  state.k = +(hash.get("round") || 0);
  growthChart($("growthChart"));
  fitChart($("fitChart"));
  growthText();
  goldenPanel();
  const t0 = +(hash.get("type") || 0);
  if (t0 >= 1 && t0 <= TT.TYPES.length) {
    const v = (hash.get("v") || "").split(",").map(Number);
    if (v.length === 10 && v.every(isFinite)) {
      const T = TT.TYPES[t0 - 1], r = TT.project(T, v, null, 50);
      if (r.res < 1e-10 && TT.valid(r.x)) shapes[t0] = r.x;
    }
  }
  setShape(t0 >= 1 && t0 <= TT.TYPES.length ? t0 : 0);
  setTimeout(fillSummaries, 50);
})();
