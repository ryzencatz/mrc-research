"""
Spectral and geometric analysis of the meta-intersecting regular pentagon.

For every round k it builds the planar arrangement graph of what was drawn:
  vertices = points after round k
  edges    = consecutive points along each drawn line, where a segment covers them
once with all segments ("with gasket") and once with the pentagasket segments
removed ("without gasket"). Then it measures:
  * graph: V, E, components, bounded faces (Euler check), degree distribution,
    face census by number of corners, Laplacian spectrum, which eigenvalues lie
    in Q(√5), i.e. are a + bφ with integers a, b (complete test via conjugates)
  * geometry (true regular coordinates): line directions, angles between lines
    at each point, segment lengths and which are φ-powers of the side, minimum
    distance between points.

Run:  python analysis.py [rounds]   -> results/*.csv and results/*.png
"""
import csv
import math
import os
import sys
from collections import Counter

import numpy as np
from scipy.sparse.csgraph import connected_components
from scipy.sparse import coo_matrix
from scipy.spatial import cKDTree

import engine

PHI = (1 + 5 ** 0.5) / 2
EIG_TOL = 1e-8
RESULTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "results")


# ------------------------------------------------------------------- graph ---
def arrangement(rd, n_pts, without_gasket):
    """Edges (u, v) and the line each edge lies on."""
    edges, edge_line = [], []
    for li, line in enumerate(rd.lines):
        pts = line["pts"]
        if not without_gasket:
            runs = [(0, len(pts) - 1)]
        else:
            pos = {p: i for i, p in enumerate(pts)}
            runs = [(pos[u], pos[v]) for u, v in line["ng"]]
        for a, b in runs:
            for i in range(a, b):
                edges.append((pts[i], pts[i + 1]))
                edge_line.append(li)
    E = np.array(edges, dtype=np.int64).reshape(-1, 2)
    return E, np.array(edge_line, dtype=np.int64)


def trace_faces(pf, E, edge_line):
    """
    Trace the faces of the plane graph. Returns a list of faces, each a dict
    with signed area, number of boundary vertices and number of corners
    (vertices where the boundary changes line). Bounded faces have area > 0.
    """
    nbrs = {}
    line_of = {}
    for (u, v), l in zip(E.tolist(), edge_line.tolist()):
        nbrs.setdefault(u, []).append(v)
        nbrs.setdefault(v, []).append(u)
        line_of[(u, v)] = line_of[(v, u)] = l
    # neighbours sorted counter-clockwise; rank lookup for "next" edge
    rank = {}
    for v, ns in nbrs.items():
        ns.sort(key=lambda w: math.atan2(pf[w][1] - pf[v][1], pf[w][0] - pf[v][0]))
        for i, w in enumerate(ns):
            rank[(v, w)] = i
    seen = set()
    faces = []
    for start in line_of:
        if start in seen:
            continue
        cyc = []
        u, v = start
        while (u, v) not in seen:
            seen.add((u, v))
            cyc.append((u, v))
            ns = nbrs[v]
            # turn: the neighbour just clockwise of u around v
            w = ns[(rank[(v, u)] - 1) % len(ns)]
            u, v = v, w
        area = 0.0
        corners = 0
        backtrack = False
        for i, (a, b) in enumerate(cyc):
            area += pf[a][0] * pf[b][1] - pf[b][0] * pf[a][1]
            nxt = cyc[(i + 1) % len(cyc)]
            if nxt[1] == a:
                backtrack = True
            if line_of[(a, b)] != line_of[nxt]:
                corners += 1
        faces.append(dict(area=area / 2, size=len(cyc), corners=corners, simple=not backtrack))
    return faces


def fmt_zphi(ab):
    if ab is None:
        return ""
    a, b = ab
    if b == 0:
        return f"{a}"
    bs = "φ" if b == 1 else "-φ" if b == -1 else f"{b}φ"
    if a == 0:
        return bs
    return f"{a}{'+' if b > 0 else '-'}{bs.lstrip('-')}"


def spectrum(n, E):
    """Laplacian eigenvalues (ascending) of the graph on the vertices it touches."""
    used = np.unique(E)
    if len(used) == 0:
        return np.zeros(0), used
    remap = -np.ones(n, dtype=np.int64)
    remap[used] = np.arange(len(used))
    m = len(used)
    L = np.zeros((m, m))
    a, b = remap[E[:, 0]], remap[E[:, 1]]
    L[a, b] -= 1
    L[b, a] -= 1
    L[np.arange(m), np.arange(m)] = -L.sum(axis=1)
    assert np.allclose(L.sum(axis=1), 0)
    return np.linalg.eigvalsh(L), used


