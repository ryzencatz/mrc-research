// The 15 types of convex pentagons that tile the plane, as constraint systems,
// plus a small solver that keeps a pentagon on its type's constraints while a
// vertex is dragged. Works in the browser (window.TileTypes) and in node.
//
// Labels follow the usual convention (and the reference figure): vertices
// A, B, C, D, E in order, angle X at vertex X, and sides
//   a = EA, b = AB, c = BC, d = CD, e = DE.
(function (root) {
  "use strict";

  const DEG = Math.PI / 180;

  // side lengths and interior angles (degrees) of x = [xA, yA, xB, yB, ...]
  function measure(x) {
    const P = [0, 1, 2, 3, 4].map((i) => [x[2 * i], x[2 * i + 1]]);
    const dist = (i, j) => Math.hypot(P[i][0] - P[j][0], P[i][1] - P[j][1]);
    const s = { a: dist(4, 0), b: dist(0, 1), c: dist(1, 2), d: dist(2, 3), e: dist(3, 4) };
    // orientation sign, so angles are interior for either winding
    let area2 = 0;
    for (let i = 0; i < 5; i++) area2 += P[i][0] * P[(i + 1) % 5][1] - P[(i + 1) % 5][0] * P[i][1];
    const o = area2 >= 0 ? 1 : -1;
    const ang = {};
    "ABCDE".split("").forEach((n, i) => {
      const p = P[(i + 4) % 5], v = P[i], q = P[(i + 1) % 5];
      const ux = p[0] - v[0], uy = p[1] - v[1], wx = q[0] - v[0], wy = q[1] - v[1];
      // interior angle measured from (v->q) to (v->p), counter-clockwise for o = +1
      ang[n] = Math.atan2(o * (wx * uy - wy * ux), wx * ux + wy * uy) / DEG;
      if (ang[n] < 0) ang[n] += 360;
    });
    return { s, ang, area: Math.abs(area2) / 2, perimeter: s.a + s.b + s.c + s.d + s.e };
  }

  // Each condition: [display text, residual(s, A)] with s = sides, A = angles (deg).
  // Length residuals are divided by the perimeter so everything is scale free;
  // angle residuals are in radians.
  const L = (f) => (s, A, per) => f(s) / per;
  const G = (f) => (s, A) => f(A) * DEG;

  const TYPES = [
    { n: 1, by: "Reinhardt, 1918",
      shown: ["B + C = 180°", "A + D + E = 360°"],
      eq: [["B + C = 180°", G((A) => A.B + A.C - 180)]],
      derived: [["A + D + E = 360°", (A) => A.A + A.D + A.E, 360]],
      guess: [[140, 315], [368, 267], [233, 80], [138, 100], [83, 243]] },
    { n: 2, by: "Reinhardt, 1918",
      shown: ["c = e", "B + D = 180°"],
      eq: [["c = e", L((s) => s.c - s.e)], ["B + D = 180°", G((A) => A.B + A.D - 180)]],
      guess: [[655, 298], [767, 245], [773, 126], [516, 85], [560, 195]] },
    { n: 3, by: "Reinhardt, 1918",
      shown: ["a = b, d = c + e", "A = C = D = 120°"],
      eq: [["a = b", L((s) => s.a - s.b)], ["d = c + e", L((s) => s.d - s.c - s.e)],
           ["A = 120°", G((A) => A.A - 120)], ["C = 120°", G((A) => A.C - 120)], ["D = 120°", G((A) => A.D - 120)]],
      guess: [[947, 262], [1123, 315], [1157, 262], [1050, 82], [905, 82]] },
    { n: 4, by: "Reinhardt, 1918",
      shown: ["b = c, d = e", "B = D = 90°"],
      eq: [["b = c", L((s) => s.b - s.c)], ["d = e", L((s) => s.d - s.e)],
           ["B = 90°", G((A) => A.B - 90)], ["D = 90°", G((A) => A.D - 90)]],
      guess: [[1443, 82], [1553, 208], [1422, 318], [1333, 318], [1333, 228]] },
    { n: 5, by: "Reinhardt, 1918",
      shown: ["a = b, d = e", "A = 60°, D = 120°"],
      eq: [["a = b", L((s) => s.a - s.b)], ["d = e", L((s) => s.d - s.e)],
           ["A = 60°", G((A) => A.A - 60)], ["D = 120°", G((A) => A.D - 120)]],
      guess: [[1742, 313], [2005, 313], [2037, 258], [2005, 122], [1875, 85]] },
    { n: 6, by: "Kershner, 1968",
      shown: ["a = d = e, b = c", "B + D = 180°, 2B = E"],
      eq: [["a = d", L((s) => s.a - s.d)], ["d = e", L((s) => s.d - s.e)], ["b = c", L((s) => s.b - s.c)],
           ["B + D = 180°", G((A) => A.B + A.D - 180)], ["2B = E", G((A) => 2 * A.B - A.E)]],
      guess: [[148, 715], [397, 713], [212, 553], [105, 588], [55, 673]] },
    { n: 7, by: "Kershner, 1968",
      shown: ["b = c = d = e", "B + 2E = 2C + D = 360°"],
      eq: [["b = c", L((s) => s.b - s.c)], ["c = d", L((s) => s.c - s.d)], ["d = e", L((s) => s.d - s.e)],
           ["B + 2E = 360°", G((A) => A.B + 2 * A.E - 360)], ["2C + D = 360°", G((A) => 2 * A.C + A.D - 360)]],
      guess: [[530, 746], [655, 746], [750, 665], [755, 545], [635, 532]] },
    { n: 8, by: "Kershner, 1968",
      shown: ["b = c = d = e", "2B + C = D + 2E = 360°"],
      eq: [["b = c", L((s) => s.b - s.c)], ["c = d", L((s) => s.c - s.d)], ["d = e", L((s) => s.d - s.e)],
           ["2B + C = 360°", G((A) => 2 * A.B + A.C - 360)], ["D + 2E = 360°", G((A) => A.D + 2 * A.E - 360)]],
      guess: [[945, 760], [1072, 760], [1118, 640], [1070, 527], [980, 608]] },
    { n: 9, by: "Rice, 1976",
      shown: ["b = c = d = e", "2A + C = D + 2E = 360°"],
      eq: [["b = c", L((s) => s.b - s.c)], ["c = d", L((s) => s.c - s.d)], ["d = e", L((s) => s.d - s.e)],
           ["2A + C = 360°", G((A) => 2 * A.A + A.C - 360)], ["D + 2E = 360°", G((A) => A.D + 2 * A.E - 360)]],
      guess: [[1378, 760], [1522, 760], [1485, 625], [1385, 527], [1355, 660]] },
    { n: 10, by: "James, 1975",
      shown: ["a = b = c + e", "A = 90°, B + E = 180°", "B + 2C = 360°"],
      eq: [["a = b", L((s) => s.a - s.b)], ["b = c + e", L((s) => s.b - s.c - s.e)],
           ["A = 90°", G((A) => A.A - 90)], ["B + E = 180°", G((A) => A.B + A.E - 180)],
           ["B + 2C = 360°", G((A) => A.B + 2 * A.C - 360)]],
      guess: [[1785, 720], [1988, 720], [2002, 685], [1932, 582], [1785, 518]] },
    { n: 11, by: "Rice, 1977",
      shown: ["2a + c = d = e", "A = 90°, C + E = 180°", "2B + C = 360°"],
      eq: [["2a + c = d", L((s) => 2 * s.a + s.c - s.d)], ["d = e", L((s) => s.d - s.e)],
           ["A = 90°", G((A) => A.A - 90)], ["C + E = 180°", G((A) => A.C + A.E - 180)],
           ["2B + C = 360°", G((A) => 2 * A.B + A.C - 360)]],
      // the figure's shape is within 0.002° of B = 150°; start exactly there
      init: [["B = 150°", G((A) => A.B - 150)]],
      guess: [[40, 1180], [315, 1180], [408, 1130], [228, 1025], [40, 1127]] },
    { n: 12, by: "Rice, 1977",
      shown: ["2a = d = c + e", "A = 90°, C + E = 180°", "2B + C = 360°"],
      eq: [["2a = d", L((s) => 2 * s.a - s.d)], ["d = c + e", L((s) => s.d - s.c - s.e)],
           ["A = 90°", G((A) => A.A - 90)], ["C + E = 180°", G((A) => A.C + A.E - 180)],
           ["2B + C = 360°", G((A) => 2 * A.B + A.C - 360)]],
      guess: [[490, 1197], [648, 1197], [797, 1122], [562, 1010], [487, 1068]] },
    { n: 13, by: "Rice, 1977",
      shown: ["d = 2a = 2e", "B = E = 90°", "2A + D = 360°"],
      eq: [["d = 2a", L((s) => s.d - 2 * s.a)], ["a = e", L((s) => s.a - s.e)],
           ["B = 90°", G((A) => A.B - 90)], ["E = 90°", G((A) => A.E - 90)],
           ["2A + D = 360°", G((A) => 2 * A.A + A.D - 360)]],
      guess: [[935, 1183], [1185, 1183], [1185, 1140], [980, 1025], [877, 1080]] },
    { n: 14, by: "Stein, 1985",
      shown: ["2a = 2c = d = e", "A = 90°, 2B + C = 360°", "C + E = 180°"],
      eq: [["a = c", L((s) => s.a - s.c)], ["2c = d", L((s) => 2 * s.c - s.d)], ["d = e", L((s) => s.d - s.e)],
           ["A = 90°", G((A) => A.A - 90)], ["2B + C = 360°", G((A) => 2 * A.B + A.C - 360)],
           ["C + E = 180°", G((A) => A.C + A.E - 180)]],
      derived: [["B ≈ 145.34°", (A) => A.B, 145.34], ["C ≈ 69.32°", (A) => A.C, 69.32],
                ["D ≈ 124.66°", (A) => A.D, 124.66], ["E ≈ 110.68°", (A) => A.E, 110.68]],
      guess: [[1265, 1150], [1527, 1148], [1605, 1090], [1445, 985], [1265, 1053]] },
    { n: 15, by: "Mann, McLoud-Mann & Von Derau, 2015",
      shown: ["a = c = e, b = 2a", "A = 150°, B = 60°, C = 135°", "D = 105°, E = 90°"],
      eq: [["a = c", L((s) => s.a - s.c)], ["c = e", L((s) => s.c - s.e)], ["b = 2a", L((s) => s.b - 2 * s.a)],
           ["A = 150°", G((A) => A.A - 150)], ["B = 60°", G((A) => A.B - 60)],
           ["C = 135°", G((A) => A.C - 135)], ["D = 105°", G((A) => A.D - 105)]],
      derived: [["E = 90°", (A) => A.E, 90]],
      guess: [[1955, 1012], [1697, 1080], [1783, 1172], [2045, 1172], [2085, 1045]] },
  ];

  // ------------------------------------------------------------- solver ---
  function residual(T, x) {
    const m = measure(x);
    return T.eq.map(([, f]) => f(m.s, m.ang, m.perimeter));
  }

  function jacobian(T, x) {
    const h = 1e-7, J = [];
    const r0 = residual(T, x);
    for (let k = 0; k < 10; k++) {
      const xp = x.slice(), xm = x.slice();
      xp[k] += h; xm[k] -= h;
      const rp = residual(T, xp), rm = residual(T, xm);
      for (let i = 0; i < r0.length; i++) (J[i] || (J[i] = []))[k] = (rp[i] - rm[i]) / (2 * h);
    }
    return J;
  }

  // solve (M + mu I) y = r for small dense symmetric M
  function solveSym(M, r, mu) {
    const n = r.length, A = M.map((row, i) => row.map((v, j) => v + (i === j ? mu : 0)).concat([r[i]]));
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let i = c + 1; i < n; i++) if (Math.abs(A[i][c]) > Math.abs(A[p][c])) p = i;
      [A[c], A[p]] = [A[p], A[c]];
      if (Math.abs(A[c][c]) < 1e-300) continue;
      for (let i = c + 1; i < n; i++) {
        const f = A[i][c] / A[c][c];
        for (let j = c; j <= n; j++) A[i][j] -= f * A[c][j];
      }
    }
    const y = new Array(n).fill(0);
    for (let i = n - 1; i >= 0; i--) {
      let s = A[i][n];
      for (let j = i + 1; j < n; j++) s -= A[i][j] * y[j];
      y[i] = Math.abs(A[i][i]) < 1e-300 ? 0 : s / A[i][i];
    }
    return y;
  }

  const norm = (v) => Math.sqrt(v.reduce((s, t) => s + t * t, 0));

  // Weighted minimum-norm Newton projection onto the constraint set:
  // each step solves  min Σ w_k dx_k²  s.t.  J dx = -r.  Heavier weight on a
  // coordinate means it moves less (used to keep the dragged vertex under the
  // cursor). Returns {x, res} where res is the final residual norm.
  function project(T, x0, w, iters) {
    let x = x0.slice();
    w = w || new Array(10).fill(1);
    for (let it = 0; it < (iters || 40); it++) {
      const r = residual(T, x);
      const rn = norm(r);
      if (rn < 1e-13) return { x, res: rn };
      const J = jacobian(T, x), m = r.length;
      // M = J W^-1 J^T
      const M = [];
      for (let i = 0; i < m; i++) {
        M[i] = [];
        for (let j = 0; j < m; j++) {
          let s = 0;
          for (let k = 0; k < 10; k++) s += J[i][k] * J[j][k] / w[k];
          M[i][j] = s;
        }
      }
      const y = solveSym(M, r, 1e-12 * (1 + rn));
      const dx = new Array(10).fill(0);
      for (let k = 0; k < 10; k++) {
        let s = 0;
        for (let i = 0; i < m; i++) s += J[i][k] * y[i];
        dx[k] = -s / w[k];
      }
      // damped step: halve until the residual drops
      let step = 1, xn;
      for (let tries = 0; tries < 12; tries++) {
        xn = x.map((v, k) => v + step * dx[k]);
        if (norm(residual(T, xn)) < rn) break;
        step /= 2;
      }
      x = xn;
    }
    return { x, res: norm(residual(T, x)) };
  }

  // rank of the constraint Jacobian -> shape degrees of freedom (mod similarity)
  function dof(T, x) {
    const J = jacobian(T, x).map((r) => r.slice());
    let rank = 0;
    const m = J.length, scale = Math.max(1e-300, ...J.flat().map(Math.abs));
    const used = new Array(m).fill(false);
    for (let c = 0; c < 10; c++) {
      let p = -1, best = 1e-6 * scale;
      for (let i = 0; i < m; i++) if (!used[i] && Math.abs(J[i][c]) > best) { best = Math.abs(J[i][c]); p = i; }
      if (p < 0) continue;
      used[p] = true; rank++;
      for (let i = 0; i < m; i++) if (i !== p) {
        const f = J[i][c] / J[p][c];
        for (let k = c; k < 10; k++) J[i][k] -= f * J[p][k];
      }
    }
    return { dof: 6 - rank, constraints: m, rank };
  }

  // convex with every angle in (2°, 178°) and no side shorter than 1% of the perimeter
  function valid(x) {
    const m = measure(x);
    let sum = 0;
    for (const n of "ABCDE") { if (m.ang[n] < 2 || m.ang[n] > 178) return false; sum += m.ang[n]; }
    if (Math.abs(sum - 540) > 1e-6) return false;     // not simple/convex
    for (const k of "abcde") if (m.s[k] < 0.01 * m.perimeter) return false;
    return true;
  }

  // Starting shape: the figure's vertices (y flipped), centred, circumradius ~1,
  // projected onto the constraints.
  function initial(T) {
    const g = T.guess.map(([px, py]) => [px, -py]);
    const cx = g.reduce((s, p) => s + p[0], 0) / 5, cy = g.reduce((s, p) => s + p[1], 0) / 5;
    const R = Math.max(...g.map((p) => Math.hypot(p[0] - cx, p[1] - cy)));
    const x = g.flatMap((p) => [(p[0] - cx) / R, (p[1] - cy) / R]);
    const T0 = T.init ? Object.assign({}, T, { eq: T.eq.concat(T.init) }) : T;
    return project(T0, x, null, 100).x;
  }

  const api = { TYPES, measure, residual, project, dof, valid, initial };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TileTypes = api;
})(typeof window !== "undefined" ? window : globalThis);
