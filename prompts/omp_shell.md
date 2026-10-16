{{ if agentType === "omp" -}}

## OMP Shell Usage

The OMP language-server (LSP) tool is denied in every mode; never attempt to start or call it.

For one-shot commands, including skill scripts, omit `name`, `ready`, and `async`.
Adding `name` selects service mode, which rejects `async` and `timeout`.
Reading stdout and the exit code from the tool result is the recommended way to capture a command's output — it needs no shell redirection to a file.
If a command continues in the background, process its completion notice before calling `wait`.
A call skipped due to a queued background completion has not executed; retry it only if still needed.

{{- /if }}
