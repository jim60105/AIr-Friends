# Spec Delta

## RENAMED Requirements

- FROM: `### Requirement: Stock Image Declares Its OpenCode Skill Install Root`
- TO: `### Requirement: Stock Image Declares the Shared Skill Install Root`

## REMOVED Requirements

### Requirement: Health Check Endpoint in Container

**Reason**: Replaced by `Container Health and Skill Readiness Endpoints`, because the readiness scenario `OMP readiness ignores the personal copy` asserted that OMP readiness uses `/opt/air/skills` even when the configured skill directory points elsewhere — the asymmetry this change removes.
**Migration**: No operator action. Readiness now checks registered scripts under the single resolved root for either agent type; the health endpoints, the 30-second cache and the 503 failure posture are unchanged.

### Requirement: External Skill Auto-Installation

**Reason**: Replaced by `External Skill Auto-Installation Into the Single Skill Root`, because the scenario `OMP default does not trust external OpenCode installs` asserted that OMP keeps a separate owned script root and denies external-tree copies — the asymmetry this change removes.
**Migration**: No operator action. Existing `agent.externalSkills` values keep working; they are now published into the same resolved root that both agent types use.

## MODIFIED Requirements

### Requirement: Stock Image Declares the Shared Skill Install Root

The stock container deployment SHALL explicitly set the single skill-directory configuration to `/home/deno/.agents/skills`, matching both built-in COPY and external publication for every agent type. Helm and deployment examples SHALL document this same installation contract. Repository development SHALL retain relative `skills` resolved against the deployment working directory. Ambient HOME SHALL NOT supply this configuration.

#### Scenario: Stock image requires no missing cwd skill tree

- **GIVEN** the stock image runs from `/app` without an operator skill-directory override
- **WHEN** its existing configuration is loaded
- **THEN** both agent types SHALL select `/home/deno/.agents/skills` from that one configured value
- **AND** neither agent type SHALL select a separately packaged image tree

## ADDED Requirements

### Requirement: Container Health and Skill Readiness Endpoints

The container SHALL provide HTTP health check capability via the HealthCheckServer. Skill readiness SHALL check registered scripts under the single deployment-resolved root used by every selected agent type's prompts and script gate. Root-resolution errors SHALL produce an explicit failed readiness check without consulting an alternate root. Existing liveness behavior and readiness caching SHALL remain unchanged.

#### Scenario: Health Check Server

- **GIVEN** `health.enabled` is `true` and `health.port` is `8080`
- **WHEN** the server starts
- **THEN** `GET /health` and `GET /healthz` SHALL return health status with HTTP 200 (healthy/degraded) or 503 (unhealthy)
- **AND** `GET /ready` and `GET /readyz` SHALL check platform connections and skill readiness

#### Scenario: Readiness uses the single configured root for either agent type

- **GIVEN** built-in scripts exist under the configured `agent.skillsDir`/`AGENT_SKILLS_DIR` root
- **WHEN** skill readiness runs with `opencode` as the default agent and again with `omp` as the default agent
- **THEN** both runs SHALL check registered scripts under that same resolved absolute root
- **AND** removing a registered script from that root SHALL fail its readiness check even when a same-name copy exists outside it

#### Scenario: OpenCode readiness follows container or development installation

- **GIVEN** OpenCode is the default agent in a container or repository deployment
- **WHEN** skill readiness runs
- **THEN** its checks SHALL use the same absolute installed root as the script gate and prompt recipes

#### Scenario: Root failure becomes a readiness failure

- **GIVEN** the selected agent's root cannot be resolved
- **WHEN** either readiness endpoint is requested
- **THEN** it SHALL return HTTP 503 with an explicit failed skill-root check
- **AND** it SHALL NOT report success from another skill tree or propagate an unhandled configuration exception

#### Scenario: Optional external installation failure preserves built-in readiness

- **GIVEN** all registered built-in scripts are present and one optional external install failed
- **WHEN** skill readiness runs
- **THEN** registered-script readiness SHALL remain successful
- **AND** platform/binary/Skill API/workspace checks and the existing 30-second cache SHALL retain their previous behavior

### Requirement: External Skill Auto-Installation Into the Single Skill Root

