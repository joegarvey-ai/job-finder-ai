# Eval Harness

A regression test suite for the LLM-driven evaluation modes (`modes/oferta.md` + `modes/_shared.md` + the user's `cv.md` / `_profile.md` / `profile.yml`).

The harness exists to answer one question: **did a change to the prompts break the evaluator?** It does this by running a small set of canonical job descriptions through the evaluator and grading the structured output against expected ranges.

## What's in here

```
evals/
├── README.md               ← you are here
├── run-evals.mjs           ← runner
├── cases/                  ← test cases (one folder per case)
│   ├── 01-strong-ai-pm-match/
│   │   ├── input.txt       ← the JD text
│   │   └── expected.yml    ← assertions to check
│   ├── 02-engineer-title-mismatch/
│   ...
└── (results/ — gitignored output of `run-evals.mjs --save`)
```

## Backends

The runner uses `gemini-eval.mjs` to drive evaluations. Gemini's free tier (15 RPM / 1M tokens/day with `gemini-2.5-flash`) is plenty for running this suite.

Prerequisite: set `GEMINI_API_KEY` in `.env` (see `.env.example`). You can also run individual evaluations through Claude Code — paste the JD and the human-eyeball the output — but the runner expects the Gemini backend so it can parse the `SCORE_SUMMARY` block.

## Running the suite

```bash
node evals/run-evals.mjs               # run all cases
node evals/run-evals.mjs 01            # run just case 01
node evals/run-evals.mjs --save        # save raw outputs to evals/results/
```

Each case prints `PASS` / `FAIL` with the failing assertion. The runner exits non-zero if any case fails.

## Expected assertion format

`expected.yml` per case supports:

```yaml
# Range the global score should fall in
score:
  min: 4.0
  max: 5.0

# Archetype(s) the evaluator could plausibly pick (case-insensitive substring match)
archetype_any_of:
  - "AI/ML Product Leader"
  - "Principal PM IC"
  - "Technical AI Product Manager"
  - "LLMOps"

# Legitimacy tier (Block G)
legitimacy_any_of:
  - "High Confidence"
  - "Proceed with Caution"

# Substrings the evaluation MUST contain (case-insensitive)
must_contain:
  - "Block A"
  - "Block B"
  - "Block G"
  - "Scoring Checklist"

# Substrings the evaluation must NOT contain — useful for negative tests
must_not_contain:
  - "missing block"

# Free-text note explaining the case (not graded, just for humans)
notes: "Strong AI PM match. Joe's archetypes should fire and score 4+."
```

All fields are optional. A case with only `notes` will always pass (useful for smoke-testing the pipeline).

## Why score *ranges*?

LLM evaluations aren't deterministic — even at `temperature: 0.4` you'll see ±0.3 drift between runs. Ranges of ±0.5 are usually a good fit. Tighten when the case has a clear hard gate (SKIP from comp floor, title mismatch).

## Authoring new cases

1. `mkdir evals/cases/06-your-case-name`
2. Drop the JD text in `input.txt` (anonymize if it's a real listing)
3. Write `expected.yml` with the assertions you care about
4. Run `node evals/run-evals.mjs 06`

Good cases test **one** behavior. Don't bundle "below comp floor + title mismatch + suspicious legitimacy" — split them.