def group_eigs(ev):
    """
    [(value, multiplicity, (a, b) or None)] for distinct eigenvalues.

    Laplacian eigenvalues are algebraic integers, and the characteristic
    polynomial has integer coefficients. So an eigenvalue in Q(√5) is a + bφ
    with integers a, b, and its conjugate a + bφ' (φ' = 1 − φ) is an eigenvalue
    with the same multiplicity. Searching for that partner is a complete test,
    with no bound on a and b.
    """
    out = []
    for x in ev:
        if out and abs(x - out[-1][0]) < 1e-7:
            out[-1][1] += 1
        else:
            out.append([x, 1])
    vals = np.array([v for v, _ in out])
    mult = np.array([m for _, m in out])
    res = []
    for v, m in out:
        ab = None
        if abs(v - round(v)) < EIG_TOL:
            ab = (round(v), 0)
        else:
            b = (v - vals) / 5 ** 0.5
            s = v + vals
            ok = (np.abs(b - np.round(b)) < EIG_TOL) & (np.round(b) != 0) & \
                 (np.abs(s - np.round(s)) < EIG_TOL) & (mult == m)
            if ok.any():
                bb = int(round(b[np.nonzero(ok)[0][0]]))
                ab = (round(v - bb * PHI), bb)
        res.append((v, m, ab))
    return res


def graph_stats(pf, rd, n, without_gasket):
    E, el = arrangement(rd, n, without_gasket)
    if len(E) == 0:
        return dict(V=0, E=0, C=0, F=0, euler_ok=True, degrees={}, faces={}, nonsimple=0,
                    eigs=[], lambda2=0.0, lambda_min_nonzero=0.0, lambda_max=0.0, zphi_count=0, int_count=0, n_eigs=0)
    used = np.unique(E)
    V = len(used)
    g = coo_matrix((np.ones(len(E)), (E[:, 0], E[:, 1])), shape=(n, n))
    C = connected_components(g, directed=False)[0] - (n - V)   # drop isolated points
    faces = trace_faces(pf, E, el)
    bounded = [f for f in faces if f["area"] > 1e-15]
    F = len(bounded)
    deg = Counter(Counter(E.ravel().tolist()).values())
    ev, _ = spectrum(n, E)
    groups = group_eigs(ev)
    zc = sum(m for v, m, ab in groups if ab is not None and ab[1] != 0)
    ic = sum(m for v, m, ab in groups if ab is not None and ab[1] == 0)
    nz = ev[ev > 1e-9]
    return dict(
        V=V, E=len(E), C=C, F=F, euler_ok=(V - len(E) + F == C),
        degrees=dict(sorted(deg.items())),
        faces=dict(sorted(Counter(f["corners"] for f in bounded if f["simple"]).items())),
        nonsimple=sum(1 for f in bounded if not f["simple"]),
        eigs=groups, lambda2=float(ev[1]) if len(ev) > 1 else 0.0,
        lambda_min_nonzero=float(nz.min()) if len(nz) else 0.0,
        lambda_max=float(ev[-1]), zphi_count=zc, int_count=ic, n_eigs=len(ev),
    )


