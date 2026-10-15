# 自訂技能開發

你可以為 AIr-Friends 開發專屬的自訂技能，賦予代理人更多領域特定的自動化能力。

---

## 安全檔案酬載契約（Secure Payload File Contract）

在過去的指令列工具呼叫中，若直接將使用者輸入以命令列參數拼接至 Shell 指令，極易引發 Shell 注入漏洞（Command Injection）。AIr-Friends 規定所有技能必須遵循**安全檔案酬載契約**。

1. **暫存參數檔案傳遞**：代理人先以編輯或寫入工具，將自由文字內容寫入當前工作階段的暫存目錄，例如 `{stagingDir}/content.md`。
2. **以檔案路徑呼叫腳本**：執行腳本時僅傳遞該檔案路徑，例如 `deno run -A skills/my-skill/scripts/my-skill.ts --session-id "<id>" --content-file "{stagingDir}/content.md"`。
3. **驗證與執行**：技能腳本讀取並解析該檔案，進行型別與欄位檢驗。請避免透過環境變數或命令行字串傳遞非安全字元。

共用程式庫位於 `skills/lib/`。`skills/lib/payload.ts` 提供酬載路徑的解析與邊界檢查，`skills/lib/client.ts` 提供 Skill API 呼叫與錯誤輸出，腳本以相對路徑匯入即可。

---

## 建立新技能的步驟

1. 在 `skills/` 下建立新目錄，例如 `skills/my-calculator/`。
2. 建立 `SKILL.md`，撰寫技能說明與 LLM 指引提示詞。
3. 在 `skills/my-calculator/scripts/my-calculator.ts` 撰寫主要執行邏輯。若需與機器人核心系統互動，可透過 Skill API 呼叫。API 位址預設取自環境變數 `SKILL_API_URL`，或由 `--api-url` 參數指定，且僅允許 localhost 與 `127.0.0.1`。
