---
version: alpha
name: iPREP Portal
description: >
  A calm, institutional academic tool for USAFA Physics — clean GitHub-Primer blue on a
  near-white canvas (near-black slate in dark), fully dark-mode aware, with USAFA gold
  kept as a restrained accent. Translucent blurred top nav, soft-shadowed white cards, a
  single self-hosted condensed display face (Oswald) for hero titles, and data-dense
  dashboards built from gauges, histograms, radar charts, and progress bars. Reads as
  trustworthy government-academic software, not a consumer app: legible, quiet, and
  unfussy, with color reserved for status and physics accents.

# --------------------------------------------------------------------------- #
#  TOKENS                                                                      #
#  Every value below is a live CSS custom property in app/css/styles.css.      #
#  Tokens are theme-aware: each color lists its light value and, where it      #
#  differs, the [data-theme="dark"] override. Author with tokens only —        #
#  never hardcode a surface/alert color; add or reuse a variable instead.      #
# --------------------------------------------------------------------------- #

colors:
  # brand (GitHub-Primer blue accent; USAFA gold as a restrained seasoning; physics accents)
  blue:        { light: "#0969da", dark: "#4493f8" }   # --blue   · primary brand, headers, buttons
  blue-lt:     { light: "#0969da", dark: "#4493f8" }   # --blue-lt· links, focus ring, hover, eyebrows (now == --blue)
  gold:        { light: "#9a6700", dark: "#d29922" }   # --gold   · USAFA accent, feedback rail
  red:         { light: "#cf222e", dark: "#f85149" }   # --red    · danger / zero-credit / overdue
  green:       { light: "#1a7f37", dark: "#3fb950" }   # --green  · success / full-credit / complete

  # surfaces & text
  bg:          { light: "#f6f8fa", dark: "#010409" }   # --bg     · page canvas
  card:        { light: "#ffffff", dark: "#0d1117" }   # --card   · raised surface
  border:      { light: "#d0d7de", dark: "#30363d" }   # --border · hairlines, dividers, default track
  text:        { light: "#1f2328", dark: "#e6edf3" }   # --text   · primary ink
  text-soft:   { light: "#424a53", dark: "#c9d1d9" }   # --text-soft · intermediate ink — titles, objective labels, quote text
  muted:       { light: "#656d76", dark: "#9198a1" }   # --muted  · secondary ink, meta, labels
  surface-sunken: { light: "#f6f8fa", dark: "#010409" } # --surface-sunken · inset wells, table-less panels
  surface-hover:  { light: "#eef1f4", dark: "#21262d" } # --surface-hover  · row/menu hover
  mc-sel-bg:   { light: "#eaeef2", dark: "#161b22" }   # --mc-sel-bg · neutral tint — lesson-header bg, selected option, blue chips
  input-bg:    { light: "#ffffff", dark: "#0d1117" }   # --input-bg
  th-bg:       { light: "#0969da", dark: "#1f6feb" }   # --th-bg  · table header row
  overlay:     { light: "rgba(27,31,36,0.5)", dark: "rgba(1,4,9,0.7)" } # --overlay · modal scrim

  # translucent nav (Featurebase-style blurred bar)
  nav-bg:      { light: "rgba(255,255,255,0.72)", dark: "rgba(13,17,23,0.72)" } # --nav-bg
  nav-border:  { light: "rgba(27,31,36,0.10)",    dark: "rgba(255,255,255,0.10)" } # --nav-border
  nav-link:    { light: "#57606a", dark: "#9198a1" } # --nav-link

  # status families (each: bg / fg / border) — GitHub Primer; drive alerts, badges, credit toggles
  alert-error: { bg: "#ffebe9", fg: "#cf222e", bd: "#ffcecb" }  # dark: bg "#2d1416" fg "#f85149" bd "#5d1a1a"
  alert-ok:    { bg: "#dafbe1", fg: "#1a7f37", bd: "#4ac26b" }  # dark: bg "#12261c" fg "#3fb950" bd "#238636"
  alert-info:  { bg: "#ddf4ff", fg: "#0969da", bd: "#54aeff" }  # dark: bg "#121d2f" fg "#4493f8" bd "#1f6feb"
  alert-warn:  { bg: "#fff8c5", fg: "#7d4e00", bd: "#d4a72c" }  # dark: bg "#272115" fg "#d29922" bd "#9e6a03"
  feedback:    { bg: "#fff8c5", fg: "#7d4e00" }                 # dark: bg "#272115" fg "#d29922" · gold-rail instructor feedback block

  # data-viz ramps (lesson rollups). Score ramp = 5 zones for a 0–5 average;
  # distribution ramp = 6 steps (d0–d5) for a 0–5 histogram. Both have dark variants.
  score-ramp:        ["#e8505b", "#f6803c", "#f5c518", "#17b890", "#2ec46b"]  # --s1..--s5 (low→high)
  distribution-ramp: ["#d23b4e", "#ea5a5f", "#f6803c", "#f5c518", "#21b58e", "#2ec46b"] # --d0..--d5
  track:       { light: "#eaeef2", dark: "#21262d" }  # --track · gauge background (--track-edge: #d0d7de / #30363d)

