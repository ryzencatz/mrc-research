# Meta-intersecting regular pentagon (v2)

Start with a regular pentagon. In each round, join every pair of points with a segment, then make every crossing a new point.
This project computes rounds 0–3 **exactly** and includes a browser visualizer plus spectral and geometry analysis.

## Run

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python export.py          # compute rounds 0-3, write web/data.js
open web/index.html                 # visualizer (no server needed)
.venv/bin/python analysis.py        # results/*.csv and results/*.png
.venv/bin/python verify.py          # independent brute-force check of the counts
```

Rounds are cached in `cache/`. Delete it, or pass `--fresh` to `export.py`, after changing the rules.
Views can be linked with a URL hash, for example `web/index.html#round=3&gasket=0`.

## Rules used

- **Round 0** is the 5 vertices and the 5 sides.
- **Round k** joins every pair of points. Collinear points share one segment ("merged segments"): every line through two or more points carries a single segment from its first point to its last.
  Any crossing of two segments that is not already a point becomes a new point.
  Points made in a round are only joined in the next round.
- **Pentagasket.** Layer P0 is the pentagon. Layer P(j+1) is the 5 crossings of P(j)'s diagonals, so each layer is φ² smaller and rotated 36°.
  Round k creates layer Pk. A *gasket segment* lies along a side or diagonal of one of these layers.
- **"Without pentagasket"** recounts a round's crossings with the gasket segments removed entirely, on the same point set.
  The actual process always uses all segments.

## Files

| File | What it does |
|---|---|
| `field.py` | Exact numbers a + b√5 (canonical, hashable) |
| `engine.py` | The rounds. Uses an affine image of the regular pentagon with coordinates in Q(√5). Every incidence is decided exactly; floats are only a pre-filter. |
| `verify.py` | Brute force that tests every segment pair exactly and must agree with `engine.py` |
| `analysis.py` | Builds the arrangement graph (Euler check, faces, degrees, Laplacian spectrum, test for eigenvalues in Q(√5)) and computes geometry (directions, angles, lengths, φ-powers) |
| `export.py` | Writes `web/data.js` for the visualizer |
| `web/` | Visualizer: rounds, pentagasket toggle, zoom/pan, counts table, stats panel |

## Results so far (rounds 0–3)

| Round | Points | New (with gasket) | New (without) | Segments | Gasket segments | Directions |
|---|---|---|---|---|---|---|
| 0 | 5 | – | – | 5 | 5 | 5 |
| 1 | 10 | 5 | 0 | 10 | 10 | 5 |
| 2 | 26 | 16 | 1 | 20 | 15 | 10 |
| 3 | 741 | 715 | 625 | 100 | 20 | 50 |

- **Symmetry.** New-point counts respect the 5-fold symmetry: 5, 15 + the centre, and 715 = 5 × 143.
- **Growth.** It looks doubly exponential. Round 4 joins C(741, 2) = 274,170 pairs of points.
  Merging collinear pairs leaves an estimated ~250,000 segments, and probably a few billion new points, which is beyond this engine.
- **Directions.** All directions are multiples of 18° up to round 2. Round 3 adds 40 new directions.
  The smallest angle drops 36° → 18° → 1.8°, and the closest pair of points goes 0.449 → 0.0858 → 0.00417.
- **φ in the Laplacian spectrum.** With the gasket, the eigenvalues are in Q(√5) only for rounds 0 and 1, for example 5 − 2φ and 3 + 2φ.
  From round 2 on, no eigenvalue except 0 lies in Q(√5).
  Without the gasket, round 2 is just the 5 symmetry axes (all 26 points lie on them), a tree whose spectrum includes 2 − φ and 1 + φ.
  The test is complete: it pairs each eigenvalue a + bφ with its conjugate a + bφ′.
- **Faces.** Round 2 with the gasket consists only of triangles (45 of them). Quadrilaterals first appear in round 3.
