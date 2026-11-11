# 參與專案貢獻

歡迎參與 AIr-Friends 的開發與維護。以下說明專案的開發環境設定、程式碼風格規範與 Pull Request 流程。

---

## 本機開發環境設定

1. **安裝 Bun**：確認本機安裝 Bun 1.4.4（版本固定於 `package.json` 的 `packageManager`）。
2. **複製專案庫**。

   ```bash
   git clone https://github.com/jim60105/AIr-Friends.git
   cd AIr-Friends
   ```

3. **啟動熱重載開發伺服器**。

   ```bash
   bun run dev
   ```

---

## 程式碼風格與驗證指令

在提交變更之前，請在專案根目錄執行以下檢查指令。

```bash
# 格式化檢查
bun run fmt

# 靜態程式碼檢查 (Linter)
bun run lint

# 型別檢查
bun run check

# 執行所有自動化測試
bun run test
```

CI 依序執行 `bun run fmt:check`、`bun run lint`、`bun run check` 與測試。

### 受信任的技能設定

技能腳本以 shebang 載入 `/opt/air/skill-bunfig.toml` 這份空的唯讀設定，避免 Bun 從技能所在的工作目錄探索 `bunfig.toml`。容器映像檔已內建該檔案；本機驗證需以 root 執行 `sh scripts/install-skill-bunfig.sh`，非 root 主機請改在 rootless 容器中執行（腳本會印出完整指令）。

### 匯入路徑別名規範

專案在 `tsconfig.json` 中配置了路徑別名，請優先使用別名進行匯入。

- `@core/` → `./src/core/`
- `@platforms/` → `./src/platforms/`
- `@skills/` → `./src/skills/`
- `@types/` → `./src/types/`
- `@utils/` → `./src/utils/`
- `@acp/` → `./src/acp/`

---

## 提交 Pull Request (PR)

貢獻流程以 `master` 分支為基礎，先建立新的功能分支（例如 `git checkout -b feat/your-feature`），撰寫明確的 Conventional Commits 提交訊息（例如 `feat: ...`、`fix: ...`、`docs: ...`），送出 PR 後確認所有 CI 檢查項目（Format、Lint、Tests）均通過。
