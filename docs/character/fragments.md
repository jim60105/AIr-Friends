# 系統提示詞片段

為了讓提示詞易於維護並支援模組化重用，AIr-Friends 採用**提示詞片段（Prompt Fragments）**機制。

---

## 模組化結構與組織

提示詞檔案均存放於 `prompts/` 目錄中。系統將提示詞劃分為頂層系統流程提示詞與共用片段：

```text
prompts/
├── soul.md                 # 角色靈魂人設
├── system_reply.md         # 一般訊息回覆頂層提示詞
├── system_spontaneous.md   # 自發發文頂層提示詞
├── system_self_research.md # 自主研究頂層提示詞
├── system_summary.md       # 對話摘要頂層提示詞
├── system_reminder.md      # 定時提醒通知頂層提示詞
├── skills_root.md          # 技能腳本根目錄宣告片段
├── tools.md                # 技能與工具調用守則片段
└── context_rules.md        # 對話脈絡使用規則片段
```

---

## 條件式包含與組合方式

頂層提示詞透過 Vento 範本語法（如 `{{ include "./soul.md" }}` 或 `{{ include "./skills_root.md" }}`）動態載入共用片段。

這帶來以下維護優勢：
- **單一信任來源 (Single Source of Truth)**：例如技能腳本的路徑宣告（`skills_root.md`），只需在片段中維護一次，所有流程（回覆、自發貼文、定時提醒）均能統一引用，絕無語意分歧。
- **針對場景客製化**：自發發文流程（`system_spontaneous.md`）無須載入使用者對話脈絡規則，只需注入角色人設與頻道歷史，節省寶貴的 Token 預算。
- **動態環境變數替換**：在載入片段時，可傳遞各工作階段專屬的動態參數（例如當前的工作階段 ID、工作區暫存目錄等）。
