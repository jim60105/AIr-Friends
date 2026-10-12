# Spec Delta

## MODIFIED Requirements

### Requirement: External Skill Auto-Installation

The system SHALL support automatic installation of external agent skills at startup into the explicit deployment-resolved OpenCode install root supplied by `agent.skillsDir`. External publication SHALL be independent of ambient daemon HOME. Built-ins and external OpenCode scripts SHALL share that install root. External installations SHALL NOT overwrite bundled skills or shared skill libraries, and SHALL NOT add a second OMP trusted root or acquire OMP owned/critical-skill authority.

#### Scenario: Skills Configured
- **GIVEN** `agent.externalSkills` contains `[{repo: "jim60105/copilot-prompt", skill: "create-blog-post"}]`
- **WHEN** bootstrap runs
- **THEN** external installation and publication SHALL finish before AgentCore initialization and connector inventory construction
- **AND** the requested skill SHALL be installed through `npx --yes --package=skills skills add <repo> -a universal -s <skill> -g -y --copy` in a private installer HOME and published into the explicit OpenCode root
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
- **GIVEN** an OpenCode container's root is `/home/deno/.agents/skills`, or a development deployment's configured root resolves to its repository `skills/`
- **WHEN** an external skill is successfully published
- **THEN** its final path SHALL be contained in that exact deployment's script-root inventory
- **AND** changing daemon HOME SHALL change neither the publication destination nor the script grant

#### Scenario: External collision or link escape cannot replace built-ins
- **WHEN** an external skill names a bundled skill or `lib`, contains traversal, or publication encounters a linked/escaping source or destination
- **THEN** publication SHALL fail for that entry without changing the bundled content or any path outside the explicit root
- **AND** the failure SHALL NOT grant the external copy script or critical-skill authority

#### Scenario: OMP default does not trust external OpenCode installs
- **GIVEN** external skills are configured while OMP is the default agent
- **WHEN** bootstrap publishes them to the explicit OpenCode install root
- **THEN** OpenCode sessions MAY use them through that root's inventory
- **AND** OMP SHALL continue to use its single owned script root and SHALL NOT auto-approve an external-tree copy

### Requirement: Health Check Endpoint in Container

The container SHALL provide HTTP health check capability via the HealthCheckServer. Skill readiness SHALL check registered scripts under the same deployment-resolved root used by the default selected agent's prompts and script gate. Root-resolution errors SHALL produce an explicit failed readiness check without consulting an alternate root. Existing liveness behavior and readiness caching SHALL remain unchanged.

#### Scenario: Health Check Server
- **GIVEN** `health.enabled` is `true` and `health.port` is `8080`
- **WHEN** the server starts
- **THEN** `GET /health` and `GET /healthz` SHALL return health status with HTTP 200 (healthy/degraded) or 503 (unhealthy)
- **AND** `GET /ready` and `GET /readyz` SHALL check platform connections and skill readiness

#### Scenario: OMP readiness ignores the personal copy
- **GIVEN** OMP is the default agent and built-in scripts exist at `/opt/air/skills`
- **WHEN** skill readiness runs
- **THEN** registered-script checks SHALL use `/opt/air/skills` even if OpenCode `agent.skillsDir` points elsewhere
- **AND** removing an owned registered script SHALL fail its readiness check even when a personal copy exists

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

## ADDED Requirements

### Requirement: Stock Image Declares Its OpenCode Skill Install Root

The stock container deployment SHALL explicitly set the existing OpenCode skill-directory configuration to `/home/deno/.agents/skills`, matching both built-in COPY and external publication. Helm and deployment examples SHALL document this same installation contract. Repository development SHALL retain relative `skills` resolved against the deployment working directory. Ambient HOME SHALL NOT supply this configuration.

#### Scenario: Stock image requires no missing cwd skill tree
- **GIVEN** the stock image runs from `/app` without an operator skill-directory override
- **WHEN** its existing configuration is loaded
- **THEN** OpenCode SHALL select `/home/deno/.agents/skills`
- **AND** OMP SHALL select `/opt/air/skills` independently of the OpenCode configuration
