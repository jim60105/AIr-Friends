# 自發貼文機制

除了被動等待使用者提及之外，AIr-Friends 支援主動在社群頻道中發布內容的「自發貼文（Spontaneous Posting）」功能。

---

## 觸發條件與週期

自發貼文由共用的背景排程器驅動（`src/core/spontaneous-scheduler.ts`），每個啟用的平台各自擁有獨立的計時器。

1. **隨機間隔**：每次排程會在 `minIntervalMs` 與 `maxIntervalMs` 之間取隨機值，作為下一次發文的間隔，避免固定在相同時間點發文。
2. **狀態保存**：下一次預定時間會寫入排程狀態儲存，重啟後可接續原定時間。
3. **避免重疊**：同一平台的前一次自發貼文仍在執行時，該次排程會跳過並改排下一次。

---

## 主題生成與脈絡組合

自發貼文的生成會依據下列脈絡。

- **角色人設**：發文內容須符合角色的世界觀、性格與興趣。
- **頻道歷史感知**：以 `contextFetchProbability` 決定是否取用頻道近期訊息作為話題延續。
- **全域筆記靈感**：代理人可參考全域知識庫 `agent-workspace/notes/` 中近期研究的主題。

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
