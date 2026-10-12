# Spec Delta

## ADDED Requirements

### Requirement: Dashboard Chat Offers Both Supported Agent Types

The dashboard chat agent selector SHALL offer OpenCode and OMP and SHALL submit the user's selected type through the existing authenticated connection request. Initial selection and existing model/lifecycle controls SHALL retain their current behavior. The backend's absent-field configured-default behavior and unsupported-type rejection SHALL remain unchanged.

#### Scenario: OMP selection reaches the connection request
- **WHEN** the user selects OMP and connects through the dashboard chat page
- **THEN** the outgoing authenticated request SHALL contain `agentType: "omp"`
- **AND** no frontend OpenCode override SHALL replace that selection

#### Scenario: OpenCode remains selectable
- **WHEN** the user selects OpenCode and connects through the same page
- **THEN** the outgoing request SHALL contain `agentType: "opencode"`
- **AND** existing model entry and connection lifecycle SHALL remain available

#### Scenario: API defaults are not redefined by the UI correction
- **WHEN** an API client omits the agent type or supplies an unsupported type
- **THEN** the existing configured-default or rejection behavior SHALL apply respectively
- **AND** adding OMP to the selector SHALL NOT widen the accepted type domain
