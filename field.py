"""
Exact arithmetic in the field Q(sqrt5).

A number is stored as (a + b*sqrt5) / d with integers a, b, d, d > 0 and
gcd(a, b, d) = 1. That form is canonical, so two equal numbers always have the
same (a, b, d) and can be used directly as dictionary keys.
"""
from math import gcd, sqrt

SQRT5 = sqrt(5)


class Q5:
    __slots__ = ("a", "b", "d")

    def __init__(self, a=0, b=0, d=1):
        if d < 0:
            a, b, d = -a, -b, -d
        g = gcd(a, b, d)
        if g > 1:
            a, b, d = a // g, b // g, d // g
        self.a, self.b, self.d = a, b, d

    # ---- arithmetic -------------------------------------------------------
    def __add__(self, o):
        if isinstance(o, int):
            return Q5(self.a + o * self.d, self.b, self.d)
        return Q5(self.a * o.d + o.a * self.d, self.b * o.d + o.b * self.d, self.d * o.d)

    __radd__ = __add__

    def __sub__(self, o):
        if isinstance(o, int):
            return Q5(self.a - o * self.d, self.b, self.d)
        return Q5(self.a * o.d - o.a * self.d, self.b * o.d - o.b * self.d, self.d * o.d)

    def __rsub__(self, o):
        return Q5(o * self.d - self.a, -self.b, self.d)

    def __neg__(self):
        return Q5(-self.a, -self.b, self.d)

    def __mul__(self, o):
        if isinstance(o, int):
            return Q5(self.a * o, self.b * o, self.d)
        return Q5(self.a * o.a + 5 * self.b * o.b, self.a * o.b + self.b * o.a, self.d * o.d)

    __rmul__ = __mul__

    def inv(self):
        # 1 / ((a + b√5)/d) = d (a - b√5) / (a² - 5b²)
        n = self.a * self.a - 5 * self.b * self.b
        if n == 0:
            raise ZeroDivisionError("Q5 division by zero")
        return Q5(self.d * self.a, -self.d * self.b, n)

    def __truediv__(self, o):
        if isinstance(o, int):
            return Q5(self.a, self.b, self.d * o)
        return self * o.inv()

    # ---- comparison -------------------------------------------------------
    def is_zero(self):
        return self.a == 0 and self.b == 0

    def sign(self):
        """Exact sign of a + b√5 (d > 0 so it does not matter)."""
        a, b = self.a, self.b
        sa = (a > 0) - (a < 0)
        sb = (b > 0) - (b < 0)
        if sb == 0:
            return sa
        if sa == 0 or sa == sb:
            return sb
        # opposite signs: compare a² with 5b²
        diff = a * a - 5 * b * b
        return sa if diff > 0 else sb

    def __eq__(self, o):
        if isinstance(o, int):
            return self.b == 0 and self.d == 1 and self.a == o
        return self.a == o.a and self.b == o.b and self.d == o.d

    def __hash__(self):
        return hash((self.a, self.b, self.d))

    def __lt__(self, o):
        return (self - o).sign() < 0

    def __float__(self):
        return (self.a + self.b * SQRT5) / self.d

    def key(self):
        return (self.a, self.b, self.d)

    def __repr__(self):
        if self.b == 0:
            s = f"{self.a}"
        else:
            s = f"{self.a}{'+' if self.b >= 0 else '-'}{abs(self.b)}√5"
        return s if self.d == 1 else f"({s})/{self.d}"


ZERO = Q5(0)
ONE = Q5(1)
INV_PHI = Q5(-1, 1, 2)   # 1/φ = (√5 − 1)/2 = 2cos72°
PHI = Q5(1, 1, 2)        # φ = (1 + √5)/2
