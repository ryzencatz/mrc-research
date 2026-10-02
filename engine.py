"""
Meta-intersecting regular pentagon: exact round-by-round engine.

Rules (separate-segments version)
---------------------------------
Round 0: the 5 vertices of a regular pentagon and its 5 sides.
Round k: join every pair of points that is not joined yet (each pair is its own
segment). Every crossing of two segments that is not already a point becomes a
new point.

Collinear segments never create points, so the set of points that segments on
one line can create depends only on the union of those segments. The engine
therefore groups segments by their supporting line and intersects lines.

Pentagasket: layer P0 is the original pentagon; layer P(j+1) is the 5 crossing
points of P(j)'s diagonals. A segment is a gasket segment when both endpoints
are in the same layer (every pair of a layer is a side or a diagonal of it).
The "without pentagasket" count recounts a round's crossings using only the
non-gasket segments, on the same point set.

Exactness
---------
Incidence is affine-invariant, so the computation uses an affine image of the
regular pentagon whose coordinates lie in Q(√5) (see field.py). Every point and
every incidence is decided exactly. Floats (in true regular coordinates) are
only a pre-filter: a crossing is either
  * matched to an existing point, then confirmed exactly by checking that the
    point lies on both lines, or
  * confirmed as a new point by computing it exactly, or
  * near-degenerate (very shallow angle, or close to an existing point that is
    not on both lines), then decided completely in exact arithmetic.
"""
import math
import os
import pickle
import time
from itertools import combinations

import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
from scipy.spatial import cKDTree

from field import Q5, INV_PHI

SNAP = 1e-8          # distance under which a float crossing is matched to a point
SPAN_TOL = 1e-10     # slack when testing whether a crossing lies on a span
SHALLOW = 1e-6       # |sin(angle)| below which a line pair is decided exactly
CHUNK = 4_000_000    # line pairs per numpy batch

CACHE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cache")


# ---------------------------------------------------------------- geometry ---
def regular_pentagon():
    """Affine-regular pentagon in Q(√5): v(k+1) = (1/φ) v(k) − v(k−1)."""
    v = [(Q5(1), Q5(0)), (Q5(0), Q5(1))]
    for _ in range(3):
        (x1, y1), (x0, y0) = v[-1], v[-2]
        v.append((INV_PHI * x1 - x0, INV_PHI * y1 - y0))
    return v


# Linear map sending the affine pentagon to the true regular pentagon of
# circumradius 1 with a vertex at the top: v0=(1,0) -> u0, v1=(0,1) -> u1.
_U0 = (math.cos(math.radians(90)), math.sin(math.radians(90)))
_U1 = (math.cos(math.radians(162)), math.sin(math.radians(162)))


def to_true(p):
    x, y = float(p[0]), float(p[1])
    return (x * _U0[0] + y * _U1[0], x * _U0[1] + y * _U1[1])


def line_key(p, r):
    """Normalized exact line A x + B y = C through p and r (A or B equals 1)."""
    A = r[1] - p[1]
    B = p[0] - r[0]
    C = A * p[0] + B * p[1]
    lead = A if not A.is_zero() else B
    inv = lead.inv()
    return (A * inv, B * inv, C * inv)


def exact_cross(L1, L2):
    A1, B1, C1 = L1
    A2, B2, C2 = L2
    det = A1 * B2 - A2 * B1
    if det.is_zero():
        return None
    inv = det.inv()
    return ((C1 * B2 - B1 * C2) * inv, (A1 * C2 - C1 * A2) * inv)


def on_line(L, p):
    A, B, C = L
    return (A * p[0] + B * p[1] - C).is_zero()


def param_axis(L):
    """Coordinate that varies along line L (y for vertical lines, else x)."""
    return 1 if L[1].is_zero() else 0


def between(L, X, P, Q):
    """Exact: X (on line L) lies on the closed segment PQ (also on L)."""
    k = param_axis(L)
    s0 = (X[k] - P[k]).sign()
    s1 = (X[k] - Q[k]).sign()
    return s0 * s1 <= 0


