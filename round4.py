"""
Round 4, as far as it can be computed.

Exact:     the number of segments (distinct lines through 2+ of the 741 points),
           and how many of them are pentagasket segments.
Estimated: the number of new points. Checking all ~3·10¹⁰ pairs of lines is out
           of reach, so a random sample of line pairs gives the fraction that
           cross inside both segments away from existing points (floats only).
           Several lines can cross at one point, so distinct new points are
           fewer than crossing pairs; rounds 2 and 3 had 2.19 and 1.93 crossing
           pairs per new point, and the estimate uses that range.

Run:  python round4.py [--samples 20000000]   (result cached in cache/round4.json)
"""
import argparse
import json
import math
import os
import time
from itertools import combinations

import numpy as np
from scipy.spatial import cKDTree

import engine

CACHE = os.path.join(engine.CACHE_DIR, "round4.json")
PAIRS_PER_POINT = (1.93, 2.19)   # crossing pairs per new point in rounds 3 and 2


def compute(st, samples=20_000_000, seed=0, log=print):
    t0 = time.time()
    N = len(st.pts)
    log(f"  round 4: grouping {math.comb(N, 2):,} point pairs into lines (exact)...")
    groups = engine._group_lines(st, combinations(range(N), 2))
    L = len(groups)
    gasket = 0
    P0 = np.empty((L, 2))
    D = np.empty((L, 2))
    LEN = np.empty(L)
    pf = st.pf
    for li, (_, members) in enumerate(groups):
        mem = list(members)
        layers = [st.layer[p] for p in mem if st.layer[p] >= 0]
        gasket += len(layers) > len(set(layers))
        a = pf[mem[0]]
        far = max(mem, key=lambda p: (pf[p][0] - a[0]) ** 2 + (pf[p][1] - a[1]) ** 2)
        lo = max(mem, key=lambda p: (pf[p][0] - pf[far][0]) ** 2 + (pf[p][1] - pf[far][1]) ** 2)
        d = pf[far] - pf[lo]
        ln = math.hypot(*d)
        P0[li], D[li], LEN[li] = pf[lo], d / ln, ln
    log(f"    {L:,} segments ({gasket} pentagasket), {time.time() - t0:.0f}s")

    # ---- sampled crossings ------------------------------------------------
    rng = np.random.default_rng(seed)
    tree = cKDTree(pf)
    hits = 0
    done = 0
    batch = 2_000_000
    while done < samples:
        m = min(batch, samples - done)
        I = rng.integers(0, L, m)
        J = rng.integers(0, L, m)
        keep = I != J
        I, J = I[keep], J[keep]
        di, dj = D[I], D[J]
        cr = di[:, 0] * dj[:, 1] - di[:, 1] * dj[:, 0]
        ok = np.abs(cr) > 1e-12
        I, J, di, dj, cr = I[ok], J[ok], di[ok], dj[ok], cr[ok]
        w = P0[J] - P0[I]
        t = (w[:, 0] * dj[:, 1] - w[:, 1] * dj[:, 0]) / cr
        s = (w[:, 0] * di[:, 1] - w[:, 1] * di[:, 0]) / cr
        inside = (t > 1e-10) & (t < LEN[I] - 1e-10) & (s > 1e-10) & (s < LEN[J] - 1e-10)
        X = P0[I[inside]] + t[inside, None] * di[inside]
        dist, _ = tree.query(X, distance_upper_bound=1e-8)
        hits += int(np.sum(~np.isfinite(dist)))      # not at an existing point
        done += m
    pairs = math.comb(L, 2)
    f = hits / done
    se = math.sqrt(f * (1 - f) / done)
    crossings = f * pairs
    out = dict(
        points_before=N, segments=L, gasket_segments=gasket,
        line_pairs=pairs, samples=done, crossing_fraction=f,
        crossing_pairs=crossings, crossing_pairs_se=se * pairs,
        new_points_est=crossings / PAIRS_PER_POINT[0],
        new_points_low=crossings / PAIRS_PER_POINT[1],
        new_points_high=crossings / PAIRS_PER_POINT[0] * 1.0,
        seconds=time.time() - t0,
    )
    out["new_points_high"] = crossings      # at most one new point per crossing pair
    log(f"    sampled {done:,} line pairs: {f:.5f} cross at a new point "
        f"→ ≈ {crossings:.3g} crossing pairs (±{se * pairs:.2g})")
    log(f"    → new points ≈ {out['new_points_low']:.3g} to {out['new_points_high']:.3g}, "
        f"best guess {out['new_points_est']:.3g}")
    return out


def get(st=None, samples=20_000_000, fresh=False, log=print):
    if not fresh and os.path.exists(CACHE):
        with open(CACHE) as f:
            r = json.load(f)
        if r.get("samples", 0) >= samples:
            return r
    if st is None:
        st, _ = engine.run(3, log=lambda *a: None)
    r = compute(st, samples, log=log)
    os.makedirs(engine.CACHE_DIR, exist_ok=True)
    with open(CACHE, "w") as f:
        json.dump(r, f, indent=1)
    return r


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--samples", type=int, default=20_000_000)
    ap.add_argument("--fresh", action="store_true")
    a = ap.parse_args()
    r = get(samples=a.samples, fresh=a.fresh)
    print(json.dumps(r, indent=1))
