#!/usr/bin/env python3
"""Tests for site/fs/sketch-map.json: the electric-field sketch must not appear beside the wrong topic.
Standard library only.  Run:  python _field-station/tools/test_sketch_map.py
The patterns are written to mean the same in Python and in JavaScript (\\b, .*, alternation, case-insensitive)."""
import json
import re
import unittest
from pathlib import Path

MAP = Path(__file__).resolve().parents[1] / "site" / "fs" / "sketch-map.json"
PATTERNS = json.loads(MAP.read_text(encoding="utf-8"))["sketches"][0]["match"]


def shows(title):
    return any(re.search(p, title, re.I) for p in PATTERNS)


class SketchMapTests(unittest.TestCase):
    def test_right_topics_get_the_sketch(self):
        for t in ["Test Lesson 2: Electric Fields", "Electric Charge", "Coulomb's law", "Electrostatics review",
                  "Electric dipole in a field", "Field lines of a charged sphere", "Point charges and superposition",
                  "Electric force between two charges"]:
            self.assertTrue(shows(t), t)

    def test_wrong_topics_do_not(self):
        for t in ["Magnetic dipole moment", "Magnetic field lines", "Gravitational field lines", "Newton's laws",
                  "Forces on a block", "Gravitational fields", "Capacitors", "Current and resistance",
                  "Wave interference", "Dipole antenna radiation", "Field of view in a telescope"]:
            self.assertFalse(shows(t), t)

    def test_every_pattern_names_electric_or_charge_or_coulomb(self):
        for p in PATTERNS:
            self.assertRegex(p, r"electric|charge|coulomb|electrostatic", p)


if __name__ == "__main__":
    unittest.main(verbosity=2)
