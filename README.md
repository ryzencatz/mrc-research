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
- **Round k** joins every pair of points that is not already joined. Each pair is its own segment ("separate segments").
  Any crossing of two segments that is not already a point becomes a new point. Collinear or overlapping segments never create points.
- **Pentagasket.** Layer P0 is the pentagon. Layer P(j+1) is the 5 crossings of P(j)'s diagonals. A *gasket segment* has both endpoints in the same layer.
- **"Without pentagasket"** recounts a round's crossings using only non-gasket segments, on the same point set.
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

| Round | Points | New (with gasket) | New (without) | Segments | Lines | Directions |
|---|---|---|---|---|---|---|
| 0 | 5 | – | – | 5 | 5 | 5 |
| 1 | 10 | 5 | 0 | 10 | 10 | 5 |
| 2 | 26 | 16 | 6 | 45 | 20 | 10 |
| 3 | 741 | 715 | 675 | 325 | 100 | 50 |

- **Symmetry.** New-point counts respect the 5-fold symmetry: 5, 15 + the centre, and 715 = 5 × 143.
- **Growth.** It looks doubly exponential. Round 4 would draw C(741, 2) = 273,870 segments, which is beyond this engine.
- **Directions.** All directions are multiples of 18° up to round 2. Round 3 adds 40 new directions.
  The smallest angle drops 36° → 18° → 1.8°, and the closest pair of points goes 0.449 → 0.0858 → 0.00417.
- **φ in the Laplacian spectrum.** The eigenvalues are in Q(√5) only for rounds 0 and 1, for example 5 − 2φ and 3 + 2φ.
  From round 2 on, no eigenvalue except 0 lies in Q(√5). The test is complete: it pairs each eigenvalue a + bφ with its conjugate a + bφ′.
- **Faces.** Round 2's arrangement consists only of triangles: 45 with the gasket and 20 without. Quadrilaterals first appear in round 3.