def pentagram_core(layer):
    """The 5 crossing points of a pentagon's diagonals (cyclic order kept)."""
    out = []
    for i in range(5):
        d1 = line_key(layer[i], layer[(i + 2) % 5])
        d2 = line_key(layer[(i + 1) % 5], layer[(i + 3) % 5])
        out.append(exact_cross(d1, d2))
    return out


# ------------------------------------------------------------------- state ---
class State:
    """Points after a round."""

    def __init__(self):
        self.round = 0
        self.pts = []        # exact (x, y) in Q(√5), affine coordinates
        self.index = {}      # exact point -> index
        self.pf = np.zeros((0, 2))   # float true-regular coordinates
        self.birth = []      # round in which each point appeared
        self.layer = []      # pentagasket layer of each point, or -1
        self.layer_of = {}   # exact point -> layer, for layers not yet born

    def add(self, p, birth):
        self.index[p] = len(self.pts)
        self.pts.append(p)
        self.birth.append(birth)
        self.layer.append(self.layer_of.get(p, -1))


class Round:
    """What was drawn in a round and what it produced."""

    def __init__(self, k):
        self.k = k
        self.n_points = 0          # points after the round
        self.new_points = 0        # points created in the round
        self.new_points_ng = 0     # ... using only non-gasket segments
        self.ng_points = []        # indices of the new points that need no gasket segment
        self.segments = 0          # segments present (every pair of earlier points)
        self.gasket_segments = 0
        self.new_segments = 0      # segments added this round
        self.lines = []            # per line: dict (see step())
        self.n_directions = 0      # exact count of distinct line directions
        self.seconds = 0.0
        self.notes = []


def initial_state(max_layers=6):
    st = State()
    layers = [regular_pentagon()]
    for _ in range(max_layers):
        layers.append(pentagram_core(layers[-1]))
    for j, lay in enumerate(layers):
        for p in lay:
            st.layer_of[p] = j
    for p in layers[0]:
        st.add(p, 0)
    st.pf = np.array([to_true(p) for p in st.pts])
    return st


def round_zero(st):
    rd = Round(0)
    rd.n_points = rd.new_points = 5
    rd.segments = rd.gasket_segments = rd.new_segments = 5
    for i in range(5):
        a, b = i, (i + 1) % 5
        L = line_key(st.pts[a], st.pts[b])
        rd.lines.append(dict(key=L, pts=[a, b], ng=[], gasket_pairs=1))
    rd.n_directions = 5
    return rd


# -------------------------------------------------------------------- step ---
def _group_lines(st, joined_pairs):
    """Group joined point pairs by supporting line. Returns list of (key, set)."""
    lines = {}
    for i, j in joined_pairs:
        L = line_key(st.pts[i], st.pts[j])
        s = lines.get(L)
        if s is None:
            lines[L] = {i, j}
        else:
            s.add(i)
            s.add(j)
    return list(lines.items())


def _ng_intervals(order, layer, joined):
    """
    Union of non-gasket segments on one line, as (first, last) index pairs of
    maximal covered runs. `order` = point indices sorted along the line.
    A gap between consecutive points a, a+1 is covered if some joined
    non-gasket pair (u, v) has u <= a < v.
    """
    m = len(order)
    covered = [False] * (m - 1)
    for u in range(m):
        for v in range(u + 1, m):
            pu, pv = order[u], order[v]
            if (min(pu, pv), max(pu, pv)) not in joined:
                continue
            if layer[pu] >= 0 and layer[pu] == layer[pv]:
                continue
            for a in range(u, v):
                covered[a] = True
    runs, start = [], None
    for a in range(m - 1):
        if covered[a] and start is None:
            start = a
        if not covered[a] and start is not None:
            runs.append((order[start], order[a]))
            start = None
    if start is not None:
        runs.append((order[start], order[m - 1]))
    return runs


