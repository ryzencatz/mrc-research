// Geometry and arrangement-graph statistics for a live (float) round, in the
// same shape as the precomputed data from analysis.py, so app.js can show
// either. Works in the browser (window.LiveAnalysis) and in node.
(function (root) {
  "use strict";

  const PHI = (1 + Math.sqrt(5)) / 2;
  const SPECTRUM_MAX_V = 1000;

  function hist(values, step, top) {
    top = top || 180;
    const counts = new Array(Math.round(top / step)).fill(0);
    for (const v of values) counts[Math.min(counts.length - 1, Math.max(0, Math.floor(v / step + 1e-9)))]++;
    return { step, counts };
  }

  // P: [[x, y, birth, layer]], rd: round with lines[].pts
  function geometry(P, rd) {
    const n = rd.counts.points;
    const dirs = rd.lines.map((L) => {
      const a = P[L.pts[0]], b = P[L.pts[L.pts.length - 1]];
      let d = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
      d = ((d % 180) + 180) % 180;
      if (d > 180 - 1e-9) d = 0;
      return d;
    });
    const sorted = dirs.slice().sort((a, b) => a - b);
    let nDir = 0, last = -1;
    for (const d of sorted) if (nDir === 0 || d - last > 1e-7) { nDir++; last = d; }
    if (nDir > 1 && sorted[0] < 1e-7 && sorted[sorted.length - 1] > 180 - 1e-7) nDir--;

    // angles between consecutive lines through each point
    const at = new Map();
    rd.lines.forEach((L, li) => { for (const p of L.pts) { const a = at.get(p); if (a) a.push(dirs[li]); else at.set(p, [dirs[li]]); } });
    const gaps = [];
    let minAngle = Infinity, multi = 0, maxLines = 0;
    for (const ds of at.values()) {
      if (ds.length >= 3) multi++;
      if (ds.length > maxLines) maxLines = ds.length;
      if (ds.length < 2) continue;
      ds.sort((a, b) => a - b);
      for (let i = 0; i < ds.length; i++) {
        const g = (i + 1 < ds.length ? ds[i + 1] : ds[0] + 180) - ds[i];
        gaps.push(g);
        if (g < minAngle) minAngle = g;
      }
    }

    // segment lengths, relative to side b (A to B)
    const side = Math.hypot(P[0][0] - P[1][0], P[0][1] - P[1][1]);
    const lens = rd.lines.map((L) => {
      const a = P[L.pts[0]], b = P[L.pts[L.pts.length - 1]];
      return Math.hypot(b[0] - a[0], b[1] - a[1]) / side;
    }).sort((a, b) => a - b);
    let nLen = 0, lastL = -1;
    for (const l of lens) if (nLen === 0 || l - lastL > 1e-7) { nLen++; lastL = l; }

    const md = minDistance(P, n);
    return {
      n_dir: nDir, n_dir_mult18: null, min_angle: isFinite(minAngle) ? minAngle : 0,
      min_dist: md.min, near_pairs: md.near, n_lengths: nLen, n_segments: lens.length,
      phi_power_segments: null, phi_power_values: [], multi, max_lines: maxLines,
      dir_hist: hist(dirs, 3), angle_hist: hist(gaps, 3),
    };
  }

  // closest pair, and how many pairs are closer than NEAR (near-coincidences:
  // counts near such shapes depend on rounding)
  const NEAR = 1e-6;
  function minDistance(P, n) {
    const idx = [];
    for (let i = 0; i < n; i++) idx.push(i);
    idx.sort((a, b) => P[a][0] - P[b][0]);
    let best = Infinity, near = 0;
    for (let i = 0; i < idx.length; i++) {
      const p = P[idx[i]];
      for (let j = i + 1; j < idx.length; j++) {
        const q = P[idx[j]];
        const dx = q[0] - p[0];
        if (dx >= Math.max(best, NEAR)) break;
        const d = Math.hypot(dx, q[1] - p[1]);
        if (d < best) best = d;
        if (d < NEAR) near++;
      }
    }
    return { min: isFinite(best) ? best : 0, near };
  }

  // ------------------------------------------------------------- graph ---
  function graph(P, rd, withoutGasket) {
    const n = rd.counts.points;
    const eu = [], ev = [], el = [];
    rd.lines.forEach((L, li) => {
      if (withoutGasket && L.gasket.length) return;
      for (let i = 0; i + 1 < L.pts.length; i++) { eu.push(L.pts[i]); ev.push(L.pts[i + 1]); el.push(li); }
    });
    const E = eu.length;
    if (!E) return { V: 0, E: 0, C: 0, F: 0, euler_ok: true, degrees: {}, faces: {}, nonsimple: 0, eigs: [],
                     lambda2: 0, lambda_max: 0, zphi_count: 0, int_count: 0, n_eigs: 0 };

    const deg = new Map();
    const nb = new Map();
    const addN = (a, b, l) => { let x = nb.get(a); if (!x) nb.set(a, x = []); x.push([b, l]); };
    for (let i = 0; i < E; i++) {
      deg.set(eu[i], (deg.get(eu[i]) || 0) + 1);
      deg.set(ev[i], (deg.get(ev[i]) || 0) + 1);
      addN(eu[i], ev[i], el[i]); addN(ev[i], eu[i], el[i]);
    }
    const used = [...deg.keys()];
    const V = used.length;

    // components (union-find)
    const parent = new Map(used.map((v) => [v, v]));
    const find = (v) => { while (parent.get(v) !== v) { parent.set(v, parent.get(parent.get(v))); v = parent.get(v); } return v; };
    for (let i = 0; i < E; i++) { const a = find(eu[i]), b = find(ev[i]); if (a !== b) parent.set(a, b); }
    let C = 0;
    for (const v of used) if (find(v) === v) C++;

    // faces: sort neighbours counter-clockwise, then walk
    const rank = new Map();
    for (const [v, ns] of nb) {
      ns.sort((a, b) => Math.atan2(P[a[0]][1] - P[v][1], P[a[0]][0] - P[v][0]) - Math.atan2(P[b[0]][1] - P[v][1], P[b[0]][0] - P[v][0]));
      ns.forEach(([w], i) => rank.set(v * n + w, i));
    }
    const lineOf = new Map();
    for (let i = 0; i < E; i++) { lineOf.set(eu[i] * n + ev[i], el[i]); lineOf.set(ev[i] * n + eu[i], el[i]); }
    // Walk every face. Each component has exactly one outer walk (the most
    // negative signed area); every other walk is a bounded face. Deciding by
    // that rather than by an area threshold keeps sliver faces near
    // coincidences and the zero-area walk around a tree right.
    const seen = new Set();
    const walks = [];
    const outer = new Map();      // component root -> index of its outer walk
    for (const start of lineOf.keys()) {
      if (seen.has(start)) continue;
      let u = Math.floor(start / n), v = start % n;
      const cyc = [];
      while (!seen.has(u * n + v)) {
        seen.add(u * n + v);
        cyc.push([u, v]);
        const ns = nb.get(v);
        const w = ns[(rank.get(v * n + u) - 1 + ns.length) % ns.length][0];
        u = v; v = w;
      }
      let area = 0, corners = 0, back = false;
      for (let i = 0; i < cyc.length; i++) {
        const [a, b] = cyc[i], nx = cyc[(i + 1) % cyc.length];
        area += P[a][0] * P[b][1] - P[b][0] * P[a][1];
        if (nx[1] === a) back = true;
        if (lineOf.get(a * n + b) !== lineOf.get(nx[0] * n + nx[1])) corners++;
      }
      const comp = find(cyc[0][0]), wi = walks.length;
      walks.push({ area, corners, back });
      if (!outer.has(comp) || area < walks[outer.get(comp)].area) outer.set(comp, wi);
    }
    const outerSet = new Set(outer.values());
    const faceCount = {};
    let F = 0, nonsimple = 0;
    walks.forEach((f, i) => {
      if (outerSet.has(i)) return;
      F++;
      if (f.back) nonsimple++;
      else faceCount[f.corners] = (faceCount[f.corners] || 0) + 1;
    });

    const degrees = {};
    for (const d of deg.values()) degrees[d] = (degrees[d] || 0) + 1;

    const out = { V, E, C, F, euler_ok: V - E + F === C, degrees, faces: faceCount, nonsimple,
                  eigs: [], lambda2: null, lambda_max: null, zphi_count: 0, int_count: 0, n_eigs: 0 };
    if (V <= SPECTRUM_MAX_V) {
      const ix = new Map(used.map((v, i) => [v, i]));
      const M = Array.from({ length: V }, () => new Float64Array(V));
      for (let i = 0; i < E; i++) {
        const a = ix.get(eu[i]), b = ix.get(ev[i]);
        M[a][b] -= 1; M[b][a] -= 1; M[a][a] += 1; M[b][b] += 1;
      }
      const evs = symEigenvalues(M);
      const groups = groupEigs(evs);
      out.eigs = groups;
      out.lambda2 = evs.length > 1 ? evs[1] : 0;
      out.lambda_max = evs[evs.length - 1];
      out.n_eigs = evs.length;
      for (const [, m, f] of groups) if (f) { if (f.includes("φ")) out.zphi_count += m; else out.int_count += m; }
    } else {
      out.spectrum_skipped = SPECTRUM_MAX_V;
    }
    return out;
  }

  // eigenvalues of a symmetric matrix: Householder tridiagonalisation + implicit QL
  function symEigenvalues(A) {
    const n = A.length, d = new Float64Array(n), e = new Float64Array(n);
    for (let i = n - 1; i > 0; i--) {
      const l = i - 1;
      let h = 0, scale = 0;
      if (l > 0) {
        for (let k = 0; k <= l; k++) scale += Math.abs(A[i][k]);
        if (scale === 0) e[i] = A[i][l];
        else {
          for (let k = 0; k <= l; k++) { A[i][k] /= scale; h += A[i][k] * A[i][k]; }
          let f = A[i][l];
          const g = f >= 0 ? -Math.sqrt(h) : Math.sqrt(h);
          e[i] = scale * g; h -= f * g; A[i][l] = f - g; f = 0;
          for (let j = 0; j <= l; j++) {
            let gg = 0;
            for (let k = 0; k <= j; k++) gg += A[j][k] * A[i][k];
            for (let k = j + 1; k <= l; k++) gg += A[k][j] * A[i][k];
            e[j] = gg / h; f += e[j] * A[i][j];
          }
          const hh = f / (h + h);
          for (let j = 0; j <= l; j++) {
            const ff = A[i][j], gg = e[j] - hh * ff;
            e[j] = gg;
            for (let k = 0; k <= j; k++) A[j][k] -= ff * e[k] + gg * A[i][k];
          }
        }
      } else e[i] = A[i][l];
      d[i] = h;
    }
    for (let i = 0; i < n; i++) d[i] = A[i][i];
    for (let i = 1; i < n; i++) e[i - 1] = e[i];
    e[n - 1] = 0;
    for (let l = 0; l < n; l++) {
      let iter = 0, m;
      do {
        for (m = l; m < n - 1; m++) { const dd = Math.abs(d[m]) + Math.abs(d[m + 1]); if (Math.abs(e[m]) <= 1e-15 * dd) break; }
        if (m !== l) {
          if (iter++ > 60) break;
          let g = (d[l + 1] - d[l]) / (2 * e[l]);
          let r = Math.hypot(g, 1);
          g = d[m] - d[l] + e[l] / (g + (g >= 0 ? Math.abs(r) : -Math.abs(r)));
          let s = 1, c = 1, p = 0, i;
          for (i = m - 1; i >= l; i--) {
            let f = s * e[i];
            const b = c * e[i];
            e[i + 1] = (r = Math.hypot(f, g));
            if (r === 0) { d[i + 1] -= p; e[m] = 0; break; }
            s = f / r; c = g / r; g = d[i + 1] - p; r = (d[i] - g) * s + 2 * c * b;
            d[i + 1] = g + (p = s * r); g = c * r - b;
          }
          if (r === 0 && i >= l) continue;
          d[l] -= p; e[l] = g; e[m] = 0;
        }
      } while (m !== l);
    }
    return Array.from(d).sort((a, b) => a - b).map((v) => (Math.abs(v) < 1e-10 ? 0 : v));
  }

  // [value, multiplicity, "a+bφ" or "" ] as analysis.group_eigs
  function groupEigs(ev) {
    const out = [];
    for (const x of ev) {
      if (out.length && Math.abs(x - out[out.length - 1][0]) < 1e-7) out[out.length - 1][1]++;
      else out.push([x, 1]);
    }
    const TOL = 1e-7;
    return out.map(([v, m]) => {
      let form = "";
      if (Math.abs(v - Math.round(v)) < TOL) form = String(Math.round(v));
      else {
        for (const [w, mw] of out) {
          const b = (v - w) / Math.sqrt(5), s = v + w;
          if (mw === m && Math.round(b) !== 0 && Math.abs(b - Math.round(b)) < TOL && Math.abs(s - Math.round(s)) < TOL) {
            const bb = Math.round(b), a = Math.round(v - bb * PHI);
            const bs = bb === 1 ? "φ" : bb === -1 ? "-φ" : `${bb}φ`;
            form = a === 0 ? bs : `${a}${bb > 0 ? "+" : "-"}${bs.replace("-", "")}`;
            break;
          }
        }
      }
      return [v, m, form];
    });
  }

  // Laplacian of the round's arrangement graph as CSR on the vertices it
  // touches: {off, nbr, ids (point index of each row), maxDeg, edgeBound,
  // E, comps, partial}. Graphs above denseMax with several components are cut
  // down to the largest one (partial = true), because the sparse solver needs
  // a connected graph.
  function laplacianCSR(rd, withoutGasket, denseMax) {
    const adj = new Map();
    const add = (a, b) => { let x = adj.get(a); if (!x) adj.set(a, x = []); x.push(b); };
    let E = 0;
    for (const L of rd.lines) {
      if (withoutGasket && L.gasket.length) continue;
      for (let i = 0; i + 1 < L.pts.length; i++) { add(L.pts[i], L.pts[i + 1]); add(L.pts[i + 1], L.pts[i]); E++; }
    }
    let ids = [...adj.keys()].sort((a, b) => a - b);
    // components
    const comp = new Map();
    let comps = 0, bestSize = 0, best = -1;
    for (const s of ids) {
      if (comp.has(s)) continue;
      const stack = [s];
      comp.set(s, comps);
      let size = 0;
      while (stack.length) { const v = stack.pop(); size++; for (const w of adj.get(v)) if (!comp.has(w)) { comp.set(w, comps); stack.push(w); } }
      if (size > bestSize) { bestSize = size; best = comps; }
      comps++;
    }
    const partial = comps > 1 && ids.length > denseMax;
    if (partial) ids = ids.filter((v) => comp.get(v) === best);
    const ix = new Map(ids.map((v, i) => [v, i]));
    const off = new Int32Array(ids.length + 1), nbr = [];
    let maxDeg = 0, edgeBound = 0;
    ids.forEach((v, i) => {
      const ns = adj.get(v);
      maxDeg = Math.max(maxDeg, ns.length);
      for (const w of ns) { nbr.push(ix.get(w)); edgeBound = Math.max(edgeBound, ns.length + adj.get(w).length); }
      off[i + 1] = nbr.length;
    });
    return { off, nbr: Int32Array.from(nbr), ids: Int32Array.from(ids), maxDeg, edgeBound, E, comps, partial };
  }

  const api = { geometry, graph, symEigenvalues, laplacianCSR, SPECTRUM_MAX_V };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LiveAnalysis = api;
})(typeof window !== "undefined" ? window : globalThis);
