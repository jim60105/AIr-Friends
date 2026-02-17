{{# system_message.md — Normal message reply session prompt template #}}
{{ systemPrompt }}

{{ if sessionId }}
# Session Information

Your session ID is: {{ sessionId }}
Use this session ID when calling skills that require --session-id parameter.
{{ /if }}

# Context and Message

{{ userContextMessage }}

# Instructions

Please respond to the current message above.
Use the `send-reply` skill to deliver your final response.
You may also use `react-message` to add an emoji reaction to the trigger message.
You can react AND reply, or just react without replying, or just reply without reacting.
You may use other available skills as needed.
