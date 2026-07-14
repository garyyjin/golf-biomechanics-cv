---
version: alpha
name: Golf-Swing-Analyzer
description: >
  A dark, precision-instrument design system for a golf swing biomechanics tool.
  Near-black canvas with a four-step surface ladder lets uploaded video and pose
  overlays read as the protagonist, the way a broadcast telestrator or Linear's
  product screenshots stay legible against dark chrome. A single chromatic
  accent — a crisp fairway green — carries every primary action and "within
  range" signal; nothing else competes with it. Data-dense readouts (joint
  angles, tempo ratios, progress percentages) are set in a monospace face with
  tabular figures, the way Vercel reserves its mono face for anything technical.
  Radii stay small and consistent (8–16px) instead of the oversized pill/blob
  shapes of a default AI-generated layout — this should read as an instrument
  panel, not a marketing page.

colors:
  primary: "#59e37c"
  primary-hover: "#7cf09a"
  primary-press: "#3fc468"
  on-primary: "#07240f"
  canvas: "#0a0d0a"
  surface-1: "#12160f"
  surface-2: "#171c15"
  surface-3: "#1d231a"
  hairline: "#262d22"
  hairline-strong: "#38412f"
  ink: "#f3f6f0"
  ink-muted: "#c3cabd"
  ink-subtle: "#8b9484"
  ink-tertiary: "#5b6355"
  warning: "#f5a623"
  error: "#ff6b57"
  overlay-scrim: "rgba(6, 8, 6, 0.6)"

typography:
  display:
    fontFamily: Inter
    fontSize: 34px
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: -0.8px
  headline:
    fontFamily: Inter
    fontSize: 22px
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: -0.3px
  title:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: -0.1px
  body:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
  body-sm:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.45
  eyebrow:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: 0.6px
    textTransform: uppercase
  button:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: 600
    lineHeight: 1.2
  data:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: 500
    lineHeight: 1.4

rounded:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  pill: 9999px

spacing:
  xxs: 4px
  xs: 8px
  sm: 12px
  md: 16px
  lg: 24px
  xl: 32px
  xxl: 48px
  section: 64px

components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button}"
    rounded: "{rounded.sm}"
    padding: 11px 20px
  button-secondary:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.sm}"
    padding: 11px 20px
    borderColor: "{colors.hairline}"
  toggle-pill:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink-muted}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    padding: 8px 16px
  toggle-pill-selected:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.canvas}"
    rounded: "{rounded.pill}"
  card:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    borderColor: "{colors.hairline}"
    padding: 28px
  nested-card:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    borderColor: "{colors.hairline}"
  status-badge:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink-muted}"
    typography: "{typography.eyebrow}"
    rounded: "{rounded.pill}"
    padding: 2px 9px
---

## Overview

This app is a review instrument, not a storefront: someone uploads a swing video and studies pose overlays, joint-angle readouts, and phase-by-phase feedback next to a reference clip. The chrome's job is to disappear so the video and the numbers can carry the page. That single goal drives every decision below — dark canvas, one accent color, monospace data, small consistent radii.

**Key characteristics:**
- Near-black canvas (`{colors.canvas}` `#0a0d0a`) with a three-step surface ladder for cards and nested panels — never a shadow-only lift on a light background.
- **One chromatic accent** — fairway green `{colors.primary}` — used only for the primary CTA, "within range" signals, active toggle states, and focus rings. Everything else stays neutral ink/gray.
- Numeric data (angles, tempo ratios, percentages, frame counts) is always set in `{typography.data}` (JetBrains Mono, tabular figures) — this is what separates an instrument readout from a marketing stat.
- Small radius scale (4–16px). No pill-shaped cards, no 40px+ blob corners.
- Elevation comes from the surface ladder + 1px hairlines, not heavy drop shadows.

## Colors

### Brand & Accent
- **Fairway** (`{colors.primary}` `#59e37c`): primary CTA, active/selected states, "within range" feedback dot, focus rings, progress fill. Used sparingly — if more than one element per view is fairway-green, demote one to secondary.
- **Fairway Hover** (`{colors.primary-hover}`) / **Fairway Press** (`{colors.primary-press}`): interaction states for the primary button and progress affordances.
- **On Primary** (`{colors.on-primary}` `#07240f`): text/icon color on top of fairway-green fills — a near-black green, not pure white, for a warmer contrast pairing.

### Surface
- **Canvas** (`{colors.canvas}`): page background.
- **Surface 1** (`{colors.surface-1}`): default card level — upload panel, readout panel, feedback panel, library cards.
- **Surface 2** (`{colors.surface-2}`): nested elements inside a card — feedback rows, tempo card, badges, secondary buttons.
- **Surface 3** (`{colors.surface-3}`): modals and the deepest lift.
- **Hairline** (`{colors.hairline}`) / **Hairline Strong** (`{colors.hairline-strong}`): 1px borders; strong variant for hover/focus states and dividers that need more presence.

