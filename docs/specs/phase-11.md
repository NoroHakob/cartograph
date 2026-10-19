# Phase 11 — Evals

**Goal.** Answer quality stops being an opinion and becomes a number.

## Build

- A way for scripts outside the web app to load the same environment.
- **The invented-path check.** Take every path-shaped token in an explanation and test it against the exact set of paths the model was shown. Anything else was invented. Run it as a live evaluator against real traffic, not only against a saved dataset.
- **Role accuracy.** Convention already assigns roles it can be certain of, and those files never reach the model in normal operation — which makes them a held-out set with real ground truth. Hide the role, ask the model, compare.
- **Prompt versions.** The current explanation prompt and a previous one, run over the same dataset as two separate experiments, scored side by side.

## Constraints

- The invented-path check is deterministic code, not a model grading a model. This is set membership — it has an exact answer, and a hallucination detector that hallucinates is worth nothing.
- The role dataset holds only files whose conventional role is one the classifier is actually allowed to return. Scoring it on questions it's forbidden to answer measures nothing.
- The retired prompt lives with the evals, not in the application. Shipping a dead prompt so a test can reach it is the test shaping the product.
- The prompt-version comparison does need a model as judge, unavoidably — "is this specific enough to be useful" has no exact answer. Say that out loud rather than presenting the number as harder than it is.

## Acceptance check

<!-- Not visible yet. -->