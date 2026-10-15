# 外部代理技能

除了內建的專屬技能之外，AIr-Friends 支援安裝與載入符合開源標準的外部代理技能（External Skills）。

---

## 代理技能標準 (Agent Skills Standard)

系統相容於 [Agent Skills Standard](https://agentskills.io/) 規範。每個技能為一個獨立目錄，根目錄具備 `SKILL.md` 說明檔案，該檔案定義技能的名稱、描述、參數架構與呼叫範例。

---

## 安裝外部技能

在 `config.yaml` 中配置 `agent.externalSkills` 區段，系統會在啟動時透過 `npx --yes --package=skills skills add` 安裝至技能目錄。

```yaml
agent:
  externalSkills:
    - repo: "jim60105/copilot-prompt"
      skill: "create-blog-post"
    - repo: "owner/repo-name"
      skill: "weather"
```

每個條目以 `repo` 指定 GitHub 儲存庫、以 `skill` 指定儲存庫內的技能名稱。安裝後的技能會被放置於受信任的技能根目錄下，並納入代理人的可用工具清單。

安裝由 Node.js 的 `npx` 驅動，因此需要 Node.js 22.20.0 以上版本（`skills` CLI 的要求）。容器映像已內建固定的 Node.js 24 LTS，無需額外處理；直接在主機上執行時請自行確認版本，否則安裝會以 `fs/promises` 匯入錯誤失敗。
