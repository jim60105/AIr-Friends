# 部署模式指引

AIr-Friends 支援多種常見的現代化生產部署模式，無論是容器化環境還是本機 systemd 服務均能良好運作。

---

## 1. 容器部署模式 (Docker & Podman)

### Docker Compose 部署 (標準推薦)
專案根目錄附帶完整的 `compose.yml`。容器內預設以非 root 使用者（`deno`，UID 1000）身分執行：

```yaml
services:
  bot:
    image: air-friends:latest
    build: .
    restart: unless-stopped
    env_file:
      - .env
    volumes:
      - ./config.yaml:/app/config.yaml:ro
      - ./data:/app/data
      - ./prompts:/app/prompts:ro
    ports:
      - "127.0.0.1:8090:8090" # Web 儀表板
```

### 無根容器模式 (Rootless Podman)
在具備嚴格權限限制的主機上，推薦使用 Rootless Podman 部署：
- 容器行程與使用者工作階段完全運行於非 root 使用者權限下。
- 若搭配 bwrap 等沙盒工具，請確認主機的核心設定已開啟 `kernel.unprivileged_userns_clone=1`，以利代理人子行程建立掛載命名空間。

---

## 2. systemd 系統服務部署

若希望直接在 Linux 主機原生執行（由主機的 Deno 執行環境驅動），可撰寫 systemd 服務單元檔：

建立 `/etc/systemd/system/air-friends.service`：

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
ExecStart=/usr/bin/deno run --allow-net --allow-read --allow-write --allow-env --allow-run --allow-ffi src/main.ts
Restart=always
RestartSec=10
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
```

啟用並啟動服務：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now air-friends.service
sudo systemctl status air-friends.service
```

---

## 3. 生產環境安全建議

1. **工作區目錄權限**：將資料儲存目錄（`data/`）設定為只有執行使用者可讀寫（`chmod 700 data`）。
2. **Web 儀表板綁定**：儀表板連接埠預設應綁定在 `127.0.0.1`，並透過 Nginx 或 Caddy 反向代理加上 HTTPS 加密傳輸。
3. **金鑰管理**：嚴禁將 `.env` 或 `config.yaml` 提交至公開的 Git 專案庫中。
