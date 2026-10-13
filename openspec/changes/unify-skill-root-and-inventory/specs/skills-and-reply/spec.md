# Spec Delta

## REMOVED Requirements

### Requirement: Deployment-Resolved Skill Script Root Identity

**Reason**: Replaced by `Deployment-Resolved Skill Script Root Identity for Both Agent Types`. This requirement stated the contract per selected agent type and its scenario `OMP container uses the owned installation` asserted that every OMP script-root consumer uses `/opt/air/skills` while the personal tree contributes no grant — the asymmetric selection this change removes.
**Migration**: No operator action. One configured value now names the root for both agent types; the canonical observation, the explicit failure posture and the delivered-prompt root contract are unchanged.

## ADDED Requirements

### Requirement: Deployment-Resolved Skill Script Root Identity for Both Agent Types

Both agent types SHALL resolve ONE absolute deployment-resolved script root from the same configuration, shared by prompts/retries, script inventory and matching, readiness and skill mounts. Agent type, session cwd and HOME SHALL NOT independently select it. Root-resolution failure SHALL be explicit with no cross-agent fallback, and an instruction path SHALL NOT manufacture OMP owned or critical-skill provenance.

#### Scenario: Both agent types use the single configured installation

- **GIVEN** the deployment configures one skill root and an `opencode` session and an `omp` session both require skill scripts
- **WHEN** each session resolves its script root
- **THEN** every script-root consumer of both sessions SHALL use that one canonical absolute root
- **AND** no separately packaged skill tree SHALL contribute a grant to either session

#### Scenario: OpenCode container uses the actual shared install tree

- **GIVEN** an OpenCode container has built-ins and configured external skills installed under the configured root
- **WHEN** its prompt, inventory, permission decision and readiness check select skill scripts
- **THEN** each SHALL use that explicitly configured root
- **AND** the nonexistent `/app/skills` and any child-HOME spelling SHALL NOT be selected

#### Scenario: Repository development resolution agrees

- **GIVEN** the deployment working directory is the repository root and the default `skills` setting is in use
- **WHEN** either agent type resolves its development scripts
- **THEN** each script-root consumer SHALL identify the validated repository `skills/` tree by its absolute path
- **AND** no image skill root SHALL be substituted for either agent type

#### Scenario: Dashboard override and recovered pooled session retain root identity

- **GIVEN** a selected session agent type differs from the deployment default, or a pooled session reconnects
- **WHEN** prompts/retries and its connector are constructed or recovered
- **THEN** their root SHALL remain the single resolved root of that deployment
- **AND** reconnect SHALL NOT substitute a process/session cwd or a second installed tree

#### Scenario: Unresolvable root fails explicitly

- **GIVEN** the configured deployment root cannot be resolved or observed
- **WHEN** a skill-backed session of either agent type is prepared
- **THEN** preparation SHALL fail with a configuration error before an agent subprocess is launched
- **AND** no empty inventory, HOME scan or relative cwd fallback SHALL make preparation succeed

#### Scenario: Per-spawn and pooled connectors resolve the identical root

- **GIVEN** one deployment configuration used by a per-spawn connector and by a pooled connector
- **WHEN** both prepare sessions of either agent type
- **THEN** their resolved script root SHALL be byte-identical
- **AND** resolution SHALL NOT read the `SESSION_ID` environment variable or any other per-session value to select a root
