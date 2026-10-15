# Web 儀表板

AIr-Friends 內建輕量級 Web 管理儀表板（Dashboard），維運人員可透過瀏覽器掌握系統運作狀態。

---

## 存取與組態設定

儀表板伺服器實作於 `src/dashboard/`，預設組態如下。

```yaml
dashboard:
  enabled: true
  port: 8090
  host: "127.0.0.1"               # 預設僅綁定本機 Loopback
  passphrase: "${DASHBOARD_PASS}" # 登入通行密碼，啟用時長度至少 16 字元
  behindHttpsProxy: false         # 在 HTTPS 反向代理後方時設為 true，Cookie 會加上 Secure
  trustedProxies: []              # 信任 X-Forwarded-For 的代理位址清單
```

> **安全提醒**。儀表板啟用時，密碼長度須至少 16 字元，且 `host` 預設只綁定環回位址。若要對外服務，請透過 Nginx 或 Caddy 反向代理並加上 TLS，不要直接將 `host` 設為 `0.0.0.0` 後暴露於公開網路。

---

## 儀表板功能頁籤

登入後，側邊欄提供五個功能頁籤。

- **Sessions（工作階段）**：檢視進行中工作階段與歷史工作階段，並可展開歷史工作階段的稽核內容。
- **Stats（統計）**：顯示工作階段總數、活躍工作階段等彙總指標。
- **Workspace（工作區）**：瀏覽 `data/` 下的工作區檔案樹並檢視檔案內容。
- **Channel Memory（頻道記憶）**：查看頻道記憶條目，並可停用個別條目。
- **Chat（對話）**：在儀表板中直接與機器人對話。

連線層安全上，儀表板僅在使用者位於 `trustedProxies` 允許清單內時才信任 `X-Forwarded-For`，並以設定的通行密碼登入。
