# 部署模式指引

AIr-Friends 支援容器化與本機 systemd 服務兩種常見的生產部署方式。

---

## 1. 容器部署模式（Podman 與 Docker）

### Podman Compose 部署

專案根目錄附帶 `compose.yml`，映像檔以非 root 使用者身分執行（`user: "1000:0"`），並丟棄所有能力、禁止提權。主要設定如下。

```yaml
services:
  air-friends:
    image: ghcr.io/jim60105/air-friends:latest
    build:
      context: .
      dockerfile: Containerfile
      target: final
    user: "1000:0"
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    env_file:
      - .env
    volumes:
      - data:/app/data   # 內含 workspaces/ 與 agent-workspace/

volumes:
  data:
```

`compose.yml` 預設不對外發布任何連接埠。若要從主機存取 Web 儀表板或健康檢查端點，請在服務下自行加入連接埠對應，例如 `ports: ["127.0.0.1:8090:8090"]`。

### 無根容器模式（Rootless Podman）

在權限受限的主機上可以改用 Rootless Podman 部署，容器行程完全在非 root 使用者權限下執行。F12 檔案系統沙盒（`AGENT_SANDBOX_FILESYSTEM_CONFINEMENT`）無法在無根 Podman 中驗證，因為 bwrap 需在巢狀使用者命名空間內重新掛載 `/proc`，此動作必然失敗。啟用前請以 `scripts/probe-sandbox-caps.sh` 在真實執行環境驗證。

---

## 2. systemd 系統服務部署

若要在 Linux 主機原生執行（由主機的 Deno 執行環境驅動），可建立 systemd 服務單元檔。

建立 `/etc/systemd/system/air-friends.service`。

```ini
[Unit]
Description=AIr-Friends Conversational Bot Service
After=network.target

[Service]
Type=simple
User=airfriends
Group=airfriends
WorkingDirectory=/opt/air-friends
EnvironmentFile=/opt/air-friends/.env
ExecStart=/usr/bin/deno run --allow-net --allow-read --allow-write --allow-env --allow-run --allow-ffi --allow-sys src/main.ts
Restart=always
RestartSec=10
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
```

啟用並啟動服務。

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now air-friends.service
sudo systemctl status air-friends.service
```

---

## 3. 生產環境安全建議

將資料儲存目錄（`data/`）設定為只有執行使用者可讀寫（`chmod 700 data`）。儀表板連接埠預設綁定 `127.0.0.1`，對外服務時請透過 Nginx 或 Caddy 反向代理並加上 HTTPS。`.env` 與 `config.yaml` 含有平台權杖與 API 金鑰，請勿提交至公開的 Git 專案庫。
