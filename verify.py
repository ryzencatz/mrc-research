"""
Independent brute-force check of engine.py.

Tests every pair of segments in exact Q(√5) arithmetic (no line grouping, no
float pre-filter) and compares the counts per round with the engine.
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


def brute(rounds):
    lay = layers(rounds + 1)
    layer_of = {p: j for j, L in enumerate(lay) for p in L}
    pts = list(lay[0])
    segs = [(pts[i], pts[(i + 1) % 5]) for i in range(5)]
    result = []
    for k in range(1, rounds + 1):
        have = set(pts)
        segs = list(combinations(pts, 2))
        gasket = [p in layer_of and q in layer_of and layer_of[p] == layer_of[q] for p, q in segs]
        new, new_ng = set(), set()
        for (a, (P, Q)), (b, (R, S)) in combinations(enumerate(segs), 2):
            X = seg_cross(P, Q, R, S)
            if X is None or X in have:
                continue
            new.add(X)
            if not gasket[a] and not gasket[b]:
                new_ng.add(X)
        pts = pts + sorted(new, key=engine.to_true)
        result.append((k, len(pts), len(new), len(new_ng), len(segs), sum(gasket)))
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
