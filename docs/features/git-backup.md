# Git 自動備份

AIr-Friends 內建 Git 備份流程，能定期將資料目錄的異動提交並推送至遠端 Git 專案庫。

---

## 運作流程

資料儲存目錄（`data/`）被初始化為標準 Git 儲存庫。備份排程器（`src/core/git-backup-scheduler.ts` 與 `src/core/git-backup-service.ts`）以 `intervalMs` 為間隔檢查目錄異動，執行 `git add` 並產生帶時間戳記的提交，再透過 HTTPS 遠端網址（`gitBackup.remoteUrl`）推送。推送憑證取自 `gitBackup.authUser` 與 `gitBackup.authPassword`，未設定密碼時回退至環境變數 `GITHUB_TOKEN`。

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

---

## 保留執行階段快取的暫存政策

資料目錄中的 OMP 共用原生執行階段快取掛載點屬於**保留路徑**，備份服務在建立索引時會將其排除。保留形狀只有下列兩種（其中 `<mode>` 為 `restricted` 或 `native-yolo`）：

- `omp-pools/<pool-key 路徑>/omp-agent/<mode>/xdg-data/omp/natives`
- `<工作目錄路徑>/tmp/omp-agent/<mode>/xdg-data/omp/natives`

其中 `<pool-key 路徑>` 可包含一或多層目錄。判斷只看路徑字面，與項目種類無關；無論它是實體目錄、有效或失效的符號連結，或目前根本不存在，該項目本身與其所有子項都算保留路徑。這項政策固定套用，不依賴 `.gitignore`、`.git/info/exclude` 或 `skip-worktree` 等設定，維運人員不需要以忽略規則處理它，忽略規則也無法改變這項政策。

備份服務只在 Git 索引層級處理這些項目，先以 `git rm --cached` 從索引移除既有符合形狀的紀錄，再以帶排除樣式的 `git add -A` 暫存其餘變更。**此政策不會刪除或修改工作區中的任何檔案**，也不會更動維運人員的 `.gitignore` 位元組；被排除的內容也不會先進入索引再被移除。任何一個暫存步驟失敗都會中止該次提交與推送。

索引排除只影響之後的提交。若先前已記錄的歷史中仍留有過大的原生執行階段快取 blob，推送仍可能被遠端（例如 GitHub 的檔案大小限制）拒絕。本專案不提供歷史改寫或修復程序，這項限制需由維運人員自行評估與處理。
