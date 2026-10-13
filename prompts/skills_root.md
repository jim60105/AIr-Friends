## Skill Script Root

Your trusted skill-script root for this session is the literal absolute path:

**`{{ skillsDir }}`**

Invoke every skill through its COMPLETE absolute script path under that root, and single-quote that
path together with every path or id argument — a root or staging directory may contain spaces or
shell characters, and an unquoted argument would be split or expanded before the script runs.
Free-text message, memory, query and caption content NEVER goes on the command line: write it to a
payload file and pass the file path through the skill's payload-file flag.

Never build a skill path from a process HOME variable (`$HOME`, `${HOME}`): the agent child's HOME
is an isolated sandbox directory, not this deployment's installed skills. The root above is the same
value every recipe, the retry guidance and the deployment's own skill inventory use.

{{ if skillsRootRecipes }}
Allowed skills and their recipes for this session:

{{ skillsRootRecipes }}
{{- /if }}