def step(st, k, log=print):
    """Run round k on state st (points after round k-1). Mutates st."""
    t0 = time.time()
    rd = Round(k)
    N = len(st.pts)

    # Segments present in round k: round 1 starts from the 5 sides only, but
    # from round 1 on every pair of earlier points is joined.
    all_pairs = list(combinations(range(N), 2))
    joined = set(all_pairs)
    rd.segments = len(all_pairs)
    rd.new_segments = rd.segments - (5 if k == 1 else math.comb(len([b for b in st.birth if b < k - 1]), 2))
    rd.gasket_segments = sum(1 for i, j in all_pairs if st.layer[i] >= 0 and st.layer[i] == st.layer[j])

    groups = _group_lines(st, all_pairs)
    Lc = len(groups)
    log(f"  round {k}: {N} points, {rd.segments} segments on {Lc} lines")

    # exact direction ids (parallel lines share an id)
    dir_ids = {}
    line_dir = np.empty(Lc, dtype=np.int64)
    keys, orders = [], []
    P0 = np.empty((Lc, 2))
    D = np.empty((Lc, 2))
    LEN = np.empty(Lc)
    ng_full = np.zeros(Lc, dtype=bool)
    ng_runs_f = {}     # line -> list of (t0, t1) for partially covered lines
    ng_runs = []
    pf = st.pf
    for li, (L, members) in enumerate(groups):
        keys.append(L)
        line_dir[li] = dir_ids.setdefault((L[0], L[1]), len(dir_ids))
        mem = list(members)
        # sort along the line by float parameter (points are well separated)
        a = pf[mem[0]]
        far = max(mem, key=lambda p: (pf[p][0] - a[0]) ** 2 + (pf[p][1] - a[1]) ** 2)
        d = pf[far] - a
        tt = [(pf[p] - a) @ d for p in mem]
        order = [p for _, p in sorted(zip(tt, mem))]
        orders.append(order)
        p0 = pf[order[0]]
        d = pf[order[-1]] - p0
        ln = math.hypot(d[0], d[1])
        P0[li], D[li], LEN[li] = p0, d / ln, ln
        has_gasket = any(st.layer[p] >= 0 for p in order) and \
            len({st.layer[p] for p in order if st.layer[p] >= 0}) < \
            sum(1 for p in order if st.layer[p] >= 0)
        if not has_gasket:
            ng_full[li] = True
            ng_runs.append([(order[0], order[-1])])
        else:
            runs = _ng_intervals(order, st.layer, joined)
            ng_runs.append(runs)
            ng_runs_f[li] = [((pf[u] - p0) @ D[li], (pf[v] - p0) @ D[li]) for u, v in runs]
    rd.n_directions = len(dir_ids)

    # incidence codes (line, old point) for exact confirmation of matches
    inc = np.sort(np.concatenate([np.array(o, dtype=np.int64) + li * N
                                  for li, o in enumerate(orders)]))

    def incident(lines_idx, pts_idx):
        codes = lines_idx.astype(np.int64) * N + pts_idx
        pos = np.searchsorted(inc, codes)
        pos = np.minimum(pos, len(inc) - 1)
        return inc[pos] == codes

    tree = cKDTree(pf)

    # ---- float pass over all line pairs --------------------------------
    cand_i, cand_j, cand_x, cand_ng = [], [], [], []
    exact_pairs = []          # (i, j) to be decided fully exactly
    iu_all = np.arange(Lc)
    i = 0
    n_pairs = Lc * (Lc - 1) // 2
    done = 0
    last_log = time.time()
    while i < Lc - 1:
        # batch rows i..i2 so that the batch has about CHUNK pairs
        rows, cnt, i2 = [], 0, i
        while i2 < Lc - 1 and cnt < CHUNK:
            cnt += Lc - 1 - i2
            i2 += 1
        I = np.concatenate([np.full(Lc - 1 - r, r) for r in range(i, i2)])
        J = np.concatenate([iu_all[r + 1:] for r in range(i, i2)])
        i = i2
        done += len(I)

        same_dir = line_dir[I] == line_dir[J]
        I, J = I[~same_dir], J[~same_dir]
        di, dj = D[I], D[J]
        cr = di[:, 0] * dj[:, 1] - di[:, 1] * dj[:, 0]
        shallow = np.abs(cr) < SHALLOW
        if shallow.any():
            exact_pairs.extend(zip(I[shallow].tolist(), J[shallow].tolist()))
            keep = ~shallow
            I, J, di, dj, cr = I[keep], J[keep], di[keep], dj[keep], cr[keep]
        w = P0[J] - P0[I]
        t = (w[:, 0] * dj[:, 1] - w[:, 1] * dj[:, 0]) / cr
        s = (w[:, 0] * di[:, 1] - w[:, 1] * di[:, 0]) / cr
        inside = (t >= -SPAN_TOL) & (t <= LEN[I] + SPAN_TOL) & \
                 (s >= -SPAN_TOL) & (s <= LEN[J] + SPAN_TOL)
        I, J, t, s, di = I[inside], J[inside], t[inside], s[inside], di[inside]
        X = P0[I] + t[:, None] * di

        # match to existing points
        dist, q = tree.query(X, distance_upper_bound=SNAP)
        near = np.isfinite(dist)
        qn = np.where(near, q, 0)
        confirmed = near & incident(I, qn) & incident(J, qn)
        # near an existing point that is not on both lines: decide exactly
        amb = near & ~confirmed
        if amb.any():
            exact_pairs.extend(zip(I[amb].tolist(), J[amb].tolist()))
        new = ~near
        I, J, t, s, X = I[new], J[new], t[new], s[new], X[new]

        ng = ng_full[I] & ng_full[J]
        part = ~ng
        if part.any():
            for n in np.nonzero(part)[0]:
                ng[n] = _in_runs_f(ng_runs_f, ng_full, I[n], t[n]) and \
                        _in_runs_f(ng_runs_f, ng_full, J[n], s[n])
        cand_i.append(I)
        cand_j.append(J)
        cand_x.append(X)
        cand_ng.append(ng)
        if time.time() - last_log > 10:
            log(f"    float pass {100 * done / n_pairs:5.1f}%")
            last_log = time.time()

    cand_i = np.concatenate(cand_i) if cand_i else np.zeros(0, dtype=np.int64)
    cand_j = np.concatenate(cand_j) if cand_j else np.zeros(0, dtype=np.int64)
    cand_x = np.concatenate(cand_x) if cand_x else np.zeros((0, 2))
    cand_ng = np.concatenate(cand_ng) if cand_ng else np.zeros(0, dtype=bool)
    log(f"    {len(cand_i)} crossing incidences at new points, "
        f"{len(exact_pairs)} line pairs decided exactly")

    # ---- cluster float crossings into points, then confirm exactly -----
    new_pts = {}     # exact point -> [set of lines, ng flag]

    def record(p, li, lj, ng):
        e = new_pts.get(p)
        if e is None:
            new_pts[p] = [{li, lj}, ng]
        else:
            e[0].add(li)
            e[0].add(lj)
            e[1] = e[1] or ng

    M = len(cand_i)
    if M:
        ctree = cKDTree(cand_x)
        pr = ctree.query_pairs(SNAP, output_type="ndarray")
        g = coo_matrix((np.ones(len(pr)), (pr[:, 0], pr[:, 1])), shape=(M, M)) if len(pr) else \
            coo_matrix((M, M))
        ncl, lab = connected_components(g, directed=False)
        order = np.argsort(lab, kind="stable")
        bounds = np.searchsorted(lab[order], np.arange(ncl + 1))
        n_split = 0
        for c in range(ncl):
            members = order[bounds[c]:bounds[c + 1]]
            m0 = members[0]
            li, lj = int(cand_i[m0]), int(cand_j[m0])
            X = exact_cross(keys[li], keys[lj])
            lines_here = set(cand_i[members].tolist()) | set(cand_j[members].tolist())
            if all(on_line(keys[l], X) for l in lines_here):
                p = X
                if p in st.index:
                    raise RuntimeError("float pass missed an existing point")
                ng = bool(cand_ng[members].any())
                e = new_pts.get(p)
                if e is None:
                    new_pts[p] = [lines_here, ng]
                else:
                    e[0] |= lines_here
                    e[1] = e[1] or ng
            else:
                n_split += 1
                for m in members:
                    a, b = int(cand_i[m]), int(cand_j[m])
                    record(exact_cross(keys[a], keys[b]), a, b, bool(cand_ng[m]))
        if n_split:
            rd.notes.append(f"{n_split} float clusters held distinct points and were split exactly")

    # ---- line pairs decided completely in exact arithmetic --------------
    for a, b in exact_pairs:
        X = exact_cross(keys[a], keys[b])
        if X is None or X in st.index:
            continue
        oa, ob = orders[a], orders[b]
        if not (between(keys[a], X, st.pts[oa[0]], st.pts[oa[-1]]) and
                between(keys[b], X, st.pts[ob[0]], st.pts[ob[-1]])):
            continue
        ng = any(between(keys[a], X, st.pts[u], st.pts[v]) for u, v in ng_runs[a]) and \
            any(between(keys[b], X, st.pts[u], st.pts[v]) for u, v in ng_runs[b])
        record(X, a, b, ng)

    # ---- commit new points ----------------------------------------------
    line_new = [[] for _ in range(Lc)]
    new_list = sorted(new_pts.items(), key=lambda kv: to_true(kv[0]))
    base = N
    for n, (p, (ls, ng)) in enumerate(new_list):
        st.add(p, k)
        if ng:
            rd.ng_points.append(base + n)
        for l in ls:
            line_new[l].append(base + n)
    st.pf = np.vstack([st.pf, np.array([to_true(p) for p, _ in new_list]).reshape(-1, 2)])
    st.round = k
    rd.new_points = len(new_list)
    rd.new_points_ng = len(rd.ng_points)
    rd.n_points = len(st.pts)

    # ---- per-line records (points sorted along each line) ---------------
    for li in range(Lc):
        pts_on = orders[li] + line_new[li]
        p0, d = P0[li], D[li]
        pts_on.sort(key=lambda p: (st.pf[p] - p0) @ d)
        gp = sum(1 for u, v in combinations(orders[li], 2)
                 if st.layer[u] >= 0 and st.layer[u] == st.layer[v])
        rd.lines.append(dict(key=keys[li], pts=pts_on, ng=ng_runs[li], gasket_pairs=gp))

    rd.seconds = time.time() - t0
    log(f"    -> {rd.new_points} new points ({rd.new_points_ng} without pentagasket), "
        f"{rd.n_points} total, {rd.seconds:.1f}s")
    return rd


