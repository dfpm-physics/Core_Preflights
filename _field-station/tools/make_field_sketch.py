#!/usr/bin/env python3
"""Draw the electric field of two equal and opposite point charges as a fine-line SVG.

The lines are not traced from a picture. Each one is integrated from the real field of a
positive charge at the left and a negative charge at the right (Coulomb, two dimensions of the
plane through both charges). A line leaves the plus charge, follows the field, and either ends on
the minus charge or runs off the edge of the drawing. Arrows sit along each line and point the
way a positive test charge would be pushed, which is the direction of travel, away from plus and
toward minus.

Nothing here implies a measurement: there is no scale, no number and no label. Line spacing near
a charge is equal in angle, so the density suggests strength without stating one.

Writes (stdlib only):
  _field-station/site/fs/sketches/dipole-light.svg
  _field-station/site/fs/sketches/dipole-dark.svg

Run from the repo root:   python _field-station/tools/make_field_sketch.py
Check it:                 python _field-station/tools/test_make_field_sketch.py
"""

import math
from pathlib import Path

W, H = 560.0, 320.0                # drawing box
CX, CY = W / 2, H / 2
D = 118.0                          # charge sits this far from the centre, left and right
PLUS = (CX - D, CY)
MINUS = (CX + D, CY)
R_CHARGE = 13.0                    # drawn radius of each charge
LINES = 32                         # lines leaving the plus charge (and, mirrored, entering the minus charge)
STEP = 1.6                         # integration step, drawing units
MAX_STEPS = 2600
INK = {"light": "#2a2019", "dark": "#e9dfcb"}
PAPER = {"light": "#fbf8f1", "dark": "#1d2326"}


def field(x, y):
    """Unit-strength field of +1 at PLUS and -1 at MINUS, evaluated at (x, y). Returns (Ex, Ey)."""
    ex = ey = 0.0
    for (qx, qy), q in ((PLUS, 1.0), (MINUS, -1.0)):
        dx, dy = x - qx, y - qy
        r2 = dx * dx + dy * dy
        r3 = r2 * math.sqrt(r2)
        ex += q * dx / r3
        ey += q * dy / r3
    return ex, ey


def _dir(x, y, sign=1.0):
    ex, ey = field(x, y)
    m = math.hypot(ex, ey)
    return sign * ex / m, sign * ey / m


def _rk4(x, y, h, sign=1.0):
    """One step of length h along the field direction (sign -1: against it, for tracing back from minus)."""
    k1 = _dir(x, y, sign)
    k2 = _dir(x + h / 2 * k1[0], y + h / 2 * k1[1], sign)
    k3 = _dir(x + h / 2 * k2[0], y + h / 2 * k2[1], sign)
    k4 = _dir(x + h * k3[0], y + h * k3[1], sign)
    return (x + h / 6 * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]),
            y + h / 6 * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]))


class Line:
    """pts runs in the direction of travel (the direction a positive test charge is pushed).
    back is True for a line traced backward from the minus charge: it is stored reversed, so it still runs
    toward minus, and `origin` keeps the order it was traced in (outward from minus)."""
    def __init__(self, pts, back):
        self.back = back
        self.origin = pts
        self.pts = pts[::-1] if back else pts


def trace(angle, back=False):
    """Integrate one line outward from a charge: with the field from plus, or against it from minus."""
    c = MINUS if back else PLUS
    sign = -1.0 if back else 1.0
    other = PLUS if back else MINUS
    x = c[0] + R_CHARGE * math.cos(angle)
    y = c[1] + R_CHARGE * math.sin(angle)
    pts = [(x, y)]
    for _ in range(MAX_STEPS):
        x, y = _rk4(x, y, STEP, sign)
        pts.append((x, y))
        if math.hypot(x - other[0], y - other[1]) <= R_CHARGE:
            break
        if not (-6 <= x <= W + 6 and -6 <= y <= H + 6):
            break
    return Line(pts, back)


def reaches_other(line):
    c = PLUS if line.back else MINUS
    x, y = line.origin[-1]
    return math.hypot(x - c[0], y - c[1]) <= R_CHARGE + 0.5


def all_lines():
    """Every line leaving plus, and every line entering minus that does not just run into plus (those
    are already drawn from the other end). The two sets are mirror images of each other."""
    angles = [2 * math.pi * (i + 0.5) / LINES for i in range(LINES)]
    out = [trace(a) for a in angles]
    out += [l for l in (trace(a, back=True) for a in angles) if not reaches_other(l)]
    return out