typography:
  # System-native stack for all body/UI text, plus ONE self-hosted condensed display face
  # (Oswald) for hero titles. Scale is em-based, relative to the 16px root, so a section can
  # rescale its whole subtree by setting one font-size. Still no build step; the woff2 is
  # self-hosted (no third-party network call).
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
  fontDisplay: "'Oswald', 'Arial Narrow', 'Segoe UI', sans-serif"  # --font-display · hero titles only (self-hosted Oswald 500/600)
  display-title: { font: "{typography.fontDisplay}", fontWeight: 500-600 }      # .page-head h1, .topnav .brand, .id-card h1, .lh-title
  page-title:   { fontSize: 1.7em,  fontWeight: 600, letterSpacing: 0.005em }   # .page-head h1 (display face)
  stat-number:  { fontSize: 1.7em,  fontWeight: 800, letterSpacing: -0.02em, lineHeight: 1.05 } # .stat-num
  card-title:   { fontSize: 1.05em, fontWeight: 700 }                          # .card-title
  brand:        { fontSize: 1.24em, fontWeight: 600, letterSpacing: 0.01em }   # .topnav .brand (display face)
  body:         { fontSize: 1em,    fontWeight: 400, lineHeight: 1.5 }
  body-strong:  { fontSize: 0.96em, fontWeight: 600 }                          # list/item titles
  control:      { fontSize: 0.9em,  fontWeight: 600 }                          # .btn, inputs
  nav-link:     { fontSize: 0.875em, fontWeight: 500 }                         # .nav-link
  meta:         { fontSize: 0.8em,  fontWeight: 400, color: "{colors.muted}" } # captions, deadlines
  eyebrow:      { fontSize: 0.72em, fontWeight: 700, textTransform: uppercase, letterSpacing: 0.06em, color: "{colors.blue-lt}" } # section labels

spacing:
  # No formal scale variable; these are the recurring rhythm values in px.
  xs: 4px
  sm: 8px
  base: 16px
  card-pad: 24px      # .card / modal padding
  page-gutter: 20px   # .page horizontal padding
  block: 30px         # gap between dashboard sections
  page-max: 760px     # .page (single-column reading width)
  page-wide-max: 1180px # .page-wide / footer (dashboards, tables)
  nav-height: 64px

rounded:
  sm:   6px      # --radius-sm · inputs, buttons, small chips
  md:   10px     # --radius    · cards, list items, tiles
  lg:   14px     # modals
  xl:   16px     # login card
  pill: 999px    # badges, course switcher, progress tracks, avatars

elevation:
  shadow-sm: { light: "0 1px 4px rgba(0,0,0,0.06)",  dark: "0 1px 4px rgba(0,0,0,0.4)" }  # resting cards
  shadow-md: { light: "0 4px 12px rgba(0,0,0,0.10)", dark: "0 4px 12px rgba(0,0,0,0.5)" } # hover / sticky bars
  shadow-lg: { light: "0 12px 32px rgba(0,0,0,0.16)", dark: "0 12px 32px rgba(0,0,0,0.6)" } # modals, popovers

