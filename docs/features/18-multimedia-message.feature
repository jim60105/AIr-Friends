Feature: Multimedia Message Handling

  Background:
    Given the bot is connected to a platform
    And an ACP Agent is available

  Scenario: User sends image in Discord
    Given the agent supports image prompt capability
    When a user sends a message with an image attachment in Discord
    Then the normalized event includes the attachment metadata
    And the context includes attachment text description
    And the prompt includes a ContentBlock::Image with base64 data

  Scenario: User sends image in Misskey note
    Given the agent supports image prompt capability
    When a user sends a note with a DriveFile image in Misskey
    Then the normalized event includes the attachment metadata
    And the context includes attachment text description with URL
    And the prompt includes a ContentBlock::Image with base64 data

  Scenario: User sends image in Misskey chat
    Given the agent supports image prompt capability
    When a user sends a chat message with a file in Misskey
    Then the normalized event includes the attachment metadata
    And the context includes attachment text description

  Scenario: Agent does not support image capability
    Given the agent does not support image prompt capability
    When a user sends a message with an image attachment
    Then the context includes attachment text description with URL
    And the prompt contains only text ContentBlock
    And no image download is attempted

  Scenario: Image download fails
    Given the agent supports image prompt capability
    When a user sends a message with an unreachable image URL
    Then the prompt contains only text ContentBlock
    And the context still includes attachment text description with URL
    And no error is thrown

  Scenario: Image exceeds size limit
    Given the agent supports image prompt capability
    When a user sends a message with an image larger than 20MB
    Then the image is not downloaded
    And the context includes attachment text description with URL
    And the prompt contains only text ContentBlock

  Scenario: Message without attachments
    When a user sends a text-only message
    Then the normalized event has no attachments field
    And the context format is unchanged from previous behavior
