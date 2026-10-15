# 系統提示詞片段

為了讓提示詞易於維護並支援模組化重用，AIr-Friends 採用**提示詞片段（Prompt Fragments）**機制。

---

## 模組化結構與組織

提示詞檔案均存放於 `prompts/` 目錄中。系統將提示詞劃分為角色人設片段、共用規則片段與各流程的頂層提示詞。

```text
prompts/
├── character_name.md              # 角色名稱
├── character_info.md              # 角色背景資訊
├── character_personality.md       # 角色性格
├── character_speaking_style.md    # 角色說話風格
├── character_reference_terms.md   # 角色稱謂慣例
├── scenario.md                    # 情境設定
├── agent_workspace.md             # 全域知識庫使用規則片段
├── agent_permissions.md           # 代理人權限說明片段
├── browser_automation.md          # 瀏覽器自動化工具規則片段
├── skills_root.md                 # 技能腳本根目錄宣告片段
├── system_reply.md                # 一般訊息回覆頂層提示詞
├── system_spontaneous.md          # 自發貼文頂層提示詞
├── system_self_research.md        # 自主研究頂層提示詞
├── system_memory_maintenance.md   # 記憶維護頂層提示詞
├── system_summary.md              # 對話摘要頂層提示詞
├── system_reminder.md             # 定時提醒通知頂層提示詞
├── system_web_chat.md             # Web 聊天頂層提示詞
└── system_prompt_override.md      # 覆寫用系統提示詞
```

---

## 條件式包含與組合方式

頂層提示詞透過 Vento 範本語法動態載入共用片段，例如 `{{ include "./character_name.md" }}` 或 `{{ include "./agent_workspace.md" }}`。

這帶來以下維護優勢。

- **單一信任來源（Single Source of Truth）**：例如技能腳本的路徑宣告（`skills_root.md`），只需在片段中維護一次，各流程（回覆、自發貼文、定時提醒）均能統一引用，不會出現語意分歧。
- **針對場景客製化**：自發貼文流程（`system_spontaneous.md`）不需載入使用者對話脈絡規則，只注入角色人設與頻道歷史，節省 Token 預算。
- **動態變數替換**：載入片段時可傳遞各工作階段專屬的動態參數（例如當前的工作階段 ID、工作區暫存目錄等）。
