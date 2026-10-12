# Spec Delta

## ADDED Requirements

### Requirement: Deployment-Resolved Skill Script Root Identity

Each selected agent type SHALL have one absolute deployment-resolved script root shared by prompts/retries, script inventory/matching, readiness and skill mounts. Session cwd and HOME SHALL NOT independently select it. Root-resolution failure SHALL be explicit with no cross-agent fallback. Instruction paths SHALL NOT manufacture OMP owned or critical-skill provenance.

#### Scenario: OMP container uses the owned installation
- **GIVEN** the image-owned skills are installed at `/opt/air/skills` and the personal tree also exists
- **WHEN** an OMP session resolves its skill scripts
- **THEN** every script-root consumer SHALL use `/opt/air/skills`
- **AND** the personal tree SHALL contribute no OMP script grant or critical-skill authority

#### Scenario: OpenCode container uses the actual shared install tree
- **GIVEN** an OpenCode container has built-ins and configured external skills installed at `/home/deno/.agents/skills`
- **WHEN** its prompt, inventory, permission decision and readiness check select skill scripts
- **THEN** each SHALL use the explicitly configured `/home/deno/.agents/skills` root
- **AND** the nonexistent `/app/skills` and any child-HOME spelling SHALL NOT be selected

#### Scenario: Repository development resolution agrees
- **GIVEN** the deployment working directory is the repository root and no OMP image skill root exists
- **WHEN** either agent type resolves its development scripts with the default OpenCode `skills` setting
- **THEN** each script-root consumer SHALL identify the validated repository `skills/` tree by its absolute path
- **AND** OMP native owned/critical provenance SHALL remain denied when the declared owned source is absent or unowned

#### Scenario: Dashboard override and recovered pooled session retain root identity
- **GIVEN** a selected session agent type differs from the deployment default, or a pooled session reconnects
- **WHEN** prompts/retries and its connector are constructed or recovered
- **THEN** their root SHALL be the resolver output for that session's selected type
- **AND** reconnect SHALL NOT substitute a process/session cwd or the other agent's installed tree

#### Scenario: Unresolvable root fails explicitly
- **GIVEN** the selected agent's deployment root cannot be resolved or observed
- **WHEN** a skill-backed session is prepared
- **THEN** preparation SHALL fail with a configuration error before an agent subprocess is launched
- **AND** no empty inventory, HOME scan or relative cwd fallback SHALL make preparation succeed
