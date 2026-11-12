#!/usr/bin/env python3
"""Measure the contrast ratio (WCAG 2.x) of the Field Station colour pairs. Standard library only.

Run:  python _field-station/tools/contrast.py
Reads nothing; the pairs are the tokens in site/fs/field-station.css, written out here so a change to
a token is one edit in each place. Exit status is 1 if any text pair is below 4.5 or any interface
pair is below 3.
"""
import sys


def lum(h):
    h = h.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    f = lambda c: c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)


def ratio(a, b):
    x, y = sorted((lum(a), lum(b)), reverse=True)
    return (x + 0.05) / (y + 0.05)


# (name, foreground, background, need)   need 4.5 for text, 3.0 for interface parts
LIGHT = [
    ("body text on canvas", "#2A2019", "#F4F0E7", 4.5),
    ("body text on card", "#2A2019", "#FBF8F1", 4.5),
    ("secondary text (muted) on canvas", "#655B4D", "#F4F0E7", 4.5),
    ("secondary text (muted) on card", "#655B4D", "#FBF8F1", 4.5),
    ("context label (muted) on rail", "#655B4D", "#E9E3D3", 4.5),
    ("primary action: white on oxblood", "#FFFFFF", "#732D3C", 4.5),
    ("primary action hover: white on darker oxblood", "#FFFFFF", "#5F2230", 4.5),
    ("link on canvas", "#7A2F40", "#F4F0E7", 4.5),
    ("link on card", "#7A2F40", "#FBF8F1", 4.5),
    ("rail link on rail", "#4B4036", "#E9E3D3", 4.5),
    ("selected rail item on sage", "#2A2019", "#D3DBC2", 4.5),
    ("brass marker on rail", "#8F6A1C", "#E9E3D3", 3.0),
    ("focus ring on canvas", "#1F5F7A", "#F4F0E7", 3.0),
    ("quiet rule on canvas (decorative)", "#C9BFA8", "#F4F0E7", 0.0),
    ("overdue text on card", "#A32A3A", "#FBF8F1", 4.5),
    ("soon-due text on card", "#8A4B00", "#FBF8F1", 4.5),
    ("error alert text on its fill", "#8B2230", "#F5E1DE", 4.5),
    ("ok alert text on its fill", "#2F5A2A", "#E3EAD3", 4.5),
    ("warn alert text on its fill", "#5E410B", "#F3E8C6", 4.5),
    ("info alert text on its fill", "#25485F", "#E2E8EC", 4.5),
]
DARK = [
    ("body text on workspace", "#EDE6D8", "#14191C", 4.5),
    ("body text on card", "#EDE6D8", "#1B2226", 4.5),
    ("secondary text (muted) on workspace", "#AAA394", "#14191C", 4.5),
    ("secondary text (muted) on card", "#AAA394", "#1B2226", 4.5),
    ("context label (muted) on rail", "#AAA394", "#101518", 4.5),
    ("primary action: white on oxblood", "#FFFFFF", "#8E3A4C", 4.5),
    ("primary action hover: white on lighter oxblood", "#FFFFFF", "#A04558", 4.5),
    ("link on workspace", "#E6AEBA", "#14191C", 4.5),
    ("link on card", "#E6AEBA", "#1B2226", 4.5),
    ("rail link on rail", "#D3CCBD", "#101518", 4.5),
    ("selected rail item on sage", "#EDE6D8", "#2D3A30", 4.5),
    ("brass marker on rail", "#C9A24E", "#101518", 3.0),
    ("focus ring on workspace", "#8CC7DD", "#14191C", 3.0),
    ("overdue text on card", "#F08A93", "#1B2226", 4.5),
    ("soon-due text on card", "#E8A84B", "#1B2226", 4.5),
    ("error alert text on its fill", "#F3A3AB", "#33191D", 4.5),
    ("ok alert text on its fill", "#A8D99D", "#1F2D22", 4.5),
    ("warn alert text on its fill", "#E4C77C", "#2C2616", 4.5),
    ("info alert text on its fill", "#9CCBE0", "#18262E", 4.5),
]

bad = 0
for title, rows in (("LIGHT", LIGHT), ("DARK", DARK)):
    print(title)
    for name, fg, bg, need in rows:
        r = ratio(fg, bg)
        ok = r >= need
        bad += not ok
        print(f"  {r:5.2f}  {'ok  ' if ok else 'FAIL'} need {need:<4} {name}  {fg} on {bg}")
sys.exit(1 if bad else 0)
