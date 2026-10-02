// Meta-intersecting pentagon visualizer. Data comes from data.js (export.py).
(function () {
  "use strict";

  const D = window.PENTA;
  if (!D) {
    document.body.innerHTML = "<p style='padding:20px'>web/data.js is missing. Run <code>python export.py</code> first.</p>";
    return;
  }
  const P = D.points;           // [x, y, birthRound, gasketLayer]
  const R = D.rounds;
  const maxRound = R.length - 1;

  const $ = (id) => document.getElementById(id);
  const cv = $("cv"), wrap = $("wrap"), tip = $("tip");
  const ctx = cv.getContext("2d");
  const state = { k: 0, gasket: true, scale: 1, ox: 0, oy: 0, hover: -1 };

  const fmt = (n) => n.toLocaleString("en-US");
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  // ------------------------------------------------------------ view ---
  function fit() {
    const w = wrap.clientWidth, h = wrap.clientHeight;
    // pentagon of circumradius 1, vertex up: y in [-0.809, 1]
    state.scale = 0.46 * Math.min(w, h / 0.95);
    state.ox = w / 2;
    state.oy = h / 2 + state.scale * 0.0955;
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
    const r = n > 200 ? 2 : 3.5;
    ctx.fillStyle = ink;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      if (P[i][2] === state.k && state.k > 0) continue;
      ctx.moveTo(sx(P[i][0]) + r, sy(P[i][1]));
      ctx.arc(sx(P[i][0]), sy(P[i][1]), r, 0, 2 * Math.PI);
    }
    ctx.fill();
    if (state.k > 0) {
      const rn = r + 0.5;
      ctx.fillStyle = s1;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        if (P[i][2] !== state.k || (ngSet && !ngSet.has(i))) continue;
        ctx.moveTo(sx(P[i][0]) + rn, sy(P[i][1]));
        ctx.arc(sx(P[i][0]), sy(P[i][1]), rn, 0, 2 * Math.PI);
      }
      ctx.fill();
      if (ngSet) {
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

  // ------------------------------------------------------------ legend ---
  function legend() {
    const k = state.k;
    const items = [];
    if (k > 0) {
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

  function geometry() {
    const rd = R[state.k], g = rd.geom, c = rd.counts;
    $("geomTitle").textContent = `Geometry · round ${state.k}`;
    $("geomTiles").innerHTML =
      tile("New intersections", state.k ? fmt(state.gasket ? c.new : c.new_ng) : "–",
           state.k ? (state.gasket ? `${fmt(c.new_ng)} without gasket` : `${fmt(c.new)} with gasket`) : "") +
      tile("Lines drawn", fmt(c.lines), `${g.n_dir} directions · ${g.n_dir_mult18} at multiples of 18°`) +
      tile("Smallest angle", `${g.min_angle.toPrecision(4)}°`, "between lines through one point") +
      tile("Closest two points", g.min_dist.toPrecision(3), "circumradius = 1") +
      tile("Segment lengths", fmt(g.n_lengths), `distinct, over ${fmt(g.n_segments)} segments`) +
      tile("φ-power lengths", fmt(g.phi_power_segments),
           `side × φ^n, n ∈ {${g.phi_power_values.join(", ")}}`);
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
    const g = R[state.k].graph[key];
    $("graphTitle").textContent = `Arrangement graph · round ${state.k} · ${state.gasket ? "with" : "without"} pentagasket`;
    const body = $("graphBody");
    if (!g.E) {
      body.innerHTML = `<p class="empty">No segments remain in round ${state.k} once the pentagasket is removed. Every segment drawn so far joins two points of the same layer.</p>`;
      return;
    }
    const euler = g.euler_ok
      ? `<span class="status ok">✓ Euler check holds: V − E + F = C</span>`
      : `<span class="status bad">✕ Euler check fails</span>`;
    const maxF = Math.max(...Object.values(g.faces));
    const faces = Object.entries(g.faces).map(([c, m]) =>
      `<tr><td>${c}-gon</td><td>${fmt(m)}</td><td style="width:55%"><span class="bar" style="width:${(100 * m / maxF).toFixed(1)}%"></span></td></tr>`).join("");
    const maxD = Math.max(...Object.values(g.degrees));
    const degs = Object.entries(g.degrees).map(([d, m]) =>
      `<tr><td>${d}</td><td>${fmt(m)}</td><td style="width:55%"><span class="bar" style="width:${(100 * m / maxD).toFixed(1)}%"></span></td></tr>`).join("");
    const phiEigs = g.eigs.filter((e) => e[2] && e[2].includes("φ"));
    const phiList = phiEigs.length
      ? `<ul class="eig-list">${phiEigs.map(([v, m, f]) => `<li>${v.toFixed(6)} = ${f}${m > 1 ? ` (×${m})` : ""}</li>`).join("")}</ul>`
      : `<p class="empty">None. No eigenvalue lies in Q(√5) apart from ${g.int_count === 1 ? "0" : "integers"}.</p>`;
    body.innerHTML = `
      <div class="tiles">
        ${tile("Vertices · edges", `${fmt(g.V)} · ${fmt(g.E)}`, `${g.C} component${g.C > 1 ? "s" : ""}`)}
        ${tile("Bounded faces", fmt(g.F), g.nonsimple ? `${g.nonsimple} non-simple` : "")}
      </div>
      <p style="margin:8px 0 0">${euler}</p>
      <h3>Faces by number of corners</h3>
      <table class="mini"><tbody>${faces}</tbody></table>
      <h3>Degree distribution</h3>
      <table class="mini"><thead><tr><th>Degree</th><th>Vertices</th><th></th></tr></thead><tbody>${degs}</tbody></table>
      <h3>Laplacian spectrum (L = D − A)</h3>
      <div class="tiles">
        ${tile("λ₂ (algebraic connectivity)", g.lambda2.toPrecision(5))}
        ${tile("λ max", g.lambda_max.toPrecision(5))}
      </div>
      <div class="chart" id="specChart" style="margin-top:8px"></div>
      <h3>Eigenvalues of the form a + bφ (b ≠ 0): ${g.zphi_count} of ${g.n_eigs}</h3>
      ${phiList}
      <p class="note">Found by pairing each eigenvalue with its Galois conjugate a + bφ′. This test is complete, so any eigenvalue in Q(√5) would show up here.</p>`;
    spectrumChart($("specChart"), g.eigs);
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
    showTip(ev, `<b>Point #${best}</b><br>Born in round ${p[2]}${layer}${via}<br>(${p[0].toFixed(6)}, ${p[1].toFixed(6)})`);
  }

  // ------------------------------------------------------------ update ---
  function setRound(k) {
    state.k = Math.max(0, Math.min(maxRound, k));
    state.hover = -1;
    $("slider").value = state.k;
    $("roundLabel").textContent = `Round ${state.k} of ${maxRound}`;
    $("prev").disabled = state.k === 0;
    $("next").disabled = state.k === maxRound;
    history.replaceState(null, "", `#round=${state.k}&gasket=${state.gasket ? 1 : 0}`);
    render();
  }
  function render() {
    countsTable();
    geometry();
    graphPanel();
    legend();
    draw();
  }

  // ------------------------------------------------------------ events ---
  $("slider").max = maxRound;
  $("slider").addEventListener("input", (e) => setRound(+e.target.value));
  $("prev").addEventListener("click", () => setRound(state.k - 1));
  $("next").addEventListener("click", () => setRound(state.k + 1));
  $("gasket").addEventListener("change", (e) => { state.gasket = e.target.checked; setRound(state.k); });
  $("countsBody").addEventListener("click", (e) => {
    const tr = e.target.closest("tr");
    if (tr) setRound(+tr.dataset.k);
  });
  $("zoomIn").addEventListener("click", () => zoomAt(wrap.clientWidth / 2, wrap.clientHeight / 2, 1.5));
  $("zoomOut").addEventListener("click", () => zoomAt(wrap.clientWidth / 2, wrap.clientHeight / 2, 1 / 1.5));
  $("reset").addEventListener("click", () => { fit(); draw(); });
  document.addEventListener("keydown", (e) => {
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

  let drag = null;
  cv.addEventListener("pointerdown", (e) => {
    drag = { x: e.clientX, y: e.clientY, ox: state.ox, oy: state.oy };
    cv.setPointerCapture(e.pointerId);
    cv.classList.add("dragging");
    hideTip();
  });
  cv.addEventListener("pointermove", (e) => {
    if (drag) {
      state.ox = drag.ox + e.clientX - drag.x;
      state.oy = drag.oy + e.clientY - drag.y;
      draw();
    } else {
      pointTip(e);
    }
  });
  const endDrag = () => { drag = null; cv.classList.remove("dragging"); };
  cv.addEventListener("pointerup", endDrag);
  cv.addEventListener("pointercancel", endDrag);
  cv.addEventListener("pointerleave", () => { if (!drag) { state.hover = -1; hideTip(); draw(); } });
  cv.addEventListener("dblclick", () => { fit(); draw(); });

  new ResizeObserver(() => { fit(); resize(); }).observe(wrap);
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", render);

  // initial state from the URL, e.g. index.html#round=3&gasket=0
  const hash = new URLSearchParams(location.hash.slice(1));
  if (hash.get("gasket") === "0") { state.gasket = false; $("gasket").checked = false; }
  fit();
  setRound(+(hash.get("round") || 0));
})();