### Text
- **Ink** (`{colors.ink}`): headlines and primary body text — warm off-white, not pure white.
- **Ink Muted** (`{colors.ink-muted}`): secondary text, unselected toggle labels.
- **Ink Subtle** (`{colors.ink-subtle}`): captions, hints, metadata.
- **Ink Tertiary** (`{colors.ink-tertiary}`): disabled text, least-emphasis labels.

### Semantic
- **Warning** (`{colors.warning}`): above/below-target readouts, non-blocking alerts.
- **Error** (`{colors.error}`): failed uploads/analysis, destructive-action confirmation text.

## Typography

Inter carries every UI element; JetBrains Mono carries every number. That split is the system's main discipline — never set a metric value in Inter, never set a sentence in mono.

| Token | Size | Weight | Use |
|---|---|---|---|
| `{typography.display}` | 34px | 700 | Page-level heading (one per screen) |
| `{typography.headline}` | 22px | 600 | Section headings |
| `{typography.title}` | 16px | 600 | Card titles |
| `{typography.body}` | 14px | 400 | Default body text |
| `{typography.body-sm}` | 13px | 400 | Secondary body, captions |
| `{typography.eyebrow}` | 11px | 600 | Uppercase labels above fields/sections |
| `{typography.button}` | 14px | 600 | All button/toggle labels |
| `{typography.data}` | 13px | 500 mono | Every numeric readout — angles, tempo, %, frame index |

Fallback stack: `Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` and `"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace`.

## Layout

- **Base unit:** 4px. Tokens: `{spacing.xxs}` 4 · `{spacing.xs}` 8 · `{spacing.sm}` 12 · `{spacing.md}` 16 · `{spacing.lg}` 24 · `{spacing.xl}` 32 · `{spacing.xxl}` 48 · `{spacing.section}` 64.
- Card interior padding: 24–28px (`{spacing.lg}`–ish). Nested rows: 12–16px.
- Max content width stays fluid via `clamp()` gutters — this is an app shell, not a marketing page with a fixed container.

## Elevation & Depth

| Level | Treatment | Use |
|---|---|---|
| 0 — Flat | No border, no shadow | Canvas background, plain text |
| 1 — Card | `{colors.surface-1}` fill, 1px `{colors.hairline}` border, faint shadow (`0 1px 2px rgba(0,0,0,.3), 0 8px 24px rgba(0,0,0,.25)`) | Default cards |
| 2 — Nested | `{colors.surface-2}` fill, 1px `{colors.hairline}` border | Rows/badges inside a card |
| 3 — Modal | `{colors.surface-3}` fill, stronger shadow | Modal dialogs |
| Focus | 2px `{colors.primary}` outline at 40% opacity | Focused input/button |

No colored glows, no gradients, no blur atmospherics — the surface ladder and hairlines do all the work.

## Shapes

| Token | Value | Use |
|---|---|---|
| `{rounded.xs}` | 4px | Inline chips, swatches |
| `{rounded.sm}` | 8px | Buttons, inputs, video/media corners |
| `{rounded.md}` | 12px | Nested cards (feedback rows, tempo card) |
| `{rounded.lg}` | 16px | Top-level cards (upload, readout, feedback, library panels) |
| `{rounded.pill}` | 9999px | Toggle groups and status badges only — never a primary card |

## Components

- **`button-primary`** — fairway-green fill, `{colors.on-primary}` text, `{rounded.sm}`. The single primary action per screen ("Analyze swing", "Add to library").
- **`button-secondary`** — `{colors.surface-2}` fill with hairline border, ink text. Everything that isn't the primary action.
- **`toggle-pill`** / **`toggle-pill-selected`** — segmented control for view/handedness/quality. Selected state flips to solid ink-on-canvas (not fairway-green — green stays reserved for the primary CTA and status signal).
- **`card`** — the four top-level panels (upload, readout, feedback, library). `{rounded.lg}`, hairline border, Level-1 shadow.
- **`nested-card`** — feedback rows, tempo card, comparison canvas. `{rounded.md}`, sits on `{colors.surface-2}` inside a card.
- **`status-badge`** — small pills for source labels ("Library" / "Default") and phase chips. `{typography.eyebrow}`, `{rounded.pill}`.

## Do's and Don'ts

### Do
- Keep fairway green scarce: primary CTA, "within range" dot, active focus ring, progress fill. That's the whole list.
- Set every numeric value — degrees, ratios, percentages, frame counts — in `{typography.data}` with tabular figures.
- Use the three-step surface ladder for hierarchy instead of shadows on a light background.
- Keep radii in the 4–16px range across the whole app.

### Don't
- Don't introduce a second chromatic accent. Warning/error stay desaturated relative to the fairway green.
- Don't set body copy or labels in the mono face — it's reserved for numbers.
- Don't use pill/blob radii (24px+) on cards — that reads as generic AI-generated chrome, which is exactly what this system replaces.
- Don't add drop shadows heavier than the Level-1 spec; the dark canvas should feel calm, not glossy.
