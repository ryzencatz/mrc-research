"""
Independent brute-force check of engine.py.

Builds the merged segments (one per line, first point to last) with direct
collinearity tests, then tests every pair of segments in exact Q(√5)
arithmetic, with no float pre-filter, and compares the counts with the engine.
"""
import math
import sys
from itertools import combinations

from field import Q5, INV_PHI
import engine


def cross(u, v):
    return u[0] * v[1] - u[1] * v[0]


def sub(p, q):
    return (p[0] - q[0], p[1] - q[1])


def seg_cross(P, Q, R, S):
    """Exact crossing point of segments PQ and RS, or None (parallel/apart)."""
    r, s = sub(Q, P), sub(S, R)
    den = cross(r, s)
    if den.is_zero():
        return None
    w = sub(R, P)
    t = cross(w, s) / den
    u = cross(w, r) / den
    for x in (t, u):
        if x.sign() < 0 or (x - 1).sign() > 0:
            return None
    return (P[0] + t * r[0], P[1] + t * r[1])


def pentagon():
    v = [(Q5(1), Q5(0)), (Q5(0), Q5(1))]
    for _ in range(3):
        v.append((INV_PHI * v[-1][0] - v[-2][0], INV_PHI * v[-1][1] - v[-2][1]))
    return v


def layers(n):
    out = [pentagon()]
    for _ in range(n):
        L = out[-1]
        diags = [(L[i], L[(i + 2) % 5]) for i in range(5)]
        core = set()
        for (a, b), (c, d) in combinations(diags, 2):
            if len({a, b, c, d}) < 4:
                continue
            X = seg_cross(a, b, c, d)
            if X is not None:
                core.add(X)
        assert len(core) == 5
        # keep cyclic order so (i, i+2) are diagonals of the next layer
        out.append(sorted(core, key=lambda p: math.atan2(*engine.to_true(p)[::-1])))
    return out


def merged_segments(pts, layer_of):
    """
    One segment per line through 2+ points, from its first point to its last.
    Collinearity is tested directly with cross products (no line keys).
    Returns [(P, Q, is_gasket)].
    """
    done = set()
    out = []
    for P, Q in combinations(pts, 2):
        if (P, Q) in done:
            continue
        d = sub(Q, P)
        on = [R for R in pts if cross(d, sub(R, P)).is_zero()]
        for A, B in combinations(on, 2):
            done.add((A, B))
            done.add((B, A))
        # extreme points along the line: compare the parameter (R - P)·d exactly
        par = lambda R: sub(R, P)[0] * d[0] + sub(R, P)[1] * d[1]
        lo = min(on, key=lambda R: float(par(R)))
        hi = max(on, key=lambda R: float(par(R)))
        assert all(par(lo) < par(R) or par(lo) == par(R) for R in on)
        assert all(par(R) < par(hi) or par(R) == par(hi) for R in on)
        layers_on = [layer_of[R] for R in on if R in layer_of]
        out.append((lo, hi, len(layers_on) > len(set(layers_on))))
    return out


def brute(rounds):
    lay = layers(rounds + 1)
    layer_of = {p: j for j, L in enumerate(lay) for p in L}
    pts = list(lay[0])
    result = []
    for k in range(1, rounds + 1):
        have = set(pts)
        segs = merged_segments(pts, layer_of)
        new, new_ng = set(), set()
        for (P, Q, ga), (R, S, gb) in combinations(segs, 2):
            X = seg_cross(P, Q, R, S)
            if X is None or X in have:
                continue
            new.add(X)
            if not ga and not gb:
                new_ng.add(X)
        pts = pts + sorted(new, key=engine.to_true)
        result.append((k, len(pts), len(new), len(new_ng), len(segs), sum(g for _, _, g in segs)))
    return result


if __name__ == "__main__":
    R = int(sys.argv[1]) if len(sys.argv) > 1 else 3
    _, recs = engine.run(R, log=lambda *a: None)
    ok = True
    print("round  check            brute     engine")
    for k, n, new, ng, segs, gs in brute(R):
        r = recs[k]
        for name, b, e in [("points", n, r.n_points), ("new", new, r.new_points),
                           ("new (no gasket)", ng, r.new_points_ng),
                           ("segments", segs, r.segments), ("gasket segs", gs, r.gasket_segments)]:
            flag = "" if b == e else "   <-- MISMATCH"
            ok &= b == e
            print(f"{k:>5}  {name:<15} {b:>6}  {e:>9}{flag}")
    print("ALL MATCH" if ok else "MISMATCHES FOUND")
    sys.exit(0 if ok else 1)
