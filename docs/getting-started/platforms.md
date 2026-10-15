# 支援平台

AIr-Friends 在設計上採用平台抽象層架構，程式碼定義於 `src/types/events.ts` 中的 `SupportedPlatform` 型別。目前系統原生完整支援兩大主流社群平台：**Discord** 與 **Misskey**。

---

## 支援平台列表

| 平台名稱 | 平台代碼 (`platform`) | 通訊協定 | 主要功能支援 |
| :--- | :--- | :--- | :--- |
| **Discord** | `discord` | WebSocket Gateway (discord.js v14) | 伺服器文字頻道、討論串（Threads）、私訊（DM）、表情符號回應、打字中指示 |
| **Misskey** | `misskey` | WebSocket Streaming API (misskey-js) | 公開貼文、首頁時間軸、提及通知、私密筆記（Direct）、表情符號反應 |

---

## Discord 平台設定

### 1. 建立 Discord Bot 應用程式
1. 登入 [Discord Developer Portal](https://discord.com/developers/applications)。
2. 建立新應用程式（Application），前往 **Bot** 頁籤新增機器人。
3. 取得 **Bot Token** 與 **Application ID**（Client ID）。
4. 在 **Privileged Gateway Intents** 區域啟用：
   - **Message Content Intent**（讀取訊息內容）
   - **Server Members Intent**（伺服器成員資訊）
   - **Presence Intent**（線上狀態，選用）
5. 透過 OAuth2 URL Generator 生成邀請連結，授予 `bot` 與 `Send Messages`、`Read Message History`、`Add Reactions` 等權限，將機器人邀請至目標伺服器。

### 2. 在 AIr-Friends 中配置 Discord
在 `config.yaml` 中配置 `platforms.discord` 區塊：

```yaml
platforms:
  discord:
    enabled: true
    token: "${DISCORD_TOKEN}"              # 亦可直接在 .env 設定 DISCORD_TOKEN
    applicationId: "${DISCORD_CLIENT_ID}"  # 亦可設定 DISCORD_CLIENT_ID
```

---

## Misskey 平台設定

AIr-Friends 支援 Misskey 及其分支實例（例如 Firefish、Sharkey 等相容 Misskey API 的聯邦宇宙節點）。

### 1. 取得使用者存取權杖
1. 登入你的 Misskey 實例帳號。
2. 前往 **設定** -> **API / 應用程式** -> 建立存取權杖（Access Token）。
3. 確保權杖具備以下權限：
   - 讀取通知 (`read:notifications`)
   - 讀取貼文與時間軸 (`read:account`)
   - 發布貼文與回覆 (`write:notes`)
   - 表情符號反應 (`write:reactions`)

### 2. 在 AIr-Friends 中配置 Misskey
在 `config.yaml` 中配置 `platforms.misskey` 區塊：

```yaml
platforms:
  misskey:
    enabled: true
    host: "https://misskey.io"             # 你的 Misskey 實例網址
    token: "${MISSKEY_TOKEN}"              # 存取權杖，亦可在 .env 設定 MISSKEY_TOKEN
    wsUrl: ""                              # 選填：自訂串流 WebSocket 網址（預設自動衍生）
```

---

## 平台連線與多重實例管理

AIr-Friends 可以在同一份程序中同時啟用多個平台。當兩種平台同時啟用時：
- 訊息接收與發送分別由各平台的適配器處理。
- 每個使用者的工作區按 `{platform}/{userId}` 嚴密隔離，確保 Discord 使用者與 Misskey 使用者的對話記錄與記憶資料互不混淆。
- 更多擴充新平台的說明請參閱 [平台介面介接](../extending/platform-adapters.md)。