components:
  topnav:
    background: "{colors.nav-bg}"
    backdropFilter: "saturate(180%) blur(14px)"
    borderBottom: "1px solid {colors.nav-border}"
    height: "{spacing.nav-height}"
    layout: "grid 1fr auto 1fr — brand left, links centered, controls right"
  card:
    background: "{colors.card}"
    border: "1px solid {colors.border}"
    radius: "{rounded.md}"
    padding: "{spacing.card-pad}"
    shadow: "{elevation.shadow-sm}"
  stat-tile:
    extends: card
    accentRail: "4px left border, --accent (blue/gold/green/red/amber)"
    iconChip: "46px rounded square, accent tinted via color-mix 16%"
  button-primary:
    background: "{colors.blue}"
    hoverBackground: "{colors.blue-lt}"
    textColor: "#ffffff"
    typography: "{typography.control}"
    padding: "10px 22px"
    radius: "{rounded.sm}"
  button-ghost:
    background: transparent
    textColor: "{colors.blue-lt}"
    border: "1px solid {colors.border}"
  input:
    background: "{colors.input-bg}"
    border: "1px solid {colors.border}"
    focusRing: "border {colors.blue-lt} + 3px rgba(42,82,152,0.18) glow"
    radius: "{rounded.sm}"
  alert:
    families: [error, success, info, warn]
    composition: "{colors.alert-*} bg/fg/bd + 18px leading status PNG glyph"
  credit-toggle:
    states: { full: "{colors.alert-ok}", warn: "{colors.alert-warn}", zero: "{colors.alert-error}" }
    note: "3-state grading control — green/yellow/red mirrors scores.question_scores.status"
  modal:
    surface: "{colors.card}"
    radius: "{rounded.lg}"
    shadow: "{elevation.shadow-lg}"
    backdrop: "{colors.overlay}"
    stacking: "base 60 · flag-modal 70 · full-report 80 (stacked drill-downs)"
  progress-row:
    track: "{colors.border}, 7px, pill"
    fill: "{colors.green}; .partial → {colors.gold}; .low → {colors.red}"
---

# iPREP Portal — Design System

This is the design language for the **`app/`** portal: the role-aware rewrite of the
iPREP front end (student + faculty dashboards, grading, reports, roster, and AI lesson
interactions). It is a static HTML/CSS/JS system with **no build step** — plain ES
modules and one hand-authored stylesheet the browser runs as-is. This document explains
the *intent* behind the tokens in [`css/styles.css`](css/styles.css) so a human or an
agent can extend the UI without re-deriving the rules or drifting off-brand.

**The governing rule:** new pages are authored with **tokens only**. Never hardcode a
surface or status color — reuse a CSS variable, or add one to `:root` *and* its
`[data-theme="dark"]` counterpart, so every screen themes cleanly. A raw hex in a page is
a bug.

## Overview

iPREP (interactive Pre-lesson Readiness Engagement Platform) is institutional academic
software for the U.S. Air Force Academy physics department. The visual language is
deliberately **quiet and trustworthy** — it should feel like a well-kept government
gradebook, not a marketing site. Content (cadet work, scores, misconception trends) is
the focus; chrome recedes.

The aesthetic is a clean, **GitHub-Primer-inspired blue on a near-white canvas** (a
near-black slate in dark), with white cards floating on a faintly cool gray background
under soft shadows. **USAFA gold is retained as a restrained accent** — the feedback rail
and a brand seasoning — not the co-lead color it once was. The one piece of personality is
the **physics motif** — an atom brand mark, with lightning/wave/magnet accents on the
login screen — nodding to the subject without becoming decorative noise. Everything is
**fully dual-theme**: a near-black slate dark mode is a first-class peer of light mode,
applied before first paint so there is no flash.

The brand is **iPREP**, shown with the atom mark; the repo, Pages path, and export
filenames stay `Core_Preflights`. The login crest is `⚛️`; the product subtitle spells out
the acronym in muted small caps beneath the wordmark.

### Key Characteristics

