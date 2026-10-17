# Design

## Problem

Seven requirement descriptions in three capability specs exceed the 500-character authoring limit
the OpenSpec validator enforces (`MAX_REQUIREMENT_TEXT_LENGTH`). The measured lengths are 2780
(`Available Template Variables`), 2961 and 2262 (`shared-acp-process-pool`), and 1870 / 2281 /
3631 / 507 (`skills-and-reply`). The limit counts the text between `### Requirement:` and the first
`#### Scenario:` — blank lines dropped, lines joined with newlines, fenced lines excluded — which is
why a variable table inside a description is counted as prose.

## Decision

Follow the OpenSpec instruction for an existing long requirement, which is the only sanctioned
repair shape (trimming an existing description without the user asking is explicitly discouraged):

1. `MODIFIED` keeps the requirement header and **every** existing scenario byte-identical; only the
   description changes, reduced to a single headline behavior ≤500 characters that still contains
   `SHALL` and introduces no claim the original description did not make.
2. Each behavior removed from that description becomes an `ADDED` requirement with its own
   `#### Scenario:` blocks. Added descriptions also obey the 500-character limit (the validator
   checks ADDED blocks too).
3. New scenarios live only in ADDED requirements, so the archive diff for each existing requirement
   is exactly one description line per requirement.

No behavior is dropped: the removed text is redistributed, never deleted. Because scenarios
attached to a requirement are preserved verbatim, the moved behavior's normative home is the added
requirement, whose scenarios must state it concretely.

## Verification

- `node /tmp/deltacheck.mjs <main-spec> <delta> "<offenders>"` (throwaway harness) asserts for every
  MODIFIED block: same scenario name set, no added or renamed scenario, every scenario body
  byte-identical to the main spec, description non-empty, ≤500 characters, containing `SHALL`; for
  every ADDED block: no name collision with the main spec, ≥1 scenario, description ≤500 characters
  with `SHALL`; and — for the seven replaced descriptions — that every identifier token
  (`backticked` literal, `$ENV_VAR`, `SCREAMING_SNAKE` code, camelCase symbol) from the original text
  still appears in the delta.
- `openspec validate split-overlong-requirement-descriptions --strict` gates the change itself.
- `openspec archive … --yes` then `openspec validate --all --strict` must report every spec passing;
  before this change the same command reported three failures and 69 passes.

## Alternatives considered

- **Trim the descriptions in place.** Rejected: the instruction forbids cutting an existing
  description merely to meet the length, and it would silently drop behaviors with no normative
  home.
- **Move the surplus prose into the requirement's own scenarios.** Rejected: it would edit scenario
  bodies, enlarging the diff for a text-hygiene repair and blurring scenario semantics (a scenario
  states an observable outcome, not a catalog).
- **Fence the surplus text so the validator skips it.** Rejected: hiding normative text inside a
  code fence defeats the check rather than satisfying it.