# ---------------------------------------------------------------- geometry ---
def geometry_stats(pf, rd, n_prev, n):
    side = float(np.linalg.norm(pf[0] - pf[1]))
    # line directions in degrees, mod 180
    dirs = []
    for line in rd.lines:
        a, b = pf[line["pts"][0]], pf[line["pts"][-1]]
        dirs.append(math.degrees(math.atan2(b[1] - a[1], b[0] - a[0])) % 180.0)
    dirs = np.array(dirs)
    dirs[np.isclose(dirs, 180.0)] = 0.0
    uniq = np.unique(np.round(dirs, 9))
    mult18 = np.isclose(uniq / 18.0, np.round(uniq / 18.0), atol=1e-9)

    # angles between consecutive lines through each point
    at_point = {}
    for li, line in enumerate(rd.lines):
        for p in line["pts"]:
            at_point.setdefault(p, []).append(dirs[li])
    gaps, min_at = [], []
    for p, ds in at_point.items():
        if len(ds) < 2:
            continue
        ds = np.sort(np.array(ds))
        g = np.diff(np.append(ds, ds[0] + 180.0))
        gaps.extend(g.tolist())
        min_at.append(g.min())
    gaps = np.array(gaps)

    # segments drawn this round: every pair of the previous round's points
    P = pf[:n_prev]
    i, j = np.triu_indices(n_prev, 1)
    lens = np.linalg.norm(P[i] - P[j], axis=1) / side
    e = np.log(lens) / math.log(PHI)
    phi_pow = np.isclose(e, np.round(e), atol=1e-9)

    tree = cKDTree(pf[:n])
    d, _ = tree.query(pf[:n], k=2)
    return dict(
        line_dirs=dirs, n_dir=len(uniq), n_dir_mult18=int(mult18.sum()),
        angle_gaps=gaps, min_angle=float(gaps.min()) if len(gaps) else 0.0,
        seg_lengths=lens, n_lengths=len(np.unique(np.round(lens, 9))),
        phi_power_segments=int(phi_pow.sum()),
        phi_power_values=sorted({int(x) for x in np.round(e[phi_pow])}),
        min_dist=float(d[:, 1].min()),
    )


# ----------------------------------------------------------------- analyze ---
def analyze(st, recs, log=print):
    pf = st.pf
    out = []
    for rd in recs:
        k = rd.k
        n = rd.n_points
        n_prev = n - rd.new_points if k > 0 else 5
        log(f"  analysing round {k} ({n} points)")
        res = dict(k=k, counts=dict(points=n, new=rd.new_points, new_ng=rd.new_points_ng,
                                    segments=rd.segments, gasket_segments=rd.gasket_segments,
                                    new_segments=rd.new_segments, lines=len(rd.lines),
                                    directions=rd.n_directions))
        res["with"] = graph_stats(pf, rd, n, without_gasket=False)
        res["without"] = graph_stats(pf, rd, n, without_gasket=True)
        res["geom"] = geometry_stats(pf, rd, n_prev, n)
        out.append(res)
    return out


# ------------------------------------------------------------------ output ---
LIGHT = dict(surface="#fcfcfb", ink="#0b0b0b", ink2="#52514e", muted="#898781",
             grid="#e1e0d9", axis="#c3c2b7", s1="#2a78d6", s2="#eb6834")


def _style(ax):
    ax.set_facecolor(LIGHT["surface"])
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)
    for side in ("left", "bottom"):
        ax.spines[side].set_color(LIGHT["axis"])
    ax.tick_params(colors=LIGHT["muted"], labelsize=9)
    ax.grid(axis="y", color=LIGHT["grid"], linewidth=0.8)
    ax.set_axisbelow(True)
    ax.title.set_color(LIGHT["ink"])
    ax.xaxis.label.set_color(LIGHT["ink2"])
    ax.yaxis.label.set_color(LIGHT["ink2"])


