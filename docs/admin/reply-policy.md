# 回覆政策控制

在多使用者的社群伺服器中，回覆政策（Reply Policy）決定機器人只在受允許的情境下發言，避免洗版或干擾正常討論。

---

## 回覆政策架構

評估邏輯實作於 `src/core/reply-policy.ts`。每則訊息事件會經過兩層判斷。

1. **全域回覆政策（`replyPolicy`）**
   系統層級的 `replyPolicy` 決定一般訊息的處理範圍。
   - `all`：所有訊息皆評估回覆。
   - `public`：公開頻道訊息全部回覆，私訊則需該頻道條目已啟用。
   - `channels`（預設）：只有 `channels` 清單中列出的條目才會回覆。

2. **頻道與帳號條目（`channels`）**
   `channels` 是存取控制清單，每個條目以 `{platform}/channel/{id}` 或 `{platform}/account/{id}` 為識別碼，並可設定下列欄位。
   - `enabled`（預設 `true`）：設為 `false` 時停用該條目。
   - `spontaneousPost`（預設 `false`）：允許在該頻道自發貼文。
   - `channelLurk`（預設 `false`）：允許在該頻道啟用頻道潛水，僅限 `discord/channel/*`。
   - `rateLimitBypass`（預設 `false`）：略過頻率限制。
   - `yolo`（預設 `false`）：在該頻道或帳號以 YOLO 模式執行代理人。

---

## 典型組態範例

```yaml
# config.yaml
replyPolicy: "channels"

channels:
  # 管理員專屬帳號，啟用 YOLO 模式並略過頻率限制
  - id: "discord/account/560842157351763989"
    enabled: true
    yolo: true
    rateLimitBypass: true

  # AI 專屬閒聊頻道，允許自發貼文
  - id: "discord/channel/987654321012345678"
    enabled: true
    spontaneousPost: true

  # 僅潛水監聽的公開頻道
  - id: "discord/channel/112233445566778899"
    enabled: true
    channelLurk: true
```

透過全域政策與個別條目的分層設定，你可以將 AIr-Friends 部署在大型公開社群中，同時控管機器人的發言範圍。
