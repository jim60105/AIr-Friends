# Delta: skills-and-reply

## ADDED Requirements

### Requirement: Instructive workspace-path errors for send-file

When a `send-file` `--file-paths` value is RELATIVE, resolves inside the workspace boundary, but the file does not exist, AND the workspace-relative resolution contains a segment-boundary occurrence of the workspace's own `{platform}/{userId}` key, the handler SHALL return a structured failure with code `SKILL_FILE_PATH_WORKSPACE_PREFIXED` and a self-contained guidance error naming the workspace root and explaining the double-join. The guidance SHALL name the de-prefixed candidate path as the likely intended file ONLY when that candidate exists; otherwise it SHALL NOT guess and SHALL instead instruct re-checking paths relative to the workspace root. The handler SHALL NOT silently rewrite paths or send any candidate file. Absolute paths that resolve inside the workspace boundary SHALL continue to be accepted, and every other error path SHALL keep its existing generic message.

#### Scenario: Double-joined workspace path gets a corrected example
- **GIVEN** workspace root `/app/data/workspaces/discord/123` and agent cwd equal to that root, and `out.png` existing at the workspace root
- **WHEN** `send-file` is invoked with `--file-paths "data/workspaces/discord/123/out.png"` (stat fails on the double-joined location)
- **THEN** the result SHALL have `success: false` and code `SKILL_FILE_PATH_WORKSPACE_PREFIXED`
- **AND** the error SHALL name the workspace root, explain the double-join, and show `--file-paths "out.png"` as the corrected form

#### Scenario: Double-join signature with no existing candidate does not guess
- **WHEN** `--file-paths` carries the workspace-key prefix but the de-prefixed candidate also does not exist
- **THEN** the result SHALL carry `SKILL_FILE_PATH_WORKSPACE_PREFIXED` with the double-join explanation
- **AND** the error SHALL NOT claim a specific intended filename

#### Scenario: Legitimate in-workspace paths unaffected
- **WHEN** `send-file` is invoked with an existing relative path (`exports/report.pdf`, including one that legitimately contains `discord/123/` directories) or an absolute path inside the workspace
- **THEN** delivery SHALL proceed exactly as before with no guidance error (the heuristic is reached only on stat failure)

#### Scenario: Ordinary missing file keeps the plain error
- **WHEN** `--file-paths "nope.png"` refers to a nonexistent file with no workspace-key segment match
- **THEN** the existing plain stat-failure error SHALL be returned without the prefixed code
