# 外部代理技能

除了內建的專屬技能之外，AIr-Friends 支援安裝與載入符合開源標準的外部代理技能（External Skills）。

---

## 代理技能標準 (Agent Skills Standard)

系統相容於 [Agent Skills Standard](https://agentskills.io/) 規範：
- 每個技能為一個獨立目錄，根目錄具備 `SKILL.md` 說明檔案。
- `SKILL.md` 定義該技能的名稱、描述、參數架構與調用範例。

---

## 安裝外部技能

在 `config.yaml` 中配置 `agent.externalSkills` 區段，系統會在啟動時自動透過 `npx --yes --package=skills skills add` 安裝至技能目錄：

```yaml
agent:
  externalSkills:
    - name: "weather"
      source: "owner/repo-name/skills/weather"
    - name: "calculator"
      source: "owner/repo-name/skills/calculator"
```

安裝後的技能會被放置於受信任的技能根目錄下，並自動納入代理人的可用工具清單中。
