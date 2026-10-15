# 記憶維護整理

為了讓長期記憶保持精簡且高關聯性，AIr-Friends 具備定期記憶維護與整併機制。

---

## 語彙索引檢索

記憶檢索的評分實作於 `src/core/memory-recall/ranker.ts`，以 BM25 演算法計算語彙相關度，並搭配 `src/core/memory-recall/tokenizer.ts` 的 jieba 分詞（套件 `@node-rs/jieba`）。

- **純文字檢索**：不需向量資料庫（Vector Database），也不產生向量嵌入（Embedding）API 費用。
- **在地化分詞**：jieba 分詞能處理繁體中文人名、專有名詞與標籤；分詞器載入失敗時會降級為實體與雙字組詞彙。
- **結構化儲存**：記憶以 JSONL 檔案（`memory.public.jsonl`、`memory.private.jsonl`）附加寫入，檢索完全基於語彙索引與這些結構化紀錄。

---

## 背景 LLM 記憶整併與修補

隨著對話進行，記錄的碎片事實會逐漸增加。系統支援由排程器觸發的背景記憶維護工作階段（工作階段類型 `memory-maintenance`）。

1. **背景會話啟動**：在固定間隔下，對已達 `minMemoryCount` 門檻的使用者記憶庫啟動整理會話。
2. **語意合併與精簡**：找出內容重複或互相矛盾的事實（例如「使用者喜歡喝紅茶」與後來的「使用者改喝綠茶」），整合為精簡的單一事實。
3. **記憶修補（Patching）**：代理人呼叫 `memory-patch` 技能，更新或刪除過時的記憶條目，並保留類別標籤與權重等級，以維持後續載入與搜尋的準確度。