def write_csv(results):
    os.makedirs(RESULTS, exist_ok=True)
    with open(os.path.join(RESULTS, "summary.csv"), "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["round", "points", "new_points", "new_points_without_gasket", "segments",
                    "gasket_segments", "lines", "directions", "directions_multiple_of_18deg",
                    "graph", "V", "E", "components", "bounded_faces", "euler_ok",
                    "lambda2", "lambda_max", "eigs_in_Zphi_irrational", "eigs_integer", "n_eigs",
                    "min_angle_deg", "min_point_distance", "distinct_segment_lengths",
                    "phi_power_segments"])
        for r in results:
            c, g = r["counts"], r["geom"]
            for name in ("with", "without"):
                s = r[name]
                w.writerow([r["k"], c["points"], c["new"], c["new_ng"], c["segments"],
                            c["gasket_segments"], c["lines"], c["directions"], g["n_dir_mult18"],
                            name + "_gasket", s["V"], s["E"], s["C"], s["F"], s["euler_ok"],
                            f"{s['lambda2']:.10g}", f"{s['lambda_max']:.10g}",
                            s["zphi_count"], s["int_count"], s["n_eigs"],
                            f"{g['min_angle']:.10g}", f"{g['min_dist']:.10g}",
                            g["n_lengths"], g["phi_power_segments"]])
    with open(os.path.join(RESULTS, "faces.csv"), "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["round", "graph", "corners", "faces"])
        for r in results:
            for name in ("with", "without"):
                for c, m in r[name]["faces"].items():
                    w.writerow([r["k"], name + "_gasket", c, m])
                if r[name]["nonsimple"]:
                    w.writerow([r["k"], name + "_gasket", "non-simple", r[name]["nonsimple"]])
    with open(os.path.join(RESULTS, "degrees.csv"), "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["round", "graph", "degree", "vertices"])
        for r in results:
            for name in ("with", "without"):
                for d, m in r[name]["degrees"].items():
                    w.writerow([r["k"], name + "_gasket", d, m])
    for r in results:
        for name in ("with", "without"):
            with open(os.path.join(RESULTS, f"spectrum_round{r['k']}_{name}_gasket.csv"), "w",
                      newline="") as f:
                w = csv.writer(f)
                w.writerow(["eigenvalue", "multiplicity", "in_Z[phi]_as_a+b*phi"])
                for v, m, ab in r[name]["eigs"]:
                    w.writerow([f"{v:.12f}", m, fmt_zphi(ab)])
        g = r["geom"]
        with open(os.path.join(RESULTS, f"directions_round{r['k']}.csv"), "w", newline="") as f:
            w = csv.writer(f)
            w.writerow(["direction_deg_mod_180", "lines"])
            for v, m in sorted(Counter(np.round(g["line_dirs"], 6).tolist()).items()):
                w.writerow([v, m])


def write_charts(results):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    plt.rcParams.update({"font.family": ["Helvetica", "Arial", "DejaVu Sans"],
                         "figure.facecolor": LIGHT["surface"], "savefig.facecolor": LIGHT["surface"]})
    rounds = [r["k"] for r in results]

    # 1. growth: new points per round, with vs without gasket
    fig, ax = plt.subplots(figsize=(6.4, 4))
    x = np.arange(len(rounds))
    wv = [r["counts"]["new"] for r in results]
    nv = [r["counts"]["new_ng"] for r in results]
    ax.bar(x - 0.19, wv, 0.36, color=LIGHT["s1"], label="With pentagasket")
    ax.bar(x + 0.19, nv, 0.36, color=LIGHT["s2"], label="Without pentagasket")
    for xi, a, b in zip(x, wv, nv):
        ax.text(xi - 0.19, a * 1.15 if a else 0.08, f"{a}", ha="center", fontsize=8, color=LIGHT["ink2"])
        ax.text(xi + 0.19, b * 1.15 if b else 0.08, f"{b}", ha="center", fontsize=8, color=LIGHT["ink2"])
    ax.set_yscale("symlog", linthresh=1)
    ax.set_xticks(x, [f"Round {k}" for k in rounds])
    ax.set_ylabel("New intersection points (log)")
    ax.set_title("New intersections per round", loc="left", fontsize=12)
    ax.legend(frameon=False, fontsize=9, labelcolor=LIGHT["ink2"])
    _style(ax)
    fig.tight_layout()
    fig.savefig(os.path.join(RESULTS, "growth.png"), dpi=160)
    plt.close(fig)

    # 2. line directions, one small multiple per round
    later = [r for r in results if r["k"] >= 1]
    fig, axes = plt.subplots(1, len(later), figsize=(3.4 * len(later), 3), sharey=False)
    axes = np.atleast_1d(axes)
    for ax, r in zip(axes, later):
        ax.hist(r["geom"]["line_dirs"], bins=np.arange(0, 181, 2), color=LIGHT["s1"])
        ax.set_title(f"Round {r['k']}: {r['geom']['n_dir']} directions", loc="left", fontsize=10)
        ax.set_xticks(range(0, 181, 36))
        ax.set_xlabel("Line direction (deg, mod 180)")
        _style(ax)
    axes[0].set_ylabel("Lines")
    fig.tight_layout()
    fig.savefig(os.path.join(RESULTS, "directions.png"), dpi=160)
    plt.close(fig)

    # 3. angles between neighbouring lines at each point
    fig, axes = plt.subplots(1, len(later), figsize=(3.4 * len(later), 3))
    axes = np.atleast_1d(axes)
    for ax, r in zip(axes, later):
        ax.hist(r["geom"]["angle_gaps"], bins=np.arange(0, 181, 3), color=LIGHT["s1"])
        ax.set_title(f"Round {r['k']}: min {r['geom']['min_angle']:.3g}°", loc="left", fontsize=10)
        ax.set_xlabel("Angle between adjacent lines (deg)")
        ax.set_xticks(range(0, 181, 36))
        _style(ax)
    axes[0].set_ylabel("Angles")
    fig.tight_layout()
    fig.savefig(os.path.join(RESULTS, "angles.png"), dpi=160)
    plt.close(fig)

    # 4. face census per round, with vs without gasket
    fig, axes = plt.subplots(1, len(later), figsize=(3.4 * len(later), 3))
    axes = np.atleast_1d(axes)
    for ax, r in zip(axes, later):
        ks = sorted(set(r["with"]["faces"]) | set(r["without"]["faces"]))
        xx = np.arange(len(ks))
        ax.bar(xx - 0.2, [r["with"]["faces"].get(c, 0) for c in ks], 0.38, color=LIGHT["s1"],
               label="With pentagasket")
        ax.bar(xx + 0.2, [r["without"]["faces"].get(c, 0) for c in ks], 0.38, color=LIGHT["s2"],
               label="Without")
        ax.set_xticks(xx, [str(c) for c in ks])
        ax.set_xlabel("Corners per face")
        ax.set_title(f"Round {r['k']} faces", loc="left", fontsize=10)
        _style(ax)
    axes[0].set_ylabel("Faces")
    axes[0].legend(frameon=False, fontsize=8, labelcolor=LIGHT["ink2"])
    fig.tight_layout()
    fig.savefig(os.path.join(RESULTS, "faces.png"), dpi=160)
    plt.close(fig)

    # 5. Laplacian spectra: sorted eigenvalues, Z[φ] ones highlighted
    fig, axes = plt.subplots(1, len(later), figsize=(3.4 * len(later), 3))
    axes = np.atleast_1d(axes)
    for ax, r in zip(axes, later):
        vals, cols = [], []
        for v, m, ab in r["with"]["eigs"]:
            for _ in range(m):
                vals.append(v)
                cols.append(LIGHT["s2"] if ab is not None and ab[1] != 0 else LIGHT["s1"])
        ax.scatter(np.arange(len(vals)), vals, s=8 if len(vals) < 100 else 3, c=cols, linewidths=0)
        ax.set_title(f"Round {r['k']}: {r['with']['zphi_count']} of {len(vals)} in Z[φ]∖Z",
                     loc="left", fontsize=10)
        ax.set_xlabel("Index (ascending)")
        _style(ax)
    axes[0].set_ylabel("Laplacian eigenvalue")
    from matplotlib.lines import Line2D
    axes[0].legend(handles=[Line2D([], [], marker="o", ls="", color=LIGHT["s2"], label="a + bφ, b ≠ 0"),
                            Line2D([], [], marker="o", ls="", color=LIGHT["s1"], label="other")],
                   frameon=False, fontsize=8, labelcolor=LIGHT["ink2"])
    fig.tight_layout()
    fig.savefig(os.path.join(RESULTS, "spectrum.png"), dpi=160)
    plt.close(fig)


def print_summary(results):
    print("\nround graph    V     E    C     F  euler  λ2         λmax      Z[φ]∖Z  integer")
    for r in results:
        for name in ("with", "without"):
            s = r[name]
            print(f"{r['k']:>5} {name:<7} {s['V']:>4} {s['E']:>5} {s['C']:>4} {s['F']:>5}  "
                  f"{'ok' if s['euler_ok'] else 'FAIL':<5}  {s['lambda2']:<9.5f}  {s['lambda_max']:<8.5f}  "
                  f"{s['zphi_count']:>6}  {s['int_count']:>7}")
    print("\nround  directions (×18°)  min angle    min dist     lengths  φ-power segs (exponents)")
    for r in results:
        g = r["geom"]
        print(f"{r['k']:>5}  {g['n_dir']:>5} ({g['n_dir_mult18']:>3})       {g['min_angle']:<11.5g}  "
              f"{g['min_dist']:<11.5g}  {g['n_lengths']:>6}  {g['phi_power_segments']} {g['phi_power_values']}")


if __name__ == "__main__":
    R = int(sys.argv[1]) if len(sys.argv) > 1 else 3
    st, recs = engine.run(R)
    results = analyze(st, recs)
    write_csv(results)
    write_charts(results)
    print_summary(results)
    print(f"\nWrote CSV files and charts to {RESULTS}")
