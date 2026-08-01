# Icon inventory — Preflights portal

Living list of every icon the portal references. Drop `ic-<name>.png` files into this
folder; the UI picks them up automatically. Update the **Status** column as you add or
retire icons — this table is the source of truth for what the UI expects.

- **Source:** all icons are from **Freepik on Flaticon**
  (<https://www.flaticon.com/authors/freepik>). The required attribution is shown
  site-wide in the page footer, so keep new icons from the same author to keep it accurate.
- **Format:** PNG, 256×256, transparent, square. CSS downscales to 16–28 px.
- **Fallback chain:** a missing `ic-<name>.png` falls back to `ic-dashboard.png`, then to an
  emoji — so the UI never breaks (see `site/js/util.js` → `iconHTML`).
- **How to reference one:** `iconHTML('<name>', '<emoji-fallback>', '<css-class>')` from
  `util.js`, or for CSS backgrounds use `url(../media/icons/ic-<name>.png)`.
- **Status legend:** ✅ present · ⬜ needed (not yet added).

| File | Description | Flaticon search terms | Status | Used in |
|------|-------------|-----------------------|:------:|---------|
| `ic-dashboard.png` | Dashboard / home landing | dashboard, home, grid, layout | ✅ | **Universal fallback** (shown for any missing icon) |
| `ic-assignments.png` | Assignments — clipboard checklist | clipboard, checklist, assignment, tasks | ✅ | — (available; top nav is text-only) |
| `ic-interactions.png` | AI lesson interactions — lightbulb/idea | lightbulb, idea, lesson, spark | ✅ | Dashboards (student/faculty) |
| `ic-grades.png` | Grading & reports — bar chart/report | report, bar chart, grades, statistics | ✅ | Faculty "View reports" quick action |
| `ic-roster.png` | Roster — people / ID card | roster, id card, students list, people | ✅ | Faculty dashboard quick action |
| `ic-sections.png` | Class sections — groups/layers | layers, groups, sections, stack | ✅ | Faculty "Sections" stat |
| `ic-export.png` | Export / download | download, export, save, arrow down | ✅ | Faculty "Export grades" quick action |
| `ic-settings.png` | Settings — gear | gear, settings, cog, options | ✅ | — (available; top nav is text-only) |
| `ic-signout.png` | Sign out — logout / exit door | logout, sign out, exit, door | ✅ | User menu |
| `ic-user.png` | User / profile avatar | user, profile, person, account | ✅ | User-menu dropdown header |
| `ic-course.png` | Course switcher — books/atom | books, course, education, subject | ✅ | Nav course switcher (multi-course faculty) |
| `ic-sun.png` | Light-mode toggle | sun, light, day, brightness | ✅ | Theme toggle (shown in dark mode) |
| `ic-moon.png` | Dark-mode toggle | moon, dark, night | ✅ | Theme toggle (shown in light mode) |
| `ic-menu.png` | Mobile hamburger menu | menu, hamburger, bars, lines | ✅ | Mobile nav burger |
| `ic-todo.png` | To-do — checklist + pencil | to do, checklist, pencil, tasks | ✅ | Student "To do" stat |
| `ic-done.png` | Completed — check circle/badge | check, done, complete, badge | ✅ | Student "Recently graded" heading |
| `ic-due-soon.png` | Due soon — clock/hourglass | clock, hourglass, due, deadline | ✅ | Student "Up next" heading |
| `ic-overdue.png` | Overdue — alarm/warning | alarm clock, overdue, late, warning | ✅ | Student "Overdue" stat |
| `ic-award.png` | Grade earned — star/medal | medal, award, star, achievement | ✅ | Student "Average grade" stat |
| `ic-progress.png` | Progress — gauge/ring | progress, gauge, ring, percent | ✅ | Student "Lesson interactions" heading |
| `ic-class.png` | Class / teaching — chalkboard/podium | chalkboard, teacher, class, podium | ✅ | Faculty "Section roll-up" heading |
| `ic-analytics.png` | Analytics — line/bar chart | analytics, chart, graph, trend | ✅ | — (available; top nav is text-only) |
| `ic-submissions.png` | Submissions inbox — tray | inbox, tray, submissions, incoming | ✅ | Faculty "Avg submitted" stat |
| `ic-pending-grade.png` | Pending grading — pen/marker | pen, marker, grading, edit | ✅ | Faculty dashboard stat + quick action |
| `ic-students.png` | Students count — group | group, people, students, team | ✅ | Faculty "Students" stat |
| `ic-completion.png` | Completion rate — donut/percent | donut chart, percent, completion, pie | ✅ | Faculty interaction-completion row |
| `ic-success.png` | Success — check | check, success, tick, ok | ✅ | `.alert-success` glyph |
| `ic-warning.png` | Warning — triangle ! | warning, alert, triangle, caution | ✅ | `.alert-warn` glyph |
| `ic-error.png` | Error — x circle | error, cross, x, cancel | ✅ | `.alert-error` glyph |
| `ic-info.png` | Info — i circle | info, information, help, circle | ✅ | `.alert-info` glyph |
| `ic-atom.png` | Physics brand mark — atom | atom, physics, nucleus, science | ✅ | Nav brand logo + login motif |
| `ic-bolt.png` | Energy accent — lightning bolt | lightning, bolt, energy, electricity | ✅ | Login physics motif |
| `ic-rocket.png` | "Preflight" theme — rocket/paper plane | rocket, launch, paper plane, takeoff | ✅ | Student "all caught up" empty state |
| `ic-wave.png` | Physics — waveform | wave, waveform, oscillation, sine | ✅ | Login physics motif |
| `ic-magnet.png` | E&M — magnet | magnet, magnetism, horseshoe, field | ✅ | Login physics motif |
| `ic-beaker.png` | Test & mockup views — beaker/flask | beaker, flask, test, laboratory | ⬜ | User-menu dropdown, "Test views" (global admins) |

## Adding a new icon

1. Pick a `ic-<name>.png` (Freepik, lineal color, 256×256) and drop it in this folder.
2. Add a row above with its description, search terms, and `✅` status.
3. Reference it in the UI: `iconHTML('<name>', '<emoji>')` (JS) or
   `url(../media/icons/ic-<name>.png)` (CSS). Until the file exists it shows the
   dashboard placeholder, so you can wire the markup first and add art later.
