---
name: "LOOP Codex Desktop Reference"
description: "A restrained desktop coding workspace modeled on the Codex app interaction grammar."
colors:
  canvas: "#ffffff"
  sidebar: "#f7f7f5"
  raised: "#ffffff"
  subtle: "#f2f2ef"
  ink: "#20201e"
  secondary-ink: "#6f6f6b"
  hairline: "#e7e7e3"
  selected: "#eaeae6"
  success: "#16865c"
  danger: "#c9473d"
  diff-add: "#e9f6ee"
  diff-delete: "#fceceb"
  border-soft: "#cbc9c2"
  border-control: "#cecec9"
  border-focus: "#a7a7a1"
  ink-hover: "#343431"
  avatar: "#444440"
  code-ink: "#454541"
  placeholder: "#777772"
  switch-off: "#c8c8c3"
  line-number: "#969690"
  focus: "#3b78c6"
typography:
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, PingFang SC, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "0"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, PingFang SC, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.62
    letterSpacing: "0"
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, PingFang SC, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0"
  code:
    fontFamily: "SFMono-Regular, Cascadia Code, Consolas, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "0"
  micro:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, PingFang SC, sans-serif"
    fontSize: "9px"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "0"
  caption:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, PingFang SC, sans-serif"
    fontSize: "10px"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "0"
  control:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, PingFang SC, sans-serif"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0"
  heading:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, PingFang SC, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "0"
  display:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, PingFang SC, sans-serif"
    fontSize: "21px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "0"
rounded:
  xs: "5px"
  control: "6px"
  field: "7px"
  block: "8px"
  queue: "9px"
  surface: "10px"
  logo: "11px"
  dialog: "12px"
  bubble: "14px"
  composer: "16px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.canvas}"
    rounded: "{rounded.control}"
    height: "32px"
    padding: "0 12px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: "30px"
    padding: "0 8px"
  composer:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.composer}"
    padding: "10px"
---

# Design System: LOOP Codex Desktop Reference

## Overview

**Creative North Star: "Codex, translated for LOOP"**

This direction deliberately follows the Codex desktop app's quiet operating grammar: neutral layered surfaces, compact controls, an unframed transcript, semantic tool glyphs, and progressive disclosure for technical detail. It replaces the previous dark branded sidebar, colored tool cards, decorative shadows, and custom visual flourishes.

The reference version is `rust-v0.145.0`. That public GitHub release contains the CLI, TUI, app server, and desktop handoff, but not the desktop client's component source. Exact desktop behavior is therefore based on official Codex app documentation where the release itself is silent; the prototype must not claim that inferred pixels came from open source.

## Colors

White content and a warm-neutral sidebar carry almost the entire window. Color is reserved for status and diff meaning.

- **Canvas** (`#ffffff`): transcript and settings content.
- **Sidebar** (`#f7f7f5`): project and history navigation.
- **Subtle** (`#f2f2ef`): hover, output and secondary control surfaces.
- **Ink** (`#20201e`): primary text and the single primary action.
- **Success** (`#16865c`): completion and added code only.
- **Danger** (`#c9473d`): failure, stop, deletion and removed code only.

**The Status-Only Color Rule.** Do not use product accent colors to decorate navigation, tool icons, borders or large surfaces.

## Typography

Use the native desktop UI stack. Body text stays between 12 and 14 pixels; code alone uses the native monospace stack. Chinese copy should read with the same density as English Codex controls, with no artificial letter spacing.

## Layout

The app has three stable regions: a 248px project/history sidebar, a flexible transcript with a centered 720px reading column, and an optional 46% review pane. The composer is pinned within the transcript column rather than floating over content. At narrow desktop widths the sidebar becomes an icon rail; the review pane takes the main workspace while preserving a back action.

## Elevation & Depth

The system is flat by default. One-pixel tonal boundaries separate regions. Shadows appear only on popovers, the composer and the prototype-only scene switcher, always neutral and offset.

## Shapes

Navigation and small buttons use 6px corners, temporary surfaces use 10px, and the composer uses a 16px continuous corner. Tool rows are not placed inside cards. Circular shapes are limited to status dots, avatars and icon-only actions that need a stable hit target.

## Components

- **Brand:** the “A / 回环” mark from `2pi-logo-options.html` is used as the composer send control and rotates on the red stop state while a task is running. The sidebar starts directly with task controls and does not repeat a logo or wordmark.
- **Tool chain:** one semantic Lucide glyph per operation, a continuous 1px connector, one-line summaries at rest, and nested details on disclosure.
- **Composer:** unframed textarea above a compact contract row containing project, model, reasoning and execution mode.
- **History:** searchable, project-grouped rows with rename, pin and archive actions exposed on hover or keyboard focus.
- **Diff:** file list plus unified diff, collapsible files/hunks, stage/revert actions, and inline feedback on a hovered line.
- **Motion:** 140-220ms state changes using exponential ease-out. Streaming and active-run motion may loop; confirmations and retry feedback run once.

## Do's and Don'ts

### Do:

- **Do** keep the transcript mostly unframed and let spacing establish hierarchy.
- **Do** use recognizable tool glyphs at 15-16px with the same stroke weight.
- **Do** summarize long commands and outputs before exposing raw details.
- **Do** preserve keyboard focus, reduced-motion behavior and long-path wrapping.

### Don't:

- **Don't** restore the carbon sidebar, mineral green palette or icon tiles from the discarded prototype.
- **Don't** use gradients, glow, oversized type, nested cards or marketing composition.
- **Don't** expose raw reasoning; show short status summaries and observable tool activity.
- **Don't** represent state with color alone.
