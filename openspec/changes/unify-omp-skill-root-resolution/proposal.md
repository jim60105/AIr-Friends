# Proposal

## Why

C6 unified prompt recipes around `resolveTrustedSkillsRoot()`, but ACP auto-approval and readiness still derive unrelated cwd/HOME roots. The permission matcher accepts any same-suffix planted script, and OpenCode's restricted skill patterns can bypass that matcher entirely.

## What Changes

- Pass the single resolver output for the selected agent type into script inventory, ACP matching, readiness and read-only skill mounts. Keep `/opt/air/skills` as OMP image authority, `/home/deno/.agents/skills` as the explicitly configured OpenCode image install root, and the validated repository `skills/` tree for development.
- **BREAKING** Replace suffix grants with canonical absolute entrypoint membership in the resolved root and its enumerated scripts; remove HOME scans, cwd constructor fallback and missing-skill-to-command-prefix promotion. Route restricted OpenCode script execution patterns through ACP `ask`.
- Publish Feature 27 installations into the explicit OpenCode `agent.skillsDir` root before AgentCore construction. External OpenCode scripts share that root with built-ins. The external/personal tree never becomes a second OMP trusted root or critical-skill source.
- Use one deployment-controlled bundled-skill catalog for OMP inventory, external-name collision protection and owned image packaging. External publication into the shared development root must never gain OMP approval or enter a subsequent owned image build.
- Preserve installation failure isolation, existing command-based skills when observed, payload/JWT/session rules, OMP ownership/generation checks and native-YOLO posture.
- Update regression coverage and deployment/permission documentation in the implementation cutover. No compatibility paths or migrations.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `skills-and-reply`: one deployment-resolved script root shared by every consumer, with deployment-shape parity.
- `acp-integration`: root-exact script auto-approval, explicit inventory input and absence handling.
- `agent-sandbox-hardening`: restricted script patterns reach the ACP gate; read-only skill mounts follow the selected root.
- `configuration-and-deployment`: explicit external install destination and readiness/root parity, including the stock image default.
- `container-packaging`: owned skill image content excludes development-installed external additions.

## Impact

Implementation touches `src/core/skills-root.ts`, the bundled-skill catalog and packaging filter, installer/bootstrap, ACP client/connector/types/factory/sandbox inputs, session/process-pool/dashboard caller wiring, healthcheck, `agent-config/opencode.json`, Containerfile and deployment examples. Existing unit and mock integration suites gain identity, planted-copy and install-location regressions. No runtime dependency or agent version change is required.

One atomic change is budgeted at eight engineer-hours. Splitting inventory from matching would temporarily preserve a permissive gate or break valid image invocations. C6 is already archived; there are no active prerequisites or active code conflicts as of proposal discovery.
