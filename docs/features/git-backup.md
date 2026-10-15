# Git 自動備份

AIr-Friends 內建 Git 備份流程，能定期將資料目錄的異動提交並推送至遠端 Git 專案庫。

---

## 運作流程

1. **資料目錄即 Git 專案庫**：資料儲存目錄（`data/`）被初始化為標準 Git 儲存庫。
2. **自動定時提交**：備份排程器（`src/core/git-backup-scheduler.ts` 與 `src/core/git-backup-service.ts`）以 `intervalMs` 為間隔檢查目錄異動，執行 `git add` 並產生帶時間戳記的提交。
3. **安全推播至遠端**：透過 HTTPS 遠端網址推送，憑證取自 `gitBackup.authUser` 與 `gitBackup.authPassword`，未設定密碼時回退至環境變數 `GITHUB_TOKEN`。

遠端網址為 HTTPS 格式（`gitBackup.remoteUrl`）。

---

## 推薦的標準 `.gitignore` 範本

備份服務不會修改資料目錄下的 `.gitignore` 檔案。維運人員必須自行維護 `{dataDir}/.gitignore`，避免暫存檔案或日誌被誤納入版本控制。

```gitignore
# 排除所有暫存目錄
tmp/
*/tmp/
workspaces/*/tmp/

# 排除即時執行階段日誌與稽核日誌
*.log
logs/
audit/

# 排除本機快取與鎖定檔
.cache/
*.lock
```

將此範本存放在資料目錄根目錄，備份內容便會專注於記憶 JSONL、Markdown 筆記與自訂設定。
