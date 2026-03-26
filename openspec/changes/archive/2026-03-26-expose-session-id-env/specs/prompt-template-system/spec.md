## MODIFIED Requirements

### Requirement: Template Variables

The template engine SHALL support the following variables when rendering system prompts:

#### Scenario: Session ID no longer a template variable
- **GIVEN** the system renders a prompt template
- **WHEN** the template is rendered
- **THEN** `sessionId` SHALL NOT be included as a template variable
- **AND** prompts SHALL instruct the agent to use the `$SESSION_ID` environment variable instead of an embedded session ID value

## REMOVED Requirements

### Requirement: sessionId template variable
**Reason**: The session ID is now exposed as the `$SESSION_ID` environment variable in the agent subprocess. The agent does not need to know the actual session ID value — it only needs to use `$SESSION_ID` in bash commands, which is resolved by the shell at execution time.
**Migration**: Prompt templates should reference `$SESSION_ID` env var in their instructions instead of using `{{ sessionId }}`.