def _arc_points(pts, every):
    """Indices along a polyline roughly `every` units of path length apart, starting part-way in."""
    out, acc, next_at = [], 0.0, every * 0.5
    for i in range(1, len(pts)):
        acc += math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
        if acc >= next_at:
            out.append(i)
            next_at += every
    return out


def _inside(x, y, pad=10):
    return pad <= x <= W - pad and pad <= y <= H - pad


def arrows(lines):
    """(x, y, angle_degrees) for every arrowhead. The angle is the line's own direction of travel.
    A line entering minus is measured from the minus end, so its arrowheads mirror those of the plus side."""
    out = []
    for line in lines:
        pts = line.origin
        n = len(pts)
        length = sum(math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]) for i in range(1, n))
        every = 105.0 if length > 330 else 190.0
        for i in _arc_points(pts, every):
            if i + 1 >= n or not _inside(*pts[i]):
                continue
            # keep arrowheads off the charges
            if min(math.hypot(pts[i][0] - c[0], pts[i][1] - c[1]) for c in (PLUS, MINUS)) < R_CHARGE + 12:
                continue
            a, b = pts[i - 1], pts[i + 1]
            ang = math.degrees(math.atan2(b[1] - a[1], b[0] - a[0]))
            out.append((pts[i][0], pts[i][1], ang + 180.0 if line.back else ang))
    return out


def _path(pts):
    # decimate: every 3rd point keeps the curve smooth and the file small
    keep = pts[::3] + ([pts[-1]] if (len(pts) - 1) % 3 else [])
    return "M" + " L".join(f"{x:.1f},{y:.1f}" for x, y in keep)


def _charge(cx, cy, sign, ink, paper):
    r = R_CHARGE
    s = r * 0.5
    bar = f'<path d="M{cx - s:.1f},{cy:.1f} H{cx + s:.1f}" />'
    if sign > 0:
        bar += f'<path d="M{cx:.1f},{cy - s:.1f} V{cy + s:.1f}" />'
    return (f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="{r:.1f}" fill="{paper}" stroke="{ink}" stroke-width="1.4"/>'
            f'<g stroke="{ink}" stroke-width="1.6" stroke-linecap="round" fill="none">{bar}</g>')


def build_svg(theme):
    ink, paper = INK[theme], PAPER[theme]
    lines = all_lines()
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W:.0f} {H:.0f}" role="img" '
        f'aria-label="Field lines of two opposite charges, leaving the positive charge and arriving on the negative one">',
        f'<defs><radialGradient id="fade" cx="0.5" cy="0.5" r="0.5"><stop offset="0.6" stop-color="#fff"/>'
        f'<stop offset="1" stop-color="#000"/></radialGradient>'
        f'<mask id="edge" maskUnits="userSpaceOnUse" x="0" y="0" width="{W:.0f}" height="{H:.0f}">'
        f'<rect width="{W:.0f}" height="{H:.0f}" fill="url(#fade)"/></mask></defs>',
        f'<g mask="url(#edge)"><g fill="none" stroke="{ink}" stroke-width="0.9" stroke-linecap="round" '
        f'stroke-linejoin="round" opacity="0.92">',
    ]
    parts += [f'<path d="{_path(l.pts)}"/>' for l in lines]
    parts.append(f'<g fill="{ink}" stroke="none">')
    for x, y, a in arrows(lines):
        parts.append(f'<path class="arrow" d="M-4,-2.6 L4.2,0 L-4,2.6 L-2.4,0 Z" '
                     f'transform="translate({x:.1f} {y:.1f}) rotate({a:.1f})"/>')
    parts.append("</g></g></g>")
    parts.append(_charge(*PLUS, +1, ink, paper))
    parts.append(_charge(*MINUS, -1, ink, paper))
    parts.append("</svg>")
    return "\n".join(parts) + "\n"


def main():
    out = Path(__file__).resolve().parents[1] / "site" / "fs" / "sketches"
    out.mkdir(parents=True, exist_ok=True)
    for theme in ("light", "dark"):
        (out / f"dipole-{theme}.svg").write_text(build_svg(theme), encoding="utf-8", newline="\n")
        print("wrote", (out / f"dipole-{theme}.svg").name)


if __name__ == "__main__":
    main()
