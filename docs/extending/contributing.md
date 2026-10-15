# 參與專案貢獻

歡迎參與 AIr-Friends 的開發與維護！以下說明專案的開發環境設定、程式碼風格規範與 Pull Request 流程。

---

## 本機開發環境設定

1. **安裝 Deno**：確認本機安裝 Deno 2.x 以上版本。
2. **複製專案庫**：
   ```bash
   git clone https://github.com/jim60105/AIr-Friends.git
   cd AIr-Friends
   ```
3. **啟動熱重載開發伺服器**：
   ```bash
   deno task dev
   ```

---

## 程式碼風格與驗證指令

在提交變更之前，請務必在專案根目錄執行以下檢查指令：

```bash
# 格式化檢查
deno fmt src/ tests/

# 靜態代碼檢查 (Linter)
deno lint src/ tests/

# 型別檢查
deno check src/main.ts

# 執行所有自動化測試
deno task test
```

### 匯入路徑別名規範
專案在 `deno.json` 中配置了路徑別名，請優先使用別名進行匯入：
- `@core/` -> `./src/core/`
- `@platforms/` -> `./src/platforms/`
- `@skills/` -> `./src/skills/`
- `@types/` -> `./src/types/`
- `@utils/` -> `./src/utils/`

---

## 提交 Pull Request (PR)

1. 基於 `master` 分支建立新的功能分支：`git checkout -b feat/your-feature`。
2. 撰寫清晰的 Conventional Commits 提交訊息（例如 `feat: ...`, `fix: ...`, `docs: ...`）。
3. 送出 PR 並確保所有 CI 檢查項目（Format, Lint, Tests）均通過。
