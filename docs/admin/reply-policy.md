# 回覆政策控制

在多使用者的社群伺服器中，合適的回覆政策（Reply Policy）能確保機器人只在受允許的情境下發言，避免洗版或干擾正常討論。

---

## 回覆政策架構

回覆政策的核心評估邏輯實作於 `src/core/reply-policy.ts`。每當收到訊息事件時，系統會先比對以下三個層級的規則：

1. **全域存取控制清單 (ACL)**
   - 黑名單（Blacklist）：被列入黑名單的使用者識別碼，其訊息會被直接忽略，不觸發任何代理人執行。
   - 白名單（Whitelist）：若啟用白名單模式，僅允許清單內的使用者與機器人互動。

2. **頻道層級回覆模式 (`replyPolicy`)**
   針對個別頻道（以 `{platform}/channel/{id}` 為識別碼），可設定以下政策之一：
   - `mention_only`（預設）：只有在訊息中直接標記機器人時才回覆。
   - `all`：該頻道內的所有訊息皆會評估回覆（通常搭配聊天機器人專用頻道）。
   - `disabled`：完全停用該頻道的機器人回覆功能。

3. **帳號層級政策覆寫 (`{platform}/account/{id}`)**
   - 支援針對特定特定高信任管理者帳號賦予特別權限（例如自動啟用 YOLO 模式或忽略一般頻道的標記限制）。

---

## 典型組態範例

```yaml
# config.yaml
channels:
  # 規則 1：管理員專屬測試帳號，啟用 YOLO 模式
  - id: "discord/account/560842157351763989"
    enabled: true
    yolo: true

  # 規則 2：AI 專屬閒聊頻道，允許所有對話觸發
  - id: "discord/channel/987654321012345678"
    enabled: true
    replyPolicy: "all"

  # 規則 3：公告或嚴肅討論區，僅限重要事項手動標記
  - id: "discord/channel/112233445566778899"
    enabled: true
    replyPolicy: "mention_only"
```

透過細緻的政策分級，你可以放心地將 AIr-Friends 部署在大型公開社群中，同時保障機器人運作的秩序與安全性。
