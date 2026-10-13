# Spec Delta

## ADDED Requirements

### Requirement: Generated OpenCode Skill Discovery Declaration

Bootstrap SHALL declare the deployment-resolved skill root to OpenCode by writing that root into the deployed OpenCode global configuration as its skill discovery path and as an allowed external-directory location, preserving every other setting in that file. The declaration SHALL derive from the same resolved value every other consumer uses, SHALL add no configuration field, credential or environment override, and SHALL be written only when the file does not already declare that root.

#### Scenario: A non-default configured root reaches agent discovery

- **GIVEN** the configured skill root is an absolute path other than the container default and it exists
- **WHEN** bootstrap prepares the deployment
- **THEN** the deployed OpenCode global configuration SHALL name exactly that root as its skill discovery path
- **AND** it SHALL allow external-directory reads under that root, and for no parent of that root
- **AND** every other setting in the file, including the routing that sends script executions to the approval gate, SHALL remain byte-identical

#### Scenario: An already-correct declaration is left byte-identical

- **GIVEN** the deployed configuration already names the resolved root — literally or in a home-relative spelling that resolves to it — and already allows external-directory reads under it
- **WHEN** bootstrap prepares the deployment
- **THEN** the file SHALL remain byte-identical
- **AND** no write SHALL be attempted

#### Scenario: An absent configuration is created with the declaration

- **GIVEN** no deployed OpenCode global configuration exists
- **WHEN** bootstrap prepares the deployment
- **THEN** the file SHALL be created containing exactly the declaration entries
- **AND** the created content SHALL declare no other setting, so no pre-existing key is overridden for any other source

#### Scenario: Unwritable declaration fails startup explicitly

- **GIVEN** the configuration must be updated but the file or its directory is not writable
- **WHEN** bootstrap prepares the deployment
- **THEN** startup SHALL fail explicitly, naming the file and the resolved root
- **AND** no agent session SHALL start with a discovery declaration that contradicts the resolved root

#### Scenario: An over-broad allowance is refused

- **GIVEN** the resolved root is the daemon user's home directory or an ancestor of it
- **WHEN** bootstrap prepares the deployment
- **THEN** it SHALL fail explicitly, naming the root and the reason
- **AND** it SHALL NOT write an external-directory allowance for a home-scoped or ancestor path

#### Scenario: Declaration is not an execution authority

- **WHEN** the declaration is written
- **THEN** it SHALL grant discovery and file-read visibility only
- **AND** it SHALL NOT add a second skill root, a script grant, or any authority that the root-exact inventory and the approval gate do not already establish from the same resolved root