The system SHALL support automatic installation of external agent skills at startup into the single deployment-resolved skill root supplied by `agent.skillsDir`. External publication SHALL be independent of ambient daemon HOME. Built-ins, external skills and both agent types SHALL share that install root and that one resolved value. External installations SHALL NOT overwrite bundled skills or shared skill libraries and SHALL NOT acquire authority outside the explicit root.

#### Scenario: Skills Configured

- **GIVEN** `agent.externalSkills` contains `[{repo: "jim60105/copilot-prompt", skill: "create-blog-post"}]`
- **WHEN** bootstrap runs
- **THEN** external installation and publication SHALL finish before AgentCore initialization and connector inventory construction
- **AND** the requested skill SHALL be installed through `npx --yes --package=skills skills add <repo> -a universal -s <skill> -g -y --copy` in a private installer HOME and published into the single resolved skill root
- **AND** private installer staging SHALL be removed after success or failure and SHALL never be scanned as an approval root

#### Scenario: Sequential Installation

- **GIVEN** multiple external skills are configured
- **WHEN** installation runs
- **THEN** installation/publication SHALL occur sequentially within the explicit destination

#### Scenario: Individual Failure Isolation

- **GIVEN** one external skill fails to install or publish
- **WHEN** installation continues
- **THEN** the failure SHALL be logged but SHALL NOT block application startup
- **AND** remaining skills SHALL still be attempted
- **AND** an absent skill SHALL contribute no inferred executable grant

#### Scenario: Environment Variable Override

- **GIVEN** `AGENT_EXTERNAL_SKILLS` is set to a JSON string
- **WHEN** environment overrides are applied
- **THEN** the value SHALL be parsed as JSON and override `agent.externalSkills`

#### Scenario: Validation

- **GIVEN** an external skill entry is missing `repo` or `skill`
- **WHEN** config validation runs
- **THEN** the invalid entry SHALL be logged as a warning and filtered out
- **AND** `agent.externalSkills` SHALL default to an empty array when not configured

#### Scenario: Container and development destinations agree with the gate

- **GIVEN** a container's root is `/home/deno/.agents/skills`, or a development deployment's configured root resolves to its repository `skills/`
- **WHEN** an external skill is successfully published
- **THEN** its final path SHALL be contained in that exact deployment's script-root inventory for either agent type
- **AND** changing daemon HOME SHALL change neither the publication destination nor the script grant

#### Scenario: External collision or link escape cannot replace built-ins

- **WHEN** an external skill names a bundled skill or `lib`, contains traversal, or publication encounters a linked/escaping source or destination
- **THEN** publication SHALL fail for that entry without changing the bundled content or any path outside the explicit root
- **AND** the failure SHALL NOT grant the external copy authority the validated publication did not establish

#### Scenario: External installs are shared by both agent types

- **GIVEN** external skills are configured while OMP is the default agent
- **WHEN** bootstrap publishes them into the resolved skill root
- **THEN** publication SHALL target that one root, which every agent type also resolves
- **AND** no second trusted skill root SHALL be selected, installed or auto-approved by this system

### Requirement: One Configured Skill Root For Every Agent Type

The deployment SHALL resolve exactly one absolute skill-script root from the existing `agent.skillsDir` configuration (environment `AGENT_SKILLS_DIR`) for BOTH agent types. No agent type SHALL select a separately packaged tree, an image constant, or a development fallback the other agent type does not also use. The resolved root SHALL be canonical with its physical identity recorded, and an unresolvable root SHALL fail explicitly instead of substituting another tree.

#### Scenario: Only the configured value selects the root

- **GIVEN** `agent.skillsDir`/`AGENT_SKILLS_DIR` names an installed tree and no other skill configuration is set
- **WHEN** an `opencode` session and an `omp` session resolve their skill-script roots
- **THEN** both resolutions SHALL return the byte-identical canonical absolute root
- **AND** neither resolution SHALL consult an image skill root, the repository `skills/` tree, or the agent child's HOME as an alternative selector

#### Scenario: Unset value keeps the documented default

- **GIVEN** `agent.skillsDir` is unset
- **WHEN** either agent type resolves its root
- **THEN** the documented default `skills` SHALL resolve against the deployment working directory
- **AND** an unresolvable value SHALL fail explicitly with no other tree substituted