def _in_runs_f(runs_f, full, li, t):
    if full[li]:
        return True
    return any(a - SPAN_TOL <= t <= b + SPAN_TOL for a, b in runs_f[li])


# ------------------------------------------------------------------ driver ---
def run(rounds, use_cache=True, log=print):
    """Return (states_points_by_round, rounds) for rounds 0..rounds."""
    os.makedirs(CACHE_DIR, exist_ok=True)
    st = initial_state()
    records = [round_zero(st)]
    for k in range(1, rounds + 1):
        path = os.path.join(CACHE_DIR, f"round_{k}.pkl")
        if use_cache and os.path.exists(path):
            with open(path, "rb") as f:
                st, rd = pickle.load(f)
            log(f"  round {k}: loaded from cache ({rd.n_points} points)")
        else:
            rd = step(st, k, log=log)
            with open(path, "wb") as f:
                pickle.dump((st, rd), f, protocol=pickle.HIGHEST_PROTOCOL)
        records.append(rd)
    return st, records


def main(argv):
    R = int(argv[1]) if len(argv) > 1 and argv[1].isdigit() else 2
    st, recs = run(R, use_cache="--fresh" not in argv)
    print("\nround  points  new  new(no gasket)  segments  gasket segs  lines  directions")
    for r in recs:
        print(f"{r.k:>5}  {r.n_points:>6}  {r.new_points:>5}  {r.new_points_ng:>14}  "
              f"{r.segments:>8}  {r.gasket_segments:>11}  {len(r.lines):>5}  {r.n_directions:>10}")


if __name__ == "__main__":
    # run through the imported module so cached pickles refer to `engine.State`
    import sys
    import engine
    engine.main(sys.argv)