- **Token-first & theme-aware.** Two palettes (`:root` light, `[data-theme="dark"]`)
  expressed entirely as semantic CSS variables. Color is a *role*, never a literal.
- **Institutional calm.** Primer-blue restraint with gold as a seasoning; saturated color
  reserved for **status** (green/yellow/red) and **data-viz**, not for decoration.
- **Data-dense, legible.** Dashboards are built from gauges, histograms, radar charts, and
  progress bars with tabular-aligned numerals — designed to be *read*, fast.
- **Soft-shadow card surfaces.** White cards, 10px radius, `shadow-sm` at rest lifting to
  `shadow-md` on hover. Hairline borders, never heavy rules.
- **System-native type, one display face.** Body and UI text ride the platform UI stack so
  they render instantly; **one self-hosted condensed display face (Oswald)** dresses hero
  titles only. An em-based scale lets a subtree rescale from one font-size.
- **No-build, no-flash.** Static ES modules; a tiny inline `<head>` snippet sets the theme
  before the stylesheet paints (see [`js/theme.js`](js/theme.js) `THEME_HEAD_SNIPPET`). The
  lone display face is a self-hosted woff2 (no third-party network call) loaded with
  `font-display: swap` over a system fallback, so there's no flash and nothing to wait on.
- **Graceful iconography.** PNG icons with a `ic-<name> → ic-dashboard → emoji` fallback
  chain, so a missing asset never breaks a screen.

## Colors

Colors are organized into five roles. Each has a light value and a dark override (see the
token block); the names below are the CSS variables to reach for.

**Brand.** `{colors.blue}` is the GitHub-Primer accent blue — page/table headers, the
primary button, the brand mark, links, focus rings, hover states, and the uppercase
**eyebrow** labels that head sections. `{colors.blue-lt}` is now the *same value* as
`{colors.blue}` (there is no separate lighter companion anymore); both names resolve to the
one interactive blue, so reach for either and they theme identically. `{colors.gold}` is
the USAFA accent, kept deliberately *restrained* — the left rail on instructor feedback
blocks and a brand seasoning, never a fill for large areas or a co-lead color.

**Surfaces.** `{colors.bg}` is the cool-gray canvas; `{colors.card}` (white in light, near-
black slate in dark) is every raised surface. `{colors.surface-sunken}` is an *inset* tone
for wells, table-less panels, and code blocks; `{colors.surface-hover}` is the lightest lift
for row and menu hover. `{colors.mc-sel-bg}` is a neutral tint used for the tinted lesson-
rollup header background, the selected multiple-choice option, and blue info chips.
`{colors.border}` is the universal hairline — dividers, card edges, and the default
progress-track. The contrast ladder is intentionally shallow: bg → sunken → card are close
in value so depth comes from **shadow**, not hard contrast.

**Text.** Three ink tones: `{colors.text}` for primary content, `{colors.muted}` for
everything secondary — captions, meta rows, form labels, deadlines, table sub-text — and an
intermediate `{colors.text-soft}` used for titles, objective labels, and quote text where
full-strength ink would feel heavy. Holding to these three tones is what makes dense screens
scan cleanly.

**Status.** Four families — `error`, `ok` (success), `info`, `warn` — each a coordinated
`{bg / fg / border}` triad. They power `.alert-*`, score badges, and the **3-state credit
toggle** that is core to grading: **full = green**, **warn = yellow** (full credit but
flagged/vague), **zero = red**. This green/yellow/red mapping is a contract with the data
model (`scores.question_scores[].status`) — the colors *mean* those states, so don't repurpose
them. `{colors.feedback}` (a warm amber well with a gold rail) is the dedicated look for
instructor-written feedback.

**Data-viz.** Two perceptual ramps for lesson analytics: a **5-zone score ramp**
(`--s1`…`--s5`, red→green) for a 0–5 average gauge, and a **6-step distribution ramp**
(`--d0`…`--d5`) for 0–5 histograms. Both have dark-mode variants tuned for the darker track.
The neutral high-contrast value tag (`.lr-tag`, ink-on-card) sits above gauges so a number
stays legible regardless of the zone color beneath it.

