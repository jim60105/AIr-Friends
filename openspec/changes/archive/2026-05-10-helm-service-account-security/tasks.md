## 1. Helm Values

- [x] 1.1 Add `serviceAccount` block to `helm/values.yaml` with `create: false`, `automount: false`, `annotations: {}`, `name: ""`

## 2. Helm Helpers

- [x] 2.1 Add `air-friends.serviceAccountName` template to `helm/templates/_helpers.tpl` that returns `serviceAccount.name` when set, the chart fullname when `create: true` and name is empty, or `"default"` when `create: false` and name is empty

## 3. Deployment Template

- [x] 3.1 Add `serviceAccountName: {{ include "air-friends.serviceAccountName" . }}` to the Pod spec in `helm/templates/deployment.yaml`
- [x] 3.2 Add `automountServiceAccountToken: {{ .Values.serviceAccount.automount }}` to the Pod spec in `helm/templates/deployment.yaml`

## 4. ServiceAccount Template

- [x] 4.1 Create `helm/templates/serviceaccount.yaml` with conditional rendering (`{{- if .Values.serviceAccount.create }}`), including standard labels, `serviceAccount.annotations`, and `automountServiceAccountToken: {{ .Values.serviceAccount.automount }}`

## 5. Chart Versioning

- [x] 5.1 Bump `version` in `helm/Chart.yaml` following semver (patch increment)

## 6. Tests

- [x] 6.1 Verify `helm template` with default values: Deployment has `automountServiceAccountToken: false` and `serviceAccountName: default`; no ServiceAccount resource rendered
- [x] 6.2 Verify `helm template` with `serviceAccount.create: true, name: ""`: ServiceAccount is rendered with chart fullname; Deployment `serviceAccountName` matches; SA has `automountServiceAccountToken: false`
- [x] 6.3 Verify `helm template` with `serviceAccount.create: true, name: "custom-sa"`: SA is rendered with name `custom-sa`; Deployment uses `custom-sa`
- [x] 6.4 Verify `helm template` with `serviceAccount.create: false, name: "existing-sa"`: no SA resource rendered; Deployment uses `existing-sa`
- [x] 6.5 Verify `helm template` with `serviceAccount.automount: true`: Deployment has `automountServiceAccountToken: true`; SA (when `create: true`) also has `automountServiceAccountToken: true`
- [x] 6.6 Verify `helm template` with `serviceAccount.create: true, annotations: {eks.amazonaws.com/role-arn: "arn:..."}`: SA metadata has the annotation rendered correctly
