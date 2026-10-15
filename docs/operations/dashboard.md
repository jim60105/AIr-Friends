# Web 儀表板

AIr-Friends 內建全功能輕量級 Web 管理儀表板（Dashboard），讓維運人員透過瀏覽器即可掌握系統運作狀態。

---

## 存取與組態設定

儀表板伺服器實作於 `src/dashboard/`，預設組態如下：

```yaml
dashboard:
  enabled: true
  port: 8090
  bindAddress: "127.0.0.1"        # 預設僅綁定本機 Loopback，確保安全
  passphrase: "${DASHBOARD_PASS}" # 登入通行密碼 (長度至少須 16 字元)
  behindHttpsProxy: true          # 若前端有反向代理且終止 HTTPS，設為 true
  trustedProxies:                 # 信任的反向代理 IP 清單
    - "127.0.0.1"
```

> **安全警示**：儀表板密碼長度強制要求至少 16 字元以上。在正式生產環境中，切勿將 `bindAddress` 直接暴露於公開網路，建議搭配 Nginx / Caddy 進行反向代理與憑證防護。

---

## 儀表板五大功能頁籤 (5 Tabs)

登入後，頂部提供 5 個核心功能頁籤：

1. **Overview（總覽）**：顯示系統執行時間、CPU / 記憶體使用率、當前活躍工作階段數與平台連線狀態。
2. **Sessions（工作階段）**：即時檢視進行中與近期的 ACP 代理人會話，包含模型呼叫成本與消耗權杖。
3. **Memories（記憶管理）**：以視覺化方式搜尋與檢視使用者的核心層、工作層記憶，支援手動編輯或清理。
4. **Channels（頻道與政策）**：檢視各頻道的活躍程度與目前套用的回覆政策清單。
5. **Logs / Audit（日誌與稽核）**：即時瀏覽系統結構化日誌與對話稽核紀錄。
