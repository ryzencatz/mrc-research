// Laplacian eigenvalues and eigenvectors of an arrangement graph.
//   dense  (V <= DENSE_MAX): full decomposition (Householder + QL, as in JAMA)
//   sparse (larger):         λmax by Lanczos; λ2, λ3, λ4 and the Fiedler vector
//                            by shift-invert Lanczos (each step solves L x = q by
//                            preconditioned conjugate gradients)
// Each result carries residuals |L v − λ v| so its accuracy can be checked.
// The factory is self-contained, so the page can also run it in a Web Worker
// built from its source text (window.LiveSpectral.workerSource).
(function (root) {
  "use strict";

  function factory() {
    const DENSE_MAX = 1000;

    // graph as CSR: off (n+1), nbr (2E), on vertices 0..n-1
    function lapMul(g, x, y) {
      const { off, nbr } = g;
      for (let i = 0, n = off.length - 1; i < n; i++) {
        let s = (off[i + 1] - off[i]) * x[i];
        for (let k = off[i]; k < off[i + 1]; k++) s -= x[nbr[k]];
        y[i] = s;
      }
    }
    const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
    const norm = (a) => Math.sqrt(dot(a, a));
    function center(v) { let s = 0; for (let i = 0; i < v.length; i++) s += v[i]; s /= v.length; for (let i = 0; i < v.length; i++) v[i] -= s; }
    function residual(g, v, lam) {
      const y = new Float64Array(v.length);
      lapMul(g, v, y);
      for (let i = 0; i < v.length; i++) y[i] -= lam * v[i];
      return norm(y) / Math.max(1e-300, norm(v));
    }

    // ---------------------------------------------------------- dense ---
    // Symmetric eigendecomposition (JAMA tred2 + tql2). A is n arrays of n.
    // Returns {d (ascending), V (V[i][j] = component i of eigenvector j)}.
    function symEig(A) {
      const n = A.length, V = A.map((r) => Float64Array.from(r)), d = new Float64Array(n), e = new Float64Array(n);
      if (n === 0) return { d, V };
      for (let j = 0; j < n; j++) d[j] = V[n - 1][j];
      for (let i = n - 1; i > 0; i--) {
        let scale = 0, h = 0;
        for (let k = 0; k < i; k++) scale += Math.abs(d[k]);
        if (scale === 0) {
          e[i] = d[i - 1];
          for (let j = 0; j < i; j++) { d[j] = V[i - 1][j]; V[i][j] = 0; V[j][i] = 0; }
        } else {
          for (let k = 0; k < i; k++) { d[k] /= scale; h += d[k] * d[k]; }
          let f = d[i - 1], g = Math.sqrt(h);
          if (f > 0) g = -g;
          e[i] = scale * g; h -= f * g; d[i - 1] = f - g;
          for (let j = 0; j < i; j++) e[j] = 0;
          for (let j = 0; j < i; j++) {
            f = d[j]; V[j][i] = f; g = e[j] + V[j][j] * f;
            for (let k = j + 1; k <= i - 1; k++) { g += V[k][j] * d[k]; e[k] += V[k][j] * f; }
            e[j] = g;
          }
          f = 0;
          for (let j = 0; j < i; j++) { e[j] /= h; f += e[j] * d[j]; }
          const hh = f / (h + h);
          for (let j = 0; j < i; j++) e[j] -= hh * d[j];
          for (let j = 0; j < i; j++) {
            f = d[j]; g = e[j];
            for (let k = j; k <= i - 1; k++) V[k][j] -= f * e[k] + g * d[k];
            d[j] = V[i - 1][j]; V[i][j] = 0;
          }
        }
        d[i] = h;
      }
      for (let i = 0; i < n - 1; i++) {
        V[n - 1][i] = V[i][i]; V[i][i] = 1;
        const h = d[i + 1];
        if (h !== 0) {
          for (let k = 0; k <= i; k++) d[k] = V[k][i + 1] / h;
          for (let j = 0; j <= i; j++) {
            let g = 0;
            for (let k = 0; k <= i; k++) g += V[k][i + 1] * V[k][j];
            for (let k = 0; k <= i; k++) V[k][j] -= g * d[k];
          }
        }
        for (let k = 0; k <= i; k++) V[k][i + 1] = 0;
      }
      for (let j = 0; j < n; j++) { d[j] = V[n - 1][j]; V[n - 1][j] = 0; }
      V[n - 1][n - 1] = 1;
      e[0] = 0;
      // tql2
      for (let i = 1; i < n; i++) e[i - 1] = e[i];
      e[n - 1] = 0;
      let f = 0, tst1 = 0;
      const eps = Math.pow(2, -52);
      for (let l = 0; l < n; l++) {
        tst1 = Math.max(tst1, Math.abs(d[l]) + Math.abs(e[l]));
        let m = l;
        while (m < n - 1 && Math.abs(e[m]) > eps * tst1) m++;
        if (m > l) {
          let iter = 0;
          do {
            if (++iter > 100) break;
            let g = d[l], p = (d[l + 1] - g) / (2 * e[l]), r = Math.hypot(p, 1);
            if (p < 0) r = -r;
            d[l] = e[l] / (p + r);
            d[l + 1] = e[l] * (p + r);
            const dl1 = d[l + 1];
            let h = g - d[l];
            for (let i = l + 2; i < n; i++) d[i] -= h;
            f += h;
            p = d[m];
            let c = 1, c2 = c, c3 = c, s = 0, s2 = 0;
            const el1 = e[l + 1];
            for (let i = m - 1; i >= l; i--) {
              c3 = c2; c2 = c; s2 = s;
              g = c * e[i]; h = c * p; r = Math.hypot(p, e[i]);
              e[i + 1] = s * r; s = e[i] / r; c = p / r; p = c * d[i] - s * g;
              d[i + 1] = h + s * (c * g + s * d[i]);
              for (let k = 0; k < n; k++) {
                const Vk = V[k];
                h = Vk[i + 1];
                Vk[i + 1] = s * Vk[i] + c * h;
                Vk[i] = c * Vk[i] - s * h;
              }
            }
            p = -s * s2 * c3 * el1 * e[l] / dl1;
            e[l] = s * p;
            d[l] = c * p;
          } while (Math.abs(e[l]) > eps * tst1);
        }
        d[l] = d[l] + f;
        e[l] = 0;
      }
      // sort ascending
      const ord = Array.from(d.keys()).sort((a, b) => d[a] - d[b]);
      return { d: Float64Array.from(ord, (j) => d[j]), V: V.map((row) => Float64Array.from(ord, (j) => row[j])) };
    }

    function dense(g) {
      const n = g.off.length - 1;
      const A = Array.from({ length: n }, () => new Float64Array(n));
      for (let i = 0; i < n; i++) {
        A[i][i] = g.off[i + 1] - g.off[i];
        for (let k = g.off[i]; k < g.off[i + 1]; k++) A[i][g.nbr[k]] -= 1;
      }
      const { d, V } = symEig(A);
      const vals = Array.from(d, (v) => (Math.abs(v) < 1e-10 ? 0 : v));
      // eigenvectors as columns -> one Float64Array per eigenvalue
      const vecs = vals.map((_, j) => Float64Array.from(V, (row) => row[j]));
      let maxRes = 0;
      for (let j = 0; j < n; j++) maxRes = Math.max(maxRes, residual(g, vecs[j], vals[j]));
      return { method: "dense", vals, vecs, maxRes };
    }

    // --------------------------------------------------------- sparse ---
    function seedVector(n, salt) {
      const v = new Float64Array(n);
      for (let i = 0; i < n; i++) { const t = Math.sin((i + 1) * 12.9898 + salt * 78.233) * 43758.5453; v[i] = t - Math.floor(t) - 0.5; }
      return v;
    }

    // Lanczos with full reorthogonalisation on op (which maps to the space ⟂ 1).
    // Returns Ritz pairs of the tridiagonal, largest first.
    function lanczos(op, n, m, salt) {
      const Q = [];
      let q = seedVector(n, salt);
      center(q);
      let b = norm(q);
      q = q.map((v) => v / b);
      const al = [], be = [];
      for (let k = 0; k < m; k++) {
        Q.push(q);
        const w = op(q);
        al.push(dot(w, q));
        for (let pass = 0; pass < 2; pass++) for (const v of Q) { const c = dot(w, v); for (let i = 0; i < n; i++) w[i] -= c * v[i]; }
        center(w);
        const bb = norm(w);
        if (bb < 1e-12 || k === m - 1) { be.push(bb); break; }
        be.push(bb);
        q = w.map((v) => v / bb);
      }
      const m2 = al.length;
      const T = Array.from({ length: m2 }, (_, i) => {
        const r = new Float64Array(m2);
        r[i] = al[i];
        if (i + 1 < m2) r[i + 1] = be[i];
        if (i) r[i - 1] = be[i - 1];
        return r;
      });
      const { d, V } = symEig(T);
      const pairs = [];
      for (let j = m2 - 1; j >= 0; j--) {
        const x = new Float64Array(n);
        for (let k = 0; k < m2; k++) { const c = V[k][j]; const Qk = Q[k]; for (let i = 0; i < n; i++) x[i] += c * Qk[i]; }
        const nx = norm(x);
        for (let i = 0; i < n; i++) x[i] /= nx;
        pairs.push({ theta: d[j], x });
      }
      return pairs;
    }

    // solve L x = b on the space ⟂ 1 with Jacobi-preconditioned CG
    function solve(g, b, tol) {
      const n = b.length, x = new Float64Array(n), r = Float64Array.from(b), z = new Float64Array(n),
            p = new Float64Array(n), Ap = new Float64Array(n);
      const deg = new Float64Array(n);
      for (let i = 0; i < n; i++) deg[i] = g.off[i + 1] - g.off[i];
      center(r);
      const b0 = norm(r);
      if (b0 === 0) return x;
      for (let i = 0; i < n; i++) z[i] = r[i] / deg[i];
      center(z);
      p.set(z);
      let rz = dot(r, z);
      for (let it = 0; it < 20000; it++) {
        lapMul(g, p, Ap);
        const a = rz / dot(p, Ap);
        let rr = 0;
        for (let i = 0; i < n; i++) { x[i] += a * p[i]; r[i] -= a * Ap[i]; rr += r[i] * r[i]; }
        if (Math.sqrt(rr) < tol * b0) break;
        for (let i = 0; i < n; i++) z[i] = r[i] / deg[i];
        center(z);
        const rz2 = dot(r, z);
        const beta = rz2 / rz;
        rz = rz2;
        for (let i = 0; i < n; i++) p[i] = z[i] + beta * p[i];
      }
      center(x);
      return x;
    }

    // connected graphs only (λ2 > 0); the caller passes the largest component
    function sparse(g) {
      const n = g.off.length - 1;
      const top = lanczos((q) => { const y = new Float64Array(n); lapMul(g, q, y); return y; }, n, Math.min(n - 1, 160), 1)[0];
      const low = lanczos((q) => solve(g, q, 1e-11), n, Math.min(n - 1, 14), 2).slice(0, 3)
        .map((p) => ({ lam: 1 / p.theta, x: p.x }));
      return {
        method: "sparse",
        lambdaMax: top.theta, vecMax: top.x, resMax: residual(g, top.x, top.theta),
        low: low.map((p) => p.lam), fiedler: low[0].x, resLow: low.map((p) => residual(g, p.x, p.lam)),
      };
    }

    function run(g) {
      return g.off.length - 1 <= DENSE_MAX ? dense(g) : sparse(g);
    }
    return { DENSE_MAX, symEig, dense, sparse, run, lapMul, residual };
  }

  const api = factory();
  // a Web Worker that runs `run` on {id, off, nbr} messages
  api.workerSource = `const S = (${factory.toString()})();
self.onmessage = (e) => {
  const { id, off, nbr } = e.data;
  const r = S.run({ off, nbr });
  const transfer = [];
  if (r.vecs) r.vecs.forEach((v) => transfer.push(v.buffer));
  if (r.vecMax) transfer.push(r.vecMax.buffer, r.fiedler.buffer);
  self.postMessage({ id, r }, transfer);
};`;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LiveSpectral = api;
})(typeof window !== "undefined" ? window : globalThis);
