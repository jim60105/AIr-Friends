# 自發貼文機制

除了被動等待使用者提及之外，AIr-Friends 支援主動在社群頻道中發布內容的自發貼文（Spontaneous Posting）功能。

---

## 觸發條件與週期

自發貼文由共用的背景排程器驅動（`src/core/spontaneous-scheduler.ts`），每個啟用的平台各自擁有獨立的計時器。每次排程會在 `minIntervalMs` 與 `maxIntervalMs` 之間取隨機值作為下一次發文的間隔，避免固定在相同時間點發文，下一次預定時間會寫入排程狀態儲存，重啟後可接續原定時間。同一平台的前一次自發貼文仍在執行時，該次排程會跳過並改排下一次。

---

## 主題生成與脈絡組合

發文內容須符合角色提示詞定義的世界觀、性格與興趣。系統以 `contextFetchProbability` 決定是否取用頻道近期訊息作為話題延續，代理人也可以參考全域知識庫 `agent-workspace/notes/` 中近期研究的主題。

---

## 組態範例

自發貼文為各平台層級的設定，並在 `channels` 清單中以 `spontaneousPost: true` 逐頻道啟用。

```yaml
platforms:
  discord:
    enabled: true
    spontaneousPost:
      enabled: true
      minIntervalMs: 10800000       # 最短間隔 3 小時
      maxIntervalMs: 43200000       # 最長間隔 12 小時
      contextFetchProbability: 0.5  # 取用近期訊息的機率

channels:
  - id: "discord/channel/112233445566778899"
    enabled: true
    spontaneousPost: true
```

Misskey 亦支援 `platforms.misskey.spontaneousPost`，欄位相同。
