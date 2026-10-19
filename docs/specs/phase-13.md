# Phase 13 — The landing page

**Goal.** A page a stranger can land on that shows what this is, and is
recognisably the same piece of software as the tool behind it.

## Build

- A marketing page at the root, signed out, with a sticky header carrying the
  product name, a theme control and a way in.
- The hero takes a repository URL and submits it straight into the flow, so the
  first thing on the page is the product rather than a button that scrolls
  somewhere.
- Sections after it, each separated by a hairline rule: what the thing does, how
  it works, which frameworks it understands, and last, what it deliberately
  doesn't do. That last one is the most interesting section and it goes at the
  end, where someone still reading will reach it.
- Illustrations rather than screenshots, drawn as inline SVG.
- A quiet footer.

## Proportions

This is a marketing page for a developer tool, not a product template, and the
spacing does most of the work.

- One content column, capped around 1140px, centred, 24px gutter.
- The hero takes most of the first screen. Every section after it carries
  generous and consistent vertical padding, closer to 8rem than 2.
- Headings scale with the viewport and sit tight — leading near 1.1, negative
  letter-spacing.
- **Every paragraph is capped by measure**, around 46 characters beside a
  figure and 64 across a full-width section. Text running the full column width
  is the single fastest way to make this look generated.
- Column gaps are wide. 5rem between text and figure, not 1.

## The illustrations

- **Drawn, not captured.** A screenshot of a real repository ages badly and
  shows a stranger's directory names, which are noise to a first-time reader.
- **Unlabelled.** The moment a node reads `features/arena` it stops being a
  drawing and becomes a claim about somebody's code.
- They take their colours from the same place the canvas does. Nothing on this
  page defines a colour of its own.
- Static. Nothing animates.

## Constraints

<!-- TODO: not visible in the screenshots -->

## Acceptance check

<!-- TODO: not visible in the screenshots -->