**Translucent nav.** The top bar is its own mini-palette — a 72%-opaque `{colors.nav-bg}`
with a saturating blur, hairline `{colors.nav-border}`, and `{colors.nav-link}` text — so
content scrolls softly under it.

## Typography

Two faces. The **system-native** stack (`-apple-system, BlinkMacSystemFont, 'Segoe UI',
Roboto, sans-serif`) carries all body, UI, and numeric text — it renders instantly with
nothing to wait on. A single self-hosted **condensed display face, Oswald**
(`{typography.fontDisplay}` → the `--font-display` token), dresses **hero titles only**:
`.page-head h1`, the `.topnav .brand` iPREP wordmark, the `.id-card h1` login heading, and
the lesson-rollup title `.lh-title`. Oswald ships as a self-hosted woff2 in two weights
(500 and 600, `app/media/fonts/oswald-500.woff2` / `oswald-600.woff2`) with
`font-display: swap` over the system stack, so there is no third-party request and no flash.
The scale is **em-relative**, so setting `font-size` on a container proportionally rescales
its whole subtree — used heavily in the lesson-rollup charts.

The hierarchy is carried by **weight, size, and the one display face** — not by many
families:

| Role | Family | Size | Weight | Notes |
|---|---|---|---|---|
| Page title (`.page-head h1`) | display (Oswald) | 1.7em | 600 | `letter-spacing: 0.005em` |
| Brand wordmark (`.topnav .brand`) | display (Oswald) | 1.24em | 600 | `letter-spacing: 0.01em` |
| Lesson-rollup title (`.lh-title`) | display (Oswald) | 2.05em | 500 | `{colors.text-soft}`, `line-height: 1.12` |
| Stat number (`.stat-num`, `.sum-tile .v`) | system | 1.7em / 1.5em | 800 | tight tracking, `line-height: 1.05` |
| Card / section title | system | 1.05–1.12em | 700 | — |
| Body | system | 1em | 400 | `line-height: 1.5` |
| Body strong (item titles) | system | 0.96em | 600 | — |
| Controls (`.btn`, inputs) | system | 0.9em | 600 | — |
| Nav link | system | 0.875em | 500 | — |
| Meta / caption | system | 0.78–0.82em | 400 | `{colors.muted}` |
| **Eyebrow** | system | 0.72em | 700 | UPPERCASE, `letter-spacing: 0.06em`, `{colors.blue-lt}` |

**Principles.** Display numerals use heavy weight (800) with negative tracking and
`font-variant-numeric: tabular-nums` so figures align in columns and progress counts don't
jitter. The **eyebrow** (small, uppercase, blue, wide-tracked) is the recurring device for
labeling a section or chart group — prefer it over a bold heading for sub-sections. Body
copy never goes below ~0.78em; anything smaller is a uppercase label, not prose.

## Layout

Two container widths define the page rhythm: **`.page`** caps at **760px** for
single-column reading and forms (login, assignment submit), while **`.page-wide`** caps at
**1180px** for dashboards, rosters, and tables. Both center with auto margins and carry a
20px gutter that tightens to 12px on small screens.

The page is a **sticky-footer column**: `body` is a flex column, `<main>` grows to fill, and
the icon-attribution footer pins to the bottom. The **top nav** is a 64px sticky,
full-bleed `1fr auto 1fr` grid — brand hard-left, links truly centered in the viewport,
controls (course switcher · theme toggle · user menu) hard-right.

Spacing follows an informal **4 / 8 / 16** rhythm with a few fixed structural values: 24px
card padding, 14–18px inner padding on list/section cards, 16px grid gaps, and ~30px between
dashboard sections. Grids are **auto-responsive** via `repeat(auto-fit/auto-fill,
minmax(...))` — stat tiles at `minmax(180px,1fr)`, roll-up cards at `minmax(320px,1fr)`,
section assignments at `minmax(190px,1fr)` — so columns reflow without media queries.

**Whitespace philosophy:** generous *between* cards, efficient *within* them. The depth
ladder is shallow on purpose (bg → sunken → card are close in value), so separation reads
from shadow and a hairline border rather than from heavy contrast or boxes-in-boxes.

