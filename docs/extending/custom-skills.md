# 自訂技能開發

你可以為 AIr-Friends 開發專屬的自訂技能，賦予代理人更多領域特定的自動化能力。

---

## 安全檔案酬載契約 (Secure Payload File Contract)

在過去的指令列工具調用中，若直接將使用者輸入以命令列參數（CLI Arguments）拼接至 Shell 指令，極易引發 Shell 注入漏洞（Command Injection）。

AIr-Friends 規定所有技能必須遵循**安全檔案酬載契約**：

1. **暫存參數檔案傳遞**：
   - 代理人若要傳遞複雜參數，先將 JSON 參數寫入當前工作階段的暫存目錄檔案中：`{stagingDir}/payload.json`。
   - 執行腳本時，僅傳遞該檔案路徑，例如：`deno run -A skills/my-skill/index.ts --payload {stagingDir}/payload.json`。
2. **驗證與執行**：
   - 技能腳本讀取並解析該 JSON 檔案，進行型別與欄位檢驗。
   - 避免直接透過環境變數或命令行字串傳遞非安全字元。

---

## 建立新技能的步驟

1. 在 `skills/` 下建立新目錄，例如 `skills/my-calculator/`。
2. 建立 `SKILL.md`，撰寫技能說明與 LLM 指引提示詞。
3. 建立 `index.ts` 撰寫主要執行邏輯。若需與機器人核心系統互動，可透過 HTTP 呼叫 `process.env.SKILL_API_BASE_URL` 端點。
