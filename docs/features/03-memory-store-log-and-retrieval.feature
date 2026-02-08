# language: zh-TW
功能: 以少量檔案的 append-only 記憶日誌實現跨交談記憶

  背景:
    假設每個 working directory 需要保存 Bot 與用戶的關係與設定
    而且需要保存重要記憶作為跨交談記憶
    而且記憶不能刪除，只能新增並禁用舊記憶
    而且不希望每個記憶各自成一個小檔案

  情境: 記憶以 append-only 日誌檔保存，避免零碎小檔
    當系統要在 working directory 保存記憶
    那麼系統必須使用少量固定檔案作為日誌
    而且至少包含
      | 檔案 | 用途 |
      | memory.public.jsonl | 公開記憶的新增/變更事件 |
      | memory.private.jsonl | 私人記憶的新增/變更事件 |
    而且每個 workspace 都必須同時建立 public 和 private 記憶檔案
    而且每筆記憶或變更都必須以一行 JSON 追加寫入
    而且不得因新增記憶而新增新的檔案

  情境: 每筆記憶必須包含欄位
    當系統寫入一筆新的記憶事件(type=memory)
    那麼該事件必須包含以下欄位
      | 欄位 | 說明 |
      | id | 唯一識別碼 |
      | ts | 時間戳 |
      | enabled | 啟用/禁用 |
      | visibility | public 或 private |
      | importance | high 或 normal |
      | content | 記憶內容(純文字) |

  情境: 重要記憶直接全載入脈絡
    假設 memory.public.jsonl 中存在 enabled=true 且 importance=high 的記憶
    當 Bot 組裝初始脈絡
    那麼系統必須把全部重要記憶載入上下文
    而且載入順序必須可預期(例如依 ts 由舊到新)

  情境: 普通記憶使用全文檢索取用
    假設 memory.public.jsonl 中存在 enabled=true 且 importance=normal 的記憶
    當 Bot 組裝初始脈絡或 Agent 要求補充記憶
    那麼系統必須使用 rg 對該日誌檔做全文檢索
    而且只回傳命中結果的片段或行範圍
    而且命中筆數與總字數必須有上限

  情境: 記憶取用依互動情境區分可見範圍
    假設一筆記憶的 visibility=private
    當互動情境為 DM
    那麼系統允許載入與檢索 memory.private.jsonl 以及 memory.public.jsonl
    而且 DM 情境下儲存記憶使用 private 可見性
    當互動情境不是 DM
    那麼系統僅載入與檢索 memory.public.jsonl
    而且非 DM 情境下儲存記憶使用 public 可見性
    而且非 DM 情境下不得載入或檢索任何 private 記憶

  情境: 記憶不可刪除，以禁用舊記憶取代
    假設 id=mem1 的記憶已存在
    當 Agent 想要移除該記憶的效力
    那麼 Agent 必須呼叫 "memory.patch" skill 寫入一筆 type=patch 事件
    而且 patch 事件只能變更 enabled/visibility/importance
    而且 content 不得被覆寫
    而且系統不得提供任何 delete 記憶的能力