## Elevation

Three shadow tiers, each with a dark-mode pairing that deepens the alpha (dark surfaces need
heavier shadow to register):

- **`shadow-sm`** — the resting state of every card, tile, and list item. Barely-there lift.
- **`shadow-md`** — *interaction* depth: cards/list-items on hover (often with a 1px
  `translateY`), and persistent sticky bars like the grade-actions footer.
- **`shadow-lg`** — *floating* surfaces that escape the document flow: modals, the user-menu
  popover, the login card.

Radius scales with surface size: **6px** (`--radius-sm`) for inputs/buttons/chips, **10px**
(`--radius`) for cards/tiles/list-items, **14px** for modals, **16px** for the login card,
and **999px** for fully-round pills (badges, the course switcher, progress tracks, avatars).
Elevation and radius move together — bigger, more-floating surfaces get a larger radius and a
deeper shadow.

## Components

Each entry maps to a `{components.*}` token and the classes in [`css/styles.css`](css/styles.css).

- **Top nav (`.topnav`)** — `{components.topnav}`. A translucent, backdrop-blurred sticky bar.
  Three zones: brand (atom mark + iPREP wordmark + muted subtitle), centered nav links
  (text-only, with an `active` pill), and right-side controls. Collapses to a hamburger
  drawer below 860px. Built by [`js/nav.js`](js/nav.js) from the resolved role.
- **Card (`.card`)** — `{components.card}`. The base surface: white, hairline border, 10px
  radius, 24px padding, `shadow-sm`. `.card-title` + `.card-meta` are the standard header.
- **Stat tile (`.stat-tile`)** — `{components.stat-tile}`. A card variant with a 4px colored
  **left accent rail** and a tinted icon chip (accent at 16% via `color-mix`). Accent classes:
  `accent-blue/gold/green/red/amber`. The big number uses the tabular display style.
- **List item (`.list-item`)** — a horizontal card with a leading **status dot**
  (green/amber/red/blue/grey), a body (title + meta row), and a right cluster. Used for
  student to-do/up-next/graded lists; `a.list-item` lifts to `shadow-md` and a blue border on
  hover.
- **Section roll-up card (`.section-card`)** — faculty dashboard. A header strip
  (`.sc-tag` section badge + instructor meta) over a body of **progress rows**.
- **Progress row (`.progress-row`) / mini bar (`.minibar`)** — `{components.progress-row}`. A
  labeled count over a 7px pill track; fill is green, `.partial` gold, `.low` red.
- **Lesson rollup primitives (`.lr-*`)** — the shared data-viz layer for interaction
  analytics: headline **gauges** (`.lr-bar` zoned segments + floating `.lr-tag`),
  **histograms** (`.lr-hist`, fine-cell `.lr-fine` — now 6px-radius bars with absolute 0–5
  axis ticks at the group boundaries) with a class-mean reference line, an objectives
  **radar** (`.lr-radar` SVG), an **eyebrow** (`.lr-eyebrow`) section label, and clickable
  **flag chips** (`.lr-flag`) that open stacked drill-down modals. Uses the score/distribution
  ramps.

### Rollup v3 — faculty lesson summary

The faculty lesson-summary rollup was redesigned (classes in the **"Rollup v3"** block of
`css/styles.css`; intent visible in the [`test-summary.html`](../test/test-summary.html) sandbox).
It is built from bordered boxes inside a tinted header, with the AI-summary panels stubbed
until the analysis aggregator ships.

- **Tinted lesson header (`.lesson-head`)** — a full-bleed header that bleeds to the card/modal
  edge, tinted with `{colors.mc-sel-bg}`. Holds the Oswald `.lh-title` + `.lh-stats`
  (`.lh-top`), then a sub-row (`.lh-sub`) of header flag pills (`.hflags` / `.lh-flags`) with
  the scope control (`.lh-scope`) pinned right.
- **Completion badge (`.comp-block`)** — a stacked "Submitted" block: the `.lab` label over a
  big `.num` numerator with a quiet `/total` `.den`. `.comp-ok` (green) when all submitted,
  `.comp-warn` (amber) otherwise.
