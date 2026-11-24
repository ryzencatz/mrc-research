// Floating-point meta-intersection engine for an arbitrary convex pentagon.
// Same rules as engine.py (merged segments, pentagasket layers), but in floats
// with tolerances, so it can rerun live while a vertex is dragged.
// Works in the browser (window.LiveEngine) and in node (module.exports).
(function (root) {
  "use strict";

  const LINE_TOL = 1e-11;  // point-to-line distance that counts as "on the line"
  const SNAP = 1e-11;      // crossings closer than this are the same point
  // (true concurrences land within ~1e-14 of each other; genuine near-misses
  // as close as 1e-9 occur in round 3, so the gap is wide on both sides)
  const SPAN_TOL = 1e-11;  // slack when testing whether a crossing lies on a span
  const PAR_TOL = 1e-12;   // |sin angle| below which two lines are parallel
  const HASH_CELL = 1e-6;  // grid cell of the point hash (must exceed SNAP)

  // ------------------------------------------------------------ helpers ---
  function crossPoint(p, q, r, s) {
    // lines pq and rs; returns [x, y] or null
    const d1x = q[0] - p[0], d1y = q[1] - p[1], d2x = s[0] - r[0], d2y = s[1] - r[1];
    const den = d1x * d2y - d1y * d2x;
    if (Math.abs(den) < 1e-15) return null;
    const t = ((r[0] - p[0]) * d2y - (r[1] - p[1]) * d2x) / den;
    return [p[0] + t * d1x, p[1] + t * d1y];
  }

  // nested pentagons: P0 = the pentagon, P(j+1) = crossings of P(j)'s diagonals
  function gasketLayers(verts, n) {
    const layers = [verts.map((v) => [v[0], v[1]])];
    for (let j = 0; j < n; j++) {
      const L = layers[j], out = [];
      for (let i = 0; i < 5; i++) {
        const X = crossPoint(L[i], L[(i + 2) % 5], L[(i + 1) % 5], L[(i + 3) % 5]);
        if (!X) return layers;
        out.push(X);
      }
      layers.push(out);
    }
    return layers;
  }

  // spatial hash of points for snapping
  class PointHash {
    constructor(h) { this.h = h; this.m = new Map(); }
    key(kx, ky) { return (kx + 33554432) * 67108864 + (ky + 33554432); }
    find(xs, ys, x, y, tol) {
      const kx = Math.floor(x / this.h), ky = Math.floor(y / this.h);
      const t2 = tol * tol;
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        const arr = this.m.get(this.key(kx + a, ky + b));
        if (!arr) continue;
        for (const i of arr) {
          const dx = xs[i] - x, dy = ys[i] - y;
          if (dx * dx + dy * dy <= t2) return i;
        }
      }
      return -1;
    }
    add(i, x, y) {
      const k = this.key(Math.floor(x / this.h), Math.floor(y / this.h));
      const arr = this.m.get(k);
      if (arr) arr.push(i); else this.m.set(k, [i]);
    }
  }

  // ------------------------------------------------------------- engine ---
  // verts: 5 [x, y] in cyclic order, already normalised to about unit size.
  // Returns {points: [[x, y, birth, layer]], rounds: [...]}, rounds 0..maxRound.
  // Stops early (rounds shorter) if a round would exceed opts.maxPairs line pairs.
  function compute(verts, maxRound, opts) {
    opts = opts || {};
    const maxPairs = opts.maxPairs || 4e7;
    const layers = gasketLayers(verts, maxRound + 3);
    const xs = [], ys = [], birth = [], layer = [];
    const hash = new PointHash(HASH_CELL);

    // layer membership of any point, by snapping to the layer vertices
    const layerHash = new PointHash(HASH_CELL), lx = [], ly = [], lj = [];
    layers.forEach((L, j) => L.forEach((p) => {
      if (layerHash.find(lx, ly, p[0], p[1], SNAP) >= 0) return;
      layerHash.add(lx.length, p[0], p[1]); lx.push(p[0]); ly.push(p[1]); lj.push(j);
    }));
    const layerOf = (x, y) => { const i = layerHash.find(lx, ly, x, y, SNAP); return i < 0 ? -1 : lj[i]; };

    function addPoint(x, y, b) {
      const i = xs.length;
      xs.push(x); ys.push(y); birth.push(b); layer.push(layerOf(x, y));
      hash.add(i, x, y);
      return i;
    }
    for (const v of verts) addPoint(v[0], v[1], 0);

    const rounds = [];
    // round 0: the sides
    rounds.push({
      k: 0,
      counts: { points: 5, new: 5, new_ng: 0, segments: 5, gasket_segments: 5, lines: 5, directions: countDirections(
        verts.map((v, i) => [verts[(i + 1) % 5][0] - v[0], verts[(i + 1) % 5][1] - v[1]])) },
      lines: verts.map((_, i) => ({ pts: [i, (i + 1) % 5], gasket: [[i, (i + 1) % 5]], ng: [] })),
      ng_points: [],
    });

    for (let k = 1; k <= maxRound; k++) {
      const N = xs.length;
      // ---- join every pair; collinear points share one segment --------
      const covered = new Uint8Array(N * N);
      const L = [];     // {pts (sorted along line), p0, dir, len, nx, ny, c, gasket}
      for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
        if (covered[i * N + j]) continue;
        let dx = xs[j] - xs[i], dy = ys[j] - ys[i];
        const len0 = Math.hypot(dx, dy);
        dx /= len0; dy /= len0;
        const nx = -dy, ny = dx, c = nx * xs[i] + ny * ys[i];
        const mem = [];
        for (let m = 0; m < N; m++) if (Math.abs(nx * xs[m] + ny * ys[m] - c) < LINE_TOL) mem.push(m);
        const tt = new Map(mem.map((m) => [m, (xs[m] - xs[i]) * dx + (ys[m] - ys[i]) * dy]));
        mem.sort((a, b) => tt.get(a) - tt.get(b));
        for (let a = 0; a < mem.length; a++) for (let b = a + 1; b < mem.length; b++) {
          const u = Math.min(mem[a], mem[b]), v = Math.max(mem[a], mem[b]);
          covered[u * N + v] = 1;
        }
        // gasket: two members from the same layer
        const seen = new Set();
        let gasket = false;
        for (const m of mem) if (layer[m] >= 0) { if (seen.has(layer[m])) { gasket = true; break; } seen.add(layer[m]); }
        const a = mem[0], b = mem[mem.length - 1];
        const ex = xs[b] - xs[a], ey = ys[b] - ys[a], len = Math.hypot(ex, ey);
        L.push({ pts: mem, x0: xs[a], y0: ys[a], dx: ex / len, dy: ey / len, len, gasket });
      }
      const Lc = L.length;
      if (Lc * (Lc - 1) / 2 > maxPairs) { rounds.truncated = { k, segments: Lc, points: N }; break; }

      // ---- crossings ---------------------------------------------------
      const newStart = N;
      const lineNew = L.map(() => []);
      const ngNew = new Set();
      for (let i = 0; i < Lc; i++) {
        const A = L[i];
        for (let j = i + 1; j < Lc; j++) {
          const B = L[j];
          const cr = A.dx * B.dy - A.dy * B.dx;
          if (Math.abs(cr) < PAR_TOL) continue;
          const wx = B.x0 - A.x0, wy = B.y0 - A.y0;
          const t = (wx * B.dy - wy * B.dx) / cr;
          if (t < -SPAN_TOL || t > A.len + SPAN_TOL) continue;
          const s = (wx * A.dy - wy * A.dx) / cr;
          if (s < -SPAN_TOL || s > B.len + SPAN_TOL) continue;
          const x = A.x0 + t * A.dx, y = A.y0 + t * A.dy;
          let p = hash.find(xs, ys, x, y, SNAP);
          if (p >= 0 && p < newStart) continue;           // already a point
          if (p < 0) p = addPoint(x, y, k);
          const ln = lineNew[i], lm = lineNew[j];
          if (ln[ln.length - 1] !== p) ln.push(p);
          if (lm[lm.length - 1] !== p) lm.push(p);
          if (!A.gasket && !B.gasket) ngNew.add(p);
        }
      }

      // ---- per-line records: all points on the line, in order ----------
      const lines = L.map((A, li) => {
        const set = new Set(A.pts.concat(lineNew[li]));
        const pts = [...set].sort((a, b) =>
          ((xs[a] - A.x0) * A.dx + (ys[a] - A.y0) * A.dy) - ((xs[b] - A.x0) * A.dx + (ys[b] - A.y0) * A.dy));
        const span = [pts[0], pts[pts.length - 1]];
        return { pts, gasket: A.gasket ? [span] : [], ng: A.gasket ? [] : [span] };
      });
      const ng_points = [...ngNew].sort((a, b) => a - b);
      rounds.push({
        k,
        counts: {
          points: xs.length, new: xs.length - N, new_ng: ng_points.length,
          segments: Lc, gasket_segments: L.filter((A) => A.gasket).length, lines: Lc,
          directions: countDirections(L.map((A) => [A.dx, A.dy])),
        },
        lines, ng_points,
      });
    }
    const points = xs.map((x, i) => [x, ys[i], birth[i], layer[i]]);
    return { points, rounds, layers };
  }

  // distinct directions (mod 180°)
  function countDirections(dirs) {
    const angs = dirs.map(([x, y]) => { let a = Math.atan2(y, x); if (a < 0) a += Math.PI; if (a >= Math.PI - 1e-10) a -= Math.PI; return a; }).sort((a, b) => a - b);
    let n = 0, last = -1;
    for (const a of angs) if (n === 0 || a - last > 1e-9) { n++; last = a; }
    if (n > 1 && angs[angs.length - 1] > Math.PI - 1e-9 && angs[0] < 1e-9) n--;
    return n;
  }

  const api = { compute, gasketLayers, crossPoint, countDirections };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LiveEngine = api;
})(typeof window !== "undefined" ? window : globalThis);
