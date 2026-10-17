# email-opencode-intent-profile Specification

## Purpose
Provides native deny-all opencode intent profile as a complete observable prerequisite for safe email authorization or durable autonomous delivery within the approved platform boundary.

## Requirements

### Requirement: Native OpenCode intent denial

The OpenCode intent profile SHALL deny all native tools before dispatch and SHALL have no mailbox credentials, Skill API token or private user workspace.

#### Scenario: Native read and network attempts

- **WHEN** a scripted loopback model requests read, bash, webfetch, websearch, skill and an unknown tool
- **THEN** each attempt is denied with zero filesystem, network or skill side effects

### Requirement: Provider-only isolated configuration

Intent profile configuration SHALL retain the selected model provider without importing normal permissive agents, discovery or session state.

#### Scenario: Fresh HOME launch

- **WHEN** the profile runs in development or the stock container layout
- **THEN** the selected model is advertised and the active mode is email-intent without loading normal build/yolo policies