- **Adaptive scope control (`.seg`)** — a segmented section selector when there are few sections
  (≤ a small threshold), falling back to a `<select>` dropdown when there are many. "All
  Sections" is the whole-course average.
- **Bordered summary tiles (`.sum-row2` / `.sum-cell` / `.obj-box` / `.fw-panel`)** — the rollup
  is assembled from bordered boxes: an effort tile and radar tile side by side in `.sum-row2`
  (equal height), plus full-width `.obj-box` / `.fw-panel` panels for objectives and the AI
  summaries.
- **Effort bar chart (`.eff-*`)** — a vertical 0–5 effort distribution (`.eff-bars` / `.eff-col`
  / `.eff-bar` / `.eff-x`) that fills its tile; the class average is shown in the eyebrow.
- **Interactive radar (`.radar-wrap` / `.radar-hit` / `.radar-tip`)** — the objective-understanding
  radar with single-letter axis labels; each vertex has an invisible `.radar-hit` hover target
  that pops a `.radar-tip` tooltip (objective label + mean).
- **AI placeholders (`.ai-box` / `.ai-tbd` / `.sk` / `.fw-panel`)** — skeleton-shimmer placeholders
  (`.sk` bars) for the not-yet-built AI **effort summary** and **misconceptions & trends**
  panels.
- **Per-objective rows (`.obj-row`)** — one objective per full-width row (weakest first), each a
  header (`.obj-row-head` with `.nm` / `.mu`) over a fine-cell histogram (`.lr-fine`). The radar
  legend letter is shown as an `.ol-key` chip.
- **Header flag pills (`.fpill`)** — compact count + icon pills in the header, color-coded
  `.blue` / `.gold` / `.danger` / `.green`. Hover reveals a `.tip` detail tooltip; click opens a
  flagged-students list of `.fl-row` rows (name + section) that drills into the per-student
  modals.
- **Student-responses panel (`.sr-*`)** — selectable quote cards: AI-suggested picks
  (`.sr-quote.ai` with an `.sr-badge`) plus a random sample, each toggled selected (`.sel`) for
  copy-for-slides. A `.switch` toggle shows/hides names; `.tbtn` toolbar buttons shuffle the
  random sample and copy the selection.
- **Toolbar button (`.tbtn`)** — the small bordered button used for theme / shuffle / copy
  actions in the rollup.
- **Buttons (`.btn`)** — `primary` (Primer blue), `secondary` (border fill),
  `ghost` (`{components.button-ghost}`, outlined blue-lt), `danger` (red). `.btn-sm` and
  `.btn-block` modifiers; press gives a 1px nudge.
- **Forms (`input/textarea/select`)** — `{components.input}`. Full-width, hairline border, 6px
  radius, with a blue-lt focus ring (border + 3px glow). `.field` wraps label + control +
  `.field-hint`; `.input-error`/`.error-msg` for validation.
- **Alerts (`.alert-*`)** — `{components.alert}`. Four status families, each a `bg/fg/border`
  triad with a leading 18px PNG status glyph (`ic-error/success/info/warning`).
- **Credit toggle (`.credit-toggle`)** — `{components.credit-toggle}`. The grading control:
  cycles **full → warn → zero** with the matching status colors. Its three states are a
  contract with `scores.question_scores[].status`.
- **Score badge (`.score-badge`)** — pill with `full/partial/zero/pending` variants reusing
  the status palette.
- **Modal (`.modal`)** — `{components.modal}`. Centered card on an `{colors.overlay}` scrim,
  14px radius, `shadow-lg`. Drill-downs **stack** by z-index (60 → 70 → 80). `.md-render`
  styles DOMPurify-sanitized Markdown report bodies.
- **Table (`table` / `.table-wrap`)** — blue header row (`{colors.th-bg}`, white text), hairline
  row dividers, `surface-hover` on row hover; horizontally scrollable in `.table-wrap`.
- **Subtabs (`.subtab`)** — a pill-group segmented control (roster ↔ sections) with an active
  raised pill.
