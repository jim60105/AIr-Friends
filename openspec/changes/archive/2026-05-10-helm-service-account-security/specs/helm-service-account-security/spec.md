## ADDED Requirements

### Requirement: ServiceAccount Values Block

The Helm chart `values.yaml` SHALL include a `serviceAccount` section with `create` (boolean, default `false`), `automount` (boolean, default `false`), `annotations` (map, default `{}`), and `name` (string, default `""`).

#### Scenario: Default values disable ServiceAccount creation and token automount

- **WHEN** the chart is installed with default values
- **THEN** `serviceAccount.create` SHALL be `false`
- **AND** `serviceAccount.automount` SHALL be `false`
- **AND** `serviceAccount.annotations` SHALL be `{}`
- **AND** `serviceAccount.name` SHALL be `""`

#### Scenario: User opts in to ServiceAccount creation

- **WHEN** `serviceAccount.create` is set to `true`
- **THEN** a ServiceAccount resource SHALL be created in the release namespace
- **AND** the ServiceAccount SHALL have `automountServiceAccountToken` set to the value of `serviceAccount.automount`
- **AND** annotations from `serviceAccount.annotations` SHALL be applied to the ServiceAccount

### Requirement: ServiceAccountName Helper

The `_helpers.tpl` SHALL define a `air-friends.serviceAccountName` template that resolves the ServiceAccount name for the Pod spec.

#### Scenario: Create enabled with empty name uses chart fullname

- **GIVEN** `serviceAccount.create` is `true` and `serviceAccount.name` is `""`
- **WHEN** the helper is rendered
- **THEN** it SHALL return `include "air-friends.fullname" .`

#### Scenario: Create enabled with explicit name uses that name

- **GIVEN** `serviceAccount.create` is `true` and `serviceAccount.name` is `"my-sa"`
- **WHEN** the helper is rendered
- **THEN** it SHALL return `"my-sa"`

#### Scenario: Create disabled uses provided name or default

- **GIVEN** `serviceAccount.create` is `false` and `serviceAccount.name` is `""`
- **WHEN** the helper is rendered
- **THEN** it SHALL return `"default"`

#### Scenario: Create disabled with explicit name

- **GIVEN** `serviceAccount.create` is `false` and `serviceAccount.name` is `"custom-sa"`
- **WHEN** the helper is rendered
- **THEN** it SHALL return `"custom-sa"`

### Requirement: Pod Spec Token Automount Disabled by Default

The Deployment Pod spec SHALL set `automountServiceAccountToken` to the value of `serviceAccount.automount` (default `false`).

#### Scenario: Default deployment disables token automount

- **WHEN** the Deployment is rendered with default values
- **THEN** the Pod spec SHALL contain `automountServiceAccountToken: false`

#### Scenario: User enables token automount

- **WHEN** `serviceAccount.automount` is set to `true`
- **THEN** the Pod spec SHALL contain `automountServiceAccountToken: true`

### Requirement: Pod Spec ServiceAccount Name

The Deployment Pod spec SHALL set `serviceAccountName` using the `air-friends.serviceAccountName` helper.

#### Scenario: Default deployment references default ServiceAccount

- **WHEN** the Deployment is rendered with default values (`serviceAccount.create: false`, `serviceAccount.name: ""`)
- **THEN** the Pod spec `serviceAccountName` SHALL be `"default"`

#### Scenario: Created ServiceAccount is referenced

- **WHEN** `serviceAccount.create: true` and `serviceAccount.name: ""`
- **THEN** the Pod spec `serviceAccountName` SHALL equal `include "air-friends.fullname" .`

### Requirement: Conditional ServiceAccount Template

The chart SHALL include `helm/templates/serviceaccount.yaml` that renders only when `serviceAccount.create` is `true`.

#### Scenario: Template not rendered by default

- **WHEN** the chart is rendered with default values
- **THEN** no ServiceAccount resource SHALL appear in the rendered output

#### Scenario: Template rendered on opt-in

- **WHEN** `serviceAccount.create: true`
- **THEN** a ServiceAccount resource SHALL be rendered with `kind: ServiceAccount`, the resolved name, the release namespace, standard labels, `serviceAccount.annotations`, and `automountServiceAccountToken: serviceAccount.automount`
