# 快速開始

本指南將引導你在最短時間內完成 AIr-Friends 的安裝、設定與啟動。

---

## 系統需求

在開始之前，請確認你的主機環境具備以下工具：

- **Docker 與 Docker Compose**（建議版本 Docker 24.0+ / Compose v2.20+），或相容的 Podman 環境。
- **Git**：用於複製專案儲存庫。
- 若要在本機直接執行（不透過容器）：
  - **Deno** 2.x 以上版本。
  - **Node.js**（選用，供安裝與管理特定外部技能）。

---

## 步驟 1：取得專案原始碼

使用 Git 複製 AIr-Friends 儲存庫至本機：

```bash
git clone https://github.com/jim60105/AIr-Friends.git
cd AIr-Friends
```

---

## 步驟 2：準備環境變數與組態檔案

AIr-Friends 透過根目錄的 `config.yaml` 或環境變數載入組態。專案提供範本檔案供快速複製：

```bash
# 複製組態範本
cp config.example.yaml config.yaml

# 複製環境變數範本
cp .env.example .env
```

接著編輯 `config.yaml`（或 `.env`）填入基本認證資訊：

1. **聊天平台設定**（擇一或全部啟用）：
   - Discord：設定機器人權杖（Token）與應用程式 Application ID。
   - Misskey：設定主機網址（例如 `https://misskey.io`）與使用者存取權杖（Access Token）。
2. **AI 模型供應商金鑰**：
   - 填入對應的模型金鑰，例如 OpenAI、Anthropic 或自建相容端點。

詳細參數說明請參閱 [組態設定載入](../admin/configuration.md) 與 [模型與金鑰設定](models-and-keys.md)。

---

## 步驟 3：使用 Docker Compose 啟動服務

專案內建預先配置好的 `compose.yml`，可一鍵啟動機器人容器與相關隔離環境：

```bash
docker compose up -d
```

檢視容器執行日誌以確認啟動狀態：

```bash
docker compose logs -f
```

當日誌輸出類似以下訊息時，代表機器人已連線完成並準備就緒：

```text
[INFO] Bot connected successfully to platform: discord
[INFO] Skill API Server listening on http://127.0.0.1:3000
[INFO] Web Dashboard available on http://127.0.0.1:8090
```

---

## 步驟 4：進行第一次對話測試

1. 前往已加入該機器人的 Discord 伺服器或 Misskey 執行個體。
2. 在頻道中輸入 `@機器人名稱 你好！請自我介紹一下。`
3. 機器人收到標記後，將透過 ACP 代理人推理並發布回覆。

你也可以透過瀏覽器開啟 Web 儀表板：`http://127.0.0.1:8090`，輸入設定的密碼以檢視即時工作階段、對話紀錄與記憶狀態。更多維運細節請參閱 [Web 儀表板](../operations/dashboard.md)。
