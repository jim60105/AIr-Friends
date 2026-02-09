# language: zh-TW
功能: 容器化部署與 Containerfile 設計

  背景:
    假設 Bot 需要在容器環境中執行
    而且使用 Deno 官方映像檔作為基礎
    而且容器內需要保存 local repo 作為持久化資料
    而且需要支援環境變數注入認證資訊

  情境: 使用 Deno 官方映像檔
    當建構容器映像檔
    那麼 Containerfile 必須使用 Deno 官方映像檔作為基礎
    而且基礎映像必須為 denoland/deno:alpine 或更穩定的標籤版本
    而且不得使用 latest 標籤以確保建構可重現性
    而且映像檔標籤至少要明確到 minor 版本(例如 denoland/deno:2.1)

  情境: 多階段建構以減少映像檔大小
    當建構容器映像檔
    那麼可以使用多階段建構分離依賴快取與執行環境
    而且第一階段用於快取 Deno 依賴項
    而且最終階段只包含必要的執行檔案
    而且最終映像檔不得包含開發工具或測試檔案

  情境: Local repo 作為持久化 Volume
    當容器執行時
    那麼必須將 local repo 路徑掛載為 Volume
    而且預設 Volume 掛載點為 "/app/data"
    而且容器內的配置必須指向該 Volume 路徑
    而且 working directory 會在該 Volume 下動態建立
    而且容器重啟後記憶日誌必須保持不變

  情境: 配置檔與提示詞檔案的掛載策略
    當容器執行時
    那麼配置檔可透過以下任一方式提供
      | 方式 | 說明 |
      | Volume 掛載 | 將 config.yaml 掛載到容器內 /app/config.yaml |
      | ConfigMap | 在 Kubernetes 中使用 ConfigMap 注入 |
      | 環境變數 | 關鍵設定(token)透過環境變數覆寫 |
    而且提示詞檔案必須可獨立掛載或覆寫
    而且預設提示詞檔案打包在映像檔內
    而且運行時可透過 Volume 掛載覆寫預設提示詞

  情境: 容器內執行權限與安全設定
    當容器執行時
    那麼容器內程序不得以 root 使用者執行
    而且必須建立專用使用者(例如 deno)執行 Bot 程序
    而且該使用者必須對 /app/data Volume 有讀寫權限
    而且對其他路徑只有必要的讀取權限
    而且 Containerfile 必須使用 USER 指令切換到非特權使用者

  情境: 健康檢查與優雅關閉
    當容器執行時
    那麼必須提供 HEALTHCHECK 指令檢查 Bot 運作狀態
    而且健康檢查可以透過檢查程序存在或特定檔案存在實現
    而且容器必須正確處理 SIGTERM 訊號
    而且收到 SIGTERM 後必須優雅關閉 WebSocket 連線
    而且確保正在處理的 Agent session 完成後才結束

  情境: 環境變數注入敏感資訊
    當容器執行時
    那麼敏感資訊(tokens、API keys)必須透過環境變數注入
    而且不得將敏感資訊寫入映像檔層
    而且 Containerfile 必須使用 ARG 與 ENV 清楚區分建構時與執行時變數
    而且必須在文件中列出所有必要與可選的環境變數

  情境: 容器映像檔發布與版本管理
    當容器映像檔建構完成
    那麼映像檔必須推送到容器登錄庫(例如 Docker Hub、GHCR)
    而且映像檔標籤必須包含
      | 標籤類型 | 範例 |
      | Git commit SHA | sha-a1b2c3d |
      | 語意化版本 | v1.0.0 |
      | latest(僅穩定版) | latest |
    而且每次發布必須同時標記多個標籤
    而且 latest 標籤只指向最新的穩定發布版本

  情境: Containerfile 必須包含標籤 metadata
    當撰寫 Containerfile
    那麼必須使用 LABEL 指令宣告映像檔 metadata
    而且至少包含
      | Label | 說明 |
      | org.opencontainers.image.title | air-friends |
      | org.opencontainers.image.description | 專案描述 |
      | org.opencontainers.image.source | Git repository URL |
      | org.opencontainers.image.version | 版本號 |
      | org.opencontainers.image.licenses | 授權條款 |
    而且這些 metadata 可被容器編排工具查詢與顯示