- **Login card (`.id-card`)** — `{spacing}` centered, 16px radius, `shadow-lg`, with the atom
  `.crest`, wordmark, and a muted physics-icon strip (atom · bolt · wave · magnet).
- **Icons** — `<img class="ic">` (16/20/28px) via `iconHTML(name, emoji, class)` in
  [`js/util.js`](js/util.js). Source: Freepik on Flaticon (attributed site-wide in the
  footer). Fallback chain: `ic-<name>.png` → `ic-dashboard.png` → emoji. See
  [`media/icons/ICONS.md`](media/icons/ICONS.md) for the inventory.

## Responsive Behavior

A mobile-friendly system with three breakpoints; layout reflows mostly through
`auto-fit/auto-fill` grids, with media queries reserved for structural changes.

| Breakpoint | What changes |
|---|---|
| **≤ 860px** | Nav links collapse into a hamburger drawer (`.nav-burger` shows, `.nav-links` becomes a dropdown panel); course-switcher pills tighten. |
| **≤ 680px** | The Rollup v3 effort/radar pair (`.sum-row2`) stacks from two columns to one. |
| **≤ 620px** | Legacy lesson-rollup chart rows (`.lr-row2`, `.lr-obj-grid`) stack from two columns to one; aligned eyebrow heights relax. |
| **≤ 560px** | Page gutters shrink (20px→12/18px); nav drops the brand subtitle and the user-name label (icon-only chip); stat grid and roll-up grid go single-column. |

**Touch & affordance:** interactive controls are comfortably sized (theme toggle 40px,
burger 38px, avatar 30px). Clickable analytics surfaces get the `.clickable` helper —
hover tint plus a visible `:focus-visible` outline — so progress bars and flag chips read as
actionable. Fluid grids mean most cards resize before any breakpoint fires.

## Known Gaps

- **No formal spacing/size scale token.** Padding, gaps, and margins are hand-tuned px
  literals (a 4/8/16 rhythm by convention, not enforced by variables). Radius, shadow, and
  color *are* tokenized; spacing is not yet.
- **Two diverging visual generations coexist.** The portal (`app/`) is the tokenized,
  themed target; legacy root pages (`admin.html`, `interactions-admin.html`, reached via the
  **Admin ↗** link) predate it and are *not* dark-mode aware. The portal's stylesheet keeps
  every legacy class so promotion to root doesn't break them, but they are out of scope for
  this design language until ported.
- **Exactly one self-hosted display face.** The system is system-native everywhere except hero
  titles, which use a single self-hosted condensed face (Oswald, weights 500/600). There is no
  third-party request and no flash (`font-display: swap` over a system fallback), but it is one
  more asset to ship and the only non-system type in the system — there is no broader web-font
  pipeline beyond it.
- **AI rollup panels are stubbed.** The Rollup v3 "AI effort summary" and "Misconceptions &
  trends" panels (`.ai-box` / `.ai-tbd` / `.sk`) render skeleton placeholders; the analysis
  aggregator that fills them is not yet built. The student-responses copy/shuffle interactions
  are sandbox-only until wired to real reflection data.
- **Icons are raster PNGs, single-source.** 256×256 Flaticon/Freepik art downscaled in CSS;
  there is no SVG icon set or independent tinting (the `.ic` helper sizes but does not
  recolor). New icons must come from the same author to keep the footer attribution accurate.
- **No documented motion system.** Transitions are short, ad-hoc easings (0.12–0.4s on
  background/box-shadow/width/transform). There are no shared duration/easing tokens and no
  reduced-motion handling yet.
- **Light/dark only.** No high-contrast or forced-colors mode; theming is the two-palette
  swap. Status colors are tuned for legibility in both but not formally contrast-audited.
- **Data-viz ramps are bespoke.** The 5-zone score and 6-step distribution ramps are tuned by
  eye for the 0–5 lesson scale; they aren't a general-purpose, accessibility-checked chart
  palette and assume that specific domain.
- **Section scoping is presentational, not enforced.** What a faculty member *sees* is
  filtered in client JS (mirroring the legacy app), not by row-level security — a design/UX
  boundary, not a security boundary.
