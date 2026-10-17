# Proposal

## Why

`openspec validate --all --strict` fails on three capability specs because seven requirement
descriptions exceed the 500-character authoring limit (`requirements[4]` of
`prompt-template-system`, `requirements[1]`/`[2]` of `shared-acp-process-pool`, and
`requirements[5]`/`[6]`/`[7]`/`[19]` of `skills-and-reply`). Each description states several
behaviors at once, so the strict gate has been reporting these specs as failed and the
per-requirement contract is harder to consume than the scenarios already implementing it.

The descriptions are the durable contract, so the repairs must not change any behavior: only the
form, per the OpenSpec instruction for an existing long requirement ("keep its header and every
scenario and cut its description down to one behavior without changing its meaning, then add each
behavior you removed as its own ADDED requirement with its own scenarios").

## What Changes

- Cut each of the seven over-long descriptions to one behavior (≤500 characters, still carrying
  `SHALL`), keeping the requirement header and every one of its scenarios byte-identical.
- Add one requirement per behavior removed from those descriptions, each with its own scenarios
  asserting that behavior concretely, so no constraint, identifier, path, flag name or error code
  from the replaced text is lost.
- No production code, prompt template, skill script, configuration or documentation changes: the
  observable system behavior described by these specs is unchanged by definition.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `prompt-template-system`: one description split (`Available Template Variables`).
- `shared-acp-process-pool`: two descriptions split (`Session Resumption After Process Death`,
  `Shared Process Environment Scoping`).
- `skills-and-reply`: four descriptions split (`Retry on Missing Reply`,
  `Instructive Skill Error Messages`, `Payload-File Argument Passing`,
  `Agent-Portable Staging And Session Identity`).

## Impact

Affected files: `openspec/specs/prompt-template-system/spec.md`,
`openspec/specs/shared-acp-process-pool/spec.md`, `openspec/specs/skills-and-reply/spec.md`
(archive-synced from this change's deltas). No source, test, prompt, skill, container or
configuration file is touched; no runtime behavior, API, environment field or deployment contract
changes. Consumers of these specs (docs and tests that cite them) keep every existing requirement
and scenario name, so no citation breaks.

## Estimate

Total: **1.5 engineering hours**, strictly below 8 hours: 0.5h for the three delta files, 0.5h for
mechanical verification (scenario byte-identity, description length, identifier conservation
against the replaced descriptions), 0.25h for the archive-sync gate and 0.25h contingency. This is
an artifact repair under an explicit user request; no behavior, deployment or operator action is
introduced.
