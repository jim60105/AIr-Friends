# AIr-Friends OMP 整合功能盤點

本文件以 **專案內實際程式碼** 為準，盤點 AIr-Friends 專案中所有與 **OMP（oh-my-pi）代理整合** 相關的功能。OMP 是本專案支援的第二種 ACP Agent 類型（第一種為 OpenCode）。

> 本盤點依據的是程式碼現況，不是提案階段的設計文件。每一項功能都會標出「主要實作位置」、「測試位置」與「對應規格需求」。

## 這份文件怎麼讀

每一項功能都以相同的四欄格式呈現：

| 欄位 | 內容 |
|---|---|
| **白話說明** | 面向一般人的功能描述，不需要技術背景也能理解「這功能在做什麼、為什麼需要它」 |
| **主要實作** | 承載該功能的原始碼檔案（必要時附行號與符號名稱） |
| **測試位置** | 對應的測試檔案 |
| **規格需求** | `openspec/specs/` 下對應的能力規格與需求名稱 |

## 專案背景（一句話版本）

AIr-Friends 本身是 **ACP Client**，會啟動外部的 ACP Agent（OpenCode 或 OMP）來執行 AI 推理；本專案負責工作區隔離、記憶、提示組裝、技能（skill）呼叫與平台回覆。

## OMP 是什麼、為什麼要有它

OMP 是另一套 ACP 相容的 CLI agent。專案把它加進來當作可選的第二種代理，並且對它施加一整套「受限模式安全邊界」：對齊 OpenCode 既有的權限與檔案邊界，同時處理 OMP 在上游實作上的行為差異。

## 功能分類總覽

功能的生命週期大致如下（由左至右）：

```text
[部署設定]          選擇代理類型（OpenCode / OMP）
    │
    ▼
[啟動階段]          模式化啟動 + 行程池隔離
    │
    ▼
[載入階段]          自有設定 + 探索來源隔離
    │
    ▼
[執行階段]          工具授權 + 執行期強制 ──┐
    │                                      │
    ▼                                      ▼
[輸出階段]          技能呼叫 + 平台回覆   [觀測] 儀表板 + 稽核
    │
    ▼
[復原階段]          所有權驗證與情境還原
```

| 分類 | 頁面 | 對應功能數 |
|---|---|---|
| 代理類型與設定 | [01-agent-config](01-agent-config.md) | 1 |
| 自有設定與探索隔離 | [02-settings](02-settings.md) | 4 |
| 啟動與行程池 | [03-spawn-pool](03-spawn-pool.md) | 2 |
| 工具授權與執行強制 | [04-enforcement](04-enforcement.md) | 7 |
| 破壞性操作與路徑邊界 | [05-destructive](05-destructive.md) | 5（共用模組） |
| 網路傳輸 | [06-network](06-network.md) | 5 |
| 技能根目錄與技能交接 | [07-skills](07-skills.md) | 4 |
| 擴充模組與封裝 | [08-extension-packaging](08-extension-packaging.md) | 3 |
| 復原與所有權 | [09-recovery](09-recovery.md) | 1 |
| 儀表板與觀測性 | [10-dashboard-observability](10-dashboard-observability.md) | 2 |
| 測試套件與文件同步 | [11-testing-docs](11-testing-docs.md) | 3 |
| OpenCode 對照 | [12-opencode-comparison](12-opencode-comparison.md) | （逐項對照，不計入功能數） |

合計 **37** 項（涵蓋 32 個與 OMP 相關的已封存變更，加上 5 項共用安全模組）。完整的逐項對照請見 **[總表](matrix.md)**。

每一項「OpenCode 側怎麼做、和 OMP 差在哪」請見 **[12. OpenCode 對照](12-opencode-comparison.md)**。

## 規格來源

本專案的變更流程（OpenSpec）把每個功能留下一份「已封存變更」（`openspec/changes/archive/`），並把需求合併進 `openspec/specs/<能力>/spec.md`。本文件引用的規格需求名稱皆取自 `openspec/specs/` 內的現行文字。

## 如何在本機瀏覽

```bash
# 使用 docsify-cli
docsify serve docs/omp-features

# 或任何靜態伺服器
cd docs/omp-features && python3 -m http.server 3000
```
