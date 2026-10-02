"""
The golden ratio in the nested pentagons (the pentagasket), checked exactly.

Every claim below is verified in exact Q(√5) arithmetic on the engine's
coordinates, not with decimals. The engine works in an affine image of the
regular pentagon; affine maps preserve ratios of lengths along one line and
between parallel segments, so the ratios checked there hold in the true
regular pentagon too.

Facts checked
  1. Each layer is the previous one scaled by −1/φ²: every vertex v of layer j
     maps to the vertex −v/φ² of layer j+1 (centre at the origin). As a linear
     map of the plane this is −(1/φ²)·I, so its eigenvalue is −1/φ² (twice),
     and after n layers it is (−1/φ²)^n: sizes shrink by φ², φ⁴, φ⁶, ...
  2. In every pentagon, diagonal / side = φ (a diagonal is parallel to a side).
  3. The two crossings on a diagonal cut it into pieces long : short : long
     with long / short = φ, and diagonal / (long + short) = φ (the golden cut).

Run:  python golden.py
"""
import math

from field import Q5
import engine

PHI = Q5(1, 1, 2)            # (1 + √5)/2
PHI2 = Q5(3, 1, 2)           # φ² = (3 + √5)/2
INV_PHI2 = Q5(3, -1, 2)      # 1/φ² = (3 − √5)/2
PHI_F = (1 + 5 ** 0.5) / 2
SIDE0 = 2 * math.sin(math.radians(36))   # side of the regular pentagon with circumradius 1


def pretty(q):
    """Exact a + b√5 over d as text, e.g. (3 + √5)/2."""
    a, b, d = q.a, q.b, q.d
    if b == 0:
        num = f"{a}"
    else:
        rt = "√5" if abs(b) == 1 else f"{abs(b)}√5"
        if a == 0:
            num = ("−" if b < 0 else "") + rt
        else:
            num = f"{a} {'+' if b > 0 else '−'} {rt}"
    num = num.replace("-", "−")
    if d == 1:
        return num
    return f"({num})/{d}" if (b != 0 and a != 0) else f"{num}/{d}"


def scalar_ratio(u, w):
    """Exact c with u = c·w for parallel vectors u, w, or None if not parallel."""
    k = 0 if not w[0].is_zero() else 1
    c = u[k] / w[k]
    if not (u[0] - c * w[0]).is_zero() or not (u[1] - c * w[1]).is_zero():
        return None
    return c


def sub(p, q):
    return (p[0] - q[0], p[1] - q[1])


def check_layer_map(layers, j):
    """Fact 1: layer j+1 is exactly −(1/φ²)·(layer j)."""
    nxt = set(layers[j + 1])
    return all((-(INV_PHI2 * v[0]), -(INV_PHI2 * v[1])) in nxt for v in layers[j])


def diagonal_side_ratio(L):
    """Fact 2: diagonal L0L2 is parallel to side L4L3; return their exact ratio."""
    return scalar_ratio(sub(L[2], L[0]), sub(L[3], L[4]))


def diagonal_pieces(L):
    """Fact 3: crossings of diagonal L0L2 with L1L3 and L1L4; exact piece ratios."""
    d = engine.line_key(L[0], L[2])
    p = engine.exact_cross(d, engine.line_key(L[1], L[4]))
    q = engine.exact_cross(d, engine.line_key(L[1], L[3]))
    # along the diagonal: L0, p, q, L2 (signed lengths as multiples of L2 − L0)
    full = sub(L[2], L[0])
    t = sorted([scalar_ratio(sub(p, L[0]), full), scalar_ratio(sub(q, L[0]), full)])
    long_, short = t[0], t[1] - t[0]
    return long_ / short, Q5(1) / t[1]


def facts(n_layers):
    """Everything the visualizer and the README report, for layers 0..n_layers-1."""
    st = engine.initial_state()
    layers = st.layers
    out = {"phi": PHI_F, "checks": [], "layers": [], "map": {}}

    maps_ok = all(check_layer_map(layers, j) for j in range(n_layers))
    out["checks"].append(dict(
        claim="Each nested pentagon is the previous one scaled by −1/φ² about the centre",
        exact=f"−1/φ² = −{pretty(INV_PHI2)}", value=-float(INV_PHI2), holds=maps_ok,
        detail=f"checked exactly for layers P0→P{n_layers}"))

    ratios = [diagonal_side_ratio(layers[j]) for j in range(n_layers)]
    same = all(r is not None and r == ratios[0] for r in ratios)
    out["checks"].append(dict(
        claim="Diagonal ÷ side in every pentagon",
        exact=f"φ = {pretty(ratios[0])}", value=float(ratios[0]), holds=same and ratios[0] == PHI,
        detail=f"same exact value in P0 … P{n_layers - 1}"))

    lr, dl = diagonal_pieces(layers[0])
    out["checks"].append(dict(
        claim="A diagonal is cut by the star into long : short : long, with long ÷ short",
        exact=f"φ = {pretty(lr)}", value=float(lr), holds=lr == PHI,
        detail="the two crossings are vertices of the next pentagon"))
    out["checks"].append(dict(
        claim="Whole diagonal ÷ (long + short)",
        exact=f"φ = {pretty(dl)}", value=float(dl), holds=dl == PHI,
        detail="the classic golden cut"))

    # measured on the computed vertices (true regular coordinates, circumradius 1)
    sides = []
    for j in range(n_layers + 1):
        T = [engine.to_true(p) for p in layers[j]]
        side = math.dist(T[0], T[1])
        diag = math.dist(T[0], T[2])
        radius = math.hypot(*T[0])
        # cross-check against the closed form side = 2 sin 36° / φ^(2j)
        assert abs(side - SIDE0 / PHI_F ** (2 * j)) < 1e-12
        sides.append(side)
        out["layers"].append(dict(
            layer=j, born=j, side=side, diagonal=diag, circumradius=radius,
            ratio_prev=sides[j - 1] / side if j else None, ratio_p0=sides[0] / side,
            ratio_p0_exact=("1" if j == 0 else f"φ^{2 * j}")))

    out["map"] = dict(
        matrix="−(1/φ²)·I (exact, in any coordinates)",
        eigenvalue=-float(INV_PHI2), eigenvalue_exact=f"−{pretty(INV_PHI2)}",
        powers=[dict(n=n, value=(-float(INV_PHI2)) ** n, exact=("1" if n == 0 else f"(−1)^{n}/φ^{2 * n}"))
                for n in range(0, n_layers + 2)])
    return out


if __name__ == "__main__":
    g = facts(4)
    print("φ =", g["phi"])
    print("\nExact checks in Q(√5):")
    for c in g["checks"]:
        print(f"  [{'ok' if c['holds'] else 'FAIL'}] {c['claim']}: {c['exact']} ≈ {c['value']:.9f}  ({c['detail']})")
    print("\nlayer  born   side        diagonal    circumradius  size vs previous  size vs P0")
    for L in g["layers"]:
        rp = f"{L['ratio_prev']:.6f} (φ²)" if L["ratio_prev"] else "–"
        print(f"  P{L['layer']}   r{L['born']}    {L['side']:.8f}  {L['diagonal']:.8f}  {L['circumradius']:.8f}    "
              f"{rp:<16}  {L['ratio_p0']:.6f} = {L['ratio_p0_exact']}")
    m = g["map"]
    print(f"\nOuter → inner map: {m['matrix']}, eigenvalue {m['eigenvalue_exact']} ≈ {m['eigenvalue']:.9f}")
    for p in m["powers"]:
        print(f"  after {p['n']} step(s): {p['exact']} ≈ {p['value']:.9f}")
