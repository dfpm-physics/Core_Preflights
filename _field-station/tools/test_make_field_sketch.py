#!/usr/bin/env python3
"""Tests for make_field_sketch.py. Standard library only.  Run:  python _field-station/tools/test_make_field_sketch.py

The point of these is that the picture is physically right, not that it looks right:
  - the field between the charges points from plus to minus;
  - every line starts at the plus charge and none starts at the minus charge;
  - every arrowhead in the WRITTEN SVG points along the true field at its own position;
  - arrows on lines that curve back (the outer ones) point the right way too, which is where the
    concept sketch was wrong.
"""

import math
import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import make_field_sketch as m  # noqa: E402


def angle_diff(a, b):
    return abs((a - b + 180) % 360 - 180)


class FieldTests(unittest.TestCase):
    def test_between_charges_points_plus_to_minus(self):
        ex, ey = m.field(m.CX, m.CY)
        self.assertGreater(ex, 0)          # plus is on the left, so the field points right
        self.assertAlmostEqual(ey, 0, places=9)

    def test_outside_on_axis_points_away_from_plus_on_left(self):
        ex, _ = m.field(m.PLUS[0] - 60, m.CY)
        self.assertLess(ex, 0)             # left of the plus charge the field points left (away from it)
        ex, _ = m.field(m.MINUS[0] + 60, m.CY)
        self.assertLess(ex, 0)             # right of the minus charge the field points toward it, i.e. left

    def test_every_line_starts_at_plus(self):
        for pts in [l.pts for l in m.all_lines() if not l.back]:
            d_plus = math.hypot(pts[0][0] - m.PLUS[0], pts[0][1] - m.PLUS[1])
            d_minus = math.hypot(pts[0][0] - m.MINUS[0], pts[0][1] - m.MINUS[1])
            self.assertAlmostEqual(d_plus, m.R_CHARGE, places=6)
            self.assertGreater(d_minus, m.R_CHARGE)

    def test_lines_end_on_minus_or_leave_the_box(self):
        ended_on_minus = left_box = 0
        for pts in [l.pts for l in m.all_lines() if not l.back]:
            x, y = pts[-1]
            if math.hypot(x - m.MINUS[0], y - m.MINUS[1]) <= m.R_CHARGE + 0.5:
                ended_on_minus += 1
            elif not (0 <= x <= m.W and 0 <= y <= m.H):
                left_box += 1
            else:
                self.fail(f"a line stopped in open space at {x:.1f},{y:.1f}")
        self.assertGreater(ended_on_minus, 0)
        self.assertGreater(left_box, 0)

    def test_lines_never_enter_plus_again(self):
        for pts in [l.pts for l in m.all_lines()]:
            for x, y in pts[3:]:
                self.assertGreater(math.hypot(x - m.PLUS[0], y - m.PLUS[1]), m.R_CHARGE - 0.5)

    def test_written_arrows_point_along_the_true_field(self):
        for theme in ("light", "dark"):
            svg = m.build_svg(theme)
            found = re.findall(r'class="arrow".*?translate\(([-\d.]+) ([-\d.]+)\) rotate\(([-\d.]+)\)', svg)
            self.assertGreater(len(found), 20, "expected a good number of arrowheads")
            worst = 0.0
            for x, y, a in found:
                x, y, a = float(x), float(y), float(a)
                ex, ey = m.field(x, y)
                true = math.degrees(math.atan2(ey, ex))
                worst = max(worst, angle_diff(a, true))
            # the written angle is the chord of a line at 1.6-unit steps: well inside 6 degrees
            self.assertLess(worst, 6.0, f"{theme}: worst arrow is {worst:.1f} degrees off the field")

    def test_arrows_exist_on_both_sides_and_outer_lines(self):
        pts = [(x, y) for x, y, _ in m.arrows(m.all_lines())]
        self.assertTrue(any(y < m.CY - 40 for _, y in pts), "no arrow on an upper line")
        self.assertTrue(any(y > m.CY + 40 for _, y in pts), "no arrow on a lower line")

    def test_lines_arrive_on_minus_from_its_far_side(self):
        back = [l for l in m.all_lines() if l.back]
        self.assertGreater(len(back), 6)
        for l in back:
            x, y = l.pts[-1]                    # travel ends on the minus charge
            self.assertAlmostEqual(math.hypot(x - m.MINUS[0], y - m.MINUS[1]), m.R_CHARGE, places=6)
            sx, sy = l.pts[0]
            self.assertFalse(0 <= sx <= m.W and 0 <= sy <= m.H, "a backward line should start outside the box")
        # some come in from the right of minus, which the first version never drew
        self.assertTrue(any(l.origin[8][0] > m.MINUS[0] + m.R_CHARGE for l in back))

    def test_minus_side_mirrors_plus_side(self):
        lines = m.all_lines()
        fwd = [l for l in lines if not l.back and not m.reaches_other(l)]
        back = [l for l in lines if l.back]
        self.assertEqual(len(fwd), len(back))
        for b in back:
            near = min(fwd, key=lambda f: abs(f.origin[0][1] - b.origin[0][1]) + abs((m.W - f.origin[0][0]) - b.origin[0][0]))
            for (x1, y1), (x2, y2) in zip(b.origin, near.origin):
                self.assertAlmostEqual(m.W - x2, x1, places=6)
                self.assertAlmostEqual(y2, y1, places=6)
        # arrowheads mirror too: x flips, and the direction reverses (a plus-side arrow points away from the
        # centre line, the matching minus-side one points in toward minus)
        svg = m.build_svg("light")
        found = [tuple(map(float, t)) for t in re.findall(r'translate\(([-\d.]+) ([-\d.]+)\) rotate\(([-\d.]+)\)', svg)]
        for x, y, a in found:
            if x < m.PLUS[0] - 10:
                mates = [q for q in found if abs(q[0] - (m.W - x)) < 0.6 and abs(q[1] - y) < 0.6]
                self.assertTrue(mates, f"no mirror arrow for {x},{y}")
                # Mirror x -> W - x turns a plus-side arrow's direction a into 180 - a, and the minus side runs the other way
                # along the same curve (toward minus), so the mate's angle must be exactly -a, and nothing else.
                self.assertTrue(any(angle_diff(q[2], -a) < 0.3 for q in mates), f"mirror arrow for {x},{y} (angle {a}) is not at -a: {[q[2] for q in mates]}")

    def test_edges_fade_instead_of_cutting(self):
        svg = m.build_svg("light")
        self.assertIn("<mask", svg)

    def test_no_text_in_the_drawing(self):
        svg = m.build_svg("light")
        self.assertNotIn("<text", svg)          # no numbers, labels or units, so no measurement is implied

    def test_both_themes_are_written_with_their_own_ink(self):
        self.assertIn(m.INK["light"], m.build_svg("light"))
        self.assertIn(m.INK["dark"], m.build_svg("dark"))
        self.assertNotIn(m.INK["light"], m.build_svg("dark"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
