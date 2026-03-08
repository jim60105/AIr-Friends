// tests/acp/gemini-config.test.ts

import { assert, assertEquals } from "@std/assert";

Deno.test("gemini-settings.json is valid JSON with required fields", async () => {
  const content = await Deno.readTextFile("gemini-settings.json");
  const settings = JSON.parse(content);

  // Verify critical settings
  assertEquals(settings.general.defaultApprovalMode, "default");
  assertEquals(settings.general.enableAutoUpdate, false);
  assertEquals(settings.security.folderTrust.enabled, false);
});

Deno.test("gemini-policies/airfriends.toml contains required deny rules", async () => {
  const content = await Deno.readTextFile("gemini-policies/airfriends.toml");

  // Verify critical deny rules exist
  // write_file/replace are NOT denied in TOML — scoping handled by Layer 3/4
  // Verify the comment about Layer 3/4 scoping exists
  assert(content.includes("Layer 3"), "Should reference Layer 3 for write scoping");
  assert(content.includes("Layer 4"), "Should reference Layer 4 for write scoping");
  assert(content.includes("ask_user"), "Should deny ask_user");
  assert(content.includes("save_memory"), "Should deny save_memory");

  // Verify dangerous commands are denied
  assert(content.includes('"git "'), "Should deny git commands");
  assert(content.includes('"echo "'), "Should deny echo commands");
  assert(content.includes('"mkdir "'), "Should deny mkdir commands");

  // Verify safe commands are allowed
  assert(content.includes('"deno run"'), "Should allow deno run");
  assert(content.includes('"rg "'), "Should allow rg");
  assert(content.includes('"curl "'), "Should allow curl");
  assert(content.includes('"agent-browser"'), "Should allow agent-browser");
});

Deno.test("gemini-policies/airfriends.toml has correct YOLO mode behavior", async () => {
  const content = await Deno.readTextFile("gemini-policies/airfriends.toml");

  // Verify modes field excludes "yolo" for shell/edit deny rules
  // Rules with modes should use ["default", "auto_edit", "plan"] (no "yolo")
  const modeMatches = content.matchAll(/modes\s*=\s*\[([^\]]+)\]/g);
  for (const match of modeMatches) {
    const modesStr = match[1];
    assert(!modesStr.includes('"yolo"'), `Modes should not include "yolo": ${modesStr}`);
  }

  // Verify ask_user rule has no modes field (always active)
  // Find ask_user rule block
  const askUserRuleIdx = content.indexOf('toolName = "ask_user"');
  assert(askUserRuleIdx >= 0, "Should have ask_user rule");

  // Find the rule block containing ask_user (between [[rule]] markers)
  const beforeAskUser = content.substring(0, askUserRuleIdx);
  const ruleStart = beforeAskUser.lastIndexOf("[[rule]]");
  const afterAskUser = content.substring(askUserRuleIdx);
  const nextRule = afterAskUser.indexOf("[[rule]]");
  const askUserBlock = nextRule >= 0
    ? content.substring(ruleStart, askUserRuleIdx + nextRule)
    : content.substring(ruleStart);

  assert(!askUserBlock.includes("modes"), "ask_user rule should not have modes field");
});

Deno.test("gemini-policies/airfriends.toml deny rules have higher priority than allow rules", async () => {
  const content = await Deno.readTextFile("gemini-policies/airfriends.toml");

  // Parse all rules to verify priority ordering
  const rules = content.split("[[rule]]").slice(1);

  for (const rule of rules) {
    const decisionMatch = rule.match(/decision\s*=\s*"(\w+)"/);
    const priorityMatch = rule.match(/priority\s*=\s*(\d+)/);

    if (decisionMatch && priorityMatch) {
      const decision = decisionMatch[1];
      const priority = parseInt(priorityMatch[1]);

      if (decision === "allow") {
        assertEquals(priority, 100, "Allow rules should have priority 100");
      }
      // Deny rules should be either 10 (default deny) or 200 (explicit deny)
      if (decision === "deny") {
        assert(
          priority === 10 || priority === 200,
          `Deny rule priority should be 10 or 200, got ${priority}`,
        );
      }
    }
  }
});
