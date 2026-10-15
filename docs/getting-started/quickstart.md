# 快速開始

本指南將引導你在最短時間內完成 AIr-Friends 的安裝、設定與啟動。

---

## 系統需求

在開始之前，請確認你的主機環境具備下列工具。

- **Podman 與 Podman Compose**，或相容的 Docker 環境（Docker 24.0 以上搭配 Compose v2.20 以上）。
- **Git**：用於複製專案儲存庫。
- 若要在本機直接執行（不透過容器）。
  - **Deno** 2.x 以上版本。
  - **Node.js**（選用，供安裝與管理特定外部技能）。

---

## 步驟 1：取得專案原始碼

使用 Git 複製 AIr-Friends 儲存庫至本機。

```bash
git clone https://github.com/jim60105/AIr-Friends.git
cd AIr-Friends
```

---

## 步驟 2：準備環境變數與組態檔案

AIr-Friends 透過根目錄的 `config.yaml` 或環境變數載入組態。專案提供範本檔案供快速複製。

```bash
# 複製組態範本
cp config.example.yaml config.yaml

# 複製環境變數範本
cp .env.example .env
```

接著編輯 `config.yaml`（或 `.env`）填入基本認證資訊。聊天平台可擇一或全部啟用，Discord 需填機器人權杖（Token），Misskey 需填主機名稱（例如 `misskey.io`）與使用者存取權杖（Access Token）；AI 模型供應商金鑰則填入 OpenRouter、Google Gemini 或 OpenCode 的 API 金鑰。詳細參數說明請參閱 [組態設定載入](../admin/configuration.md) 與 [模型與金鑰設定](models-and-keys.md)。

---

## 步驟 3：使用 Podman Compose 啟動服務

專案內建 `compose.yml`，可一鍵啟動機器人容器。

```bash
podman compose up -d
```

檢視容器執行日誌以確認啟動狀態。

```bash
podman compose logs -f
```

當日誌輸出類似下列訊息時，代表機器人已連線完成並準備就緒。

```text
[INFO] Bot connected successfully to platform: discord
[INFO] Skill API server started on 127.0.0.1:3001
[INFO] Health check server started { port: 8080 }
```

`compose.yml` 預設不對外發布任何連接埠。如需從主機存取 Web 儀表板或健康檢查端點，請在服務下自行加入連接埠對應，例如 `127.0.0.1:8090:8090`。

---

## 步驟 4：進行第一次對話測試

前往已加入該機器人的 Discord 伺服器或 Misskey 執行個體，在頻道中輸入 `@機器人名稱 你好！請自我介紹一下。`。機器人收到標記後，會透過 ACP 代理人推理，再發布回覆。

若要檢視即時工作階段、對話紀錄與記憶狀態，可開啟 Web 儀表板（預設 `http://127.0.0.1:8090`）並輸入設定的密碼。更多維運細節請參閱 [Web 儀表板](../operations/dashboard.md)。
