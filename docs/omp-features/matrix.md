# 總表：一覽全部功能

下表把本文件所有功能列在一起，方便快速查找。分類頁連結見左側選單。

> 每一項的 **OpenCode 側做法與差異** 見 [12. OpenCode 對照](12-opencode-comparison.md)。

| # | 功能名稱 | 分類頁 | 主要實作 | 測試 | 規格需求檔 |
|---|---|---|---|---|---|
| 1 | 可選的第二種代理：OMP | [1](01-agent-config.md) | `src/acp/types.ts`、`src/acp/agent-factory.ts` | `tests/acp/agent-factory-omp.test.ts` | `acp-integration`、`configuration-and-deployment`、`web-dashboard-chat` |
| 2 | 上游相容性契約與稽核 | [2](02-settings.md) | `src/acp/omp/compatibility-contracts.ts` | `tests/acp/omp-compatibility-contracts.test.ts` | `acp-integration` |
| 3 | 模式分離的自有設定內容 | [2](02-settings.md) | `src/acp/omp-settings.ts`、`agent-config/omp/*.yml` | `tests/acp/omp-settings.test.ts` | `acp-integration` |
| 4 | 自有設定探索來源隔離 | [2](02-settings.md) | `src/acp/omp/settings-sources.ts`、`src/acp/sandbox-manager.ts` | `tests/acp/omp-settings-sources.test.ts` | `acp-integration` |
| 5 | 兩種模式都停用 LSP | [2](02-settings.md) | `src/acp/omp-settings.ts`、`src/acp/omp/lsp-validator.ts` | `tests/acp/omp-lsp-coldstart-evidence.test.ts` | `acp-integration` |
| 6 | 依模式啟動 OMP 代理行程 | [3](03-spawn-pool.md) | `src/acp/agent-factory.ts`、`src/utils/omp-paths.ts` | `tests/acp/agent-factory-omp.test.ts` | `acp-integration` |
| 7 | 依模式隔離的共享行程池 | [3](03-spawn-pool.md) | `src/core/agent-process-pool.ts` | `tests/core/omp-pool-modes.test.ts` | `acp-integration`、`shared-acp-process-pool` |
| 8 | 載入前可執行模組排除與關鍵技能所有權 | [4](04-enforcement.md) | `src/acp/omp/discovery-guard.ts` | `tests/acp/omp-discovery-guard.test.ts` | `acp-integration` |
| 9 | 工作區可執行檔預檢 | [4](04-enforcement.md) | `src/acp/omp/executable-sources.ts` | `tests/acp/omp-executable-sources.test.ts` | `acp-integration` |
| 10 | 受限工具清單決策 | [4](04-enforcement.md) | `src/acp/omp/tool-inventory.ts`、`tool-provenance.ts`、`approval-records.ts` | `tests/acp/omp-restricted-tool-decisions.test.ts` | `acp-integration` |
| 11 | 工具呼叫的執行期強制 | [4](04-enforcement.md) | `src/acp/omp/tool-enforcement-wiring.ts`、`extension/enforcement.ts` | `tests/acp/omp-tool-enforcement-wiring.test.ts` | `acp-integration` |
| 12 | 原生擴充 API 接線 | [4](04-enforcement.md) | `src/acp/omp/extension/native-registration.ts` | `tests/acp/omp-native-registration.test.ts` | `acp-integration` |
| 13 | 承認受信任的原生內建工具 | [4](04-enforcement.md) | `src/acp/omp/tool-provenance.ts` | `tests/acp/omp-restricted-tool-decisions.test.ts` | `acp-integration` |
| 14 | 自有模組的實體部署證據 | [4](04-enforcement.md) | `src/acp/omp/deployment-module.ts`、`owned-module-evidence.ts` | `tests/acp/omp-owned-module-evidence.test.ts` | `acp-integration`、`container-packaging` |
| 15 | 破壞性操作的完整性與授權 | [5](05-destructive.md) | `src/acp/destructive-policy.ts`、`src/acp/omp/destructive-decision.ts` | `tests/acp/destructive-policy.test.ts` | `acp-integration` |
| 16 | 檔案系統邊界：候選根目錄與實體路徑 | [5](05-destructive.md) | `src/acp/filesystem-roots.ts`、`filesystem-access*.ts` | `tests/acp/filesystem-roots.test.ts` | `acp-integration` |
| 17 | 工作區系統呼叫圍籬 | [5](05-destructive.md) | `src/acp/filesystem-confinement.ts` | `tests/acp/filesystem-confinement.test.ts` | `acp-integration` |
| 18 | 一般命令的路徑參數閘門 | [5](05-destructive.md) | `src/acp/command-path-policy.ts`、`command-syntax.ts` | `tests/acp/command-path-canonical.test.ts` | `acp-integration` |
| 19 | 技能腳本清單與自動批准 | [5](05-destructive.md) | `src/acp/skill-inventory.ts` | `tests/acp/skill-inventory.test.ts` | `acp-integration` |
| 20 | 受控 URL 讀取傳輸 | [6](06-network.md) | `src/acp/omp/fetch-transport.ts`、`fetch-routes.ts` | `tests/acp/omp-fetch-transport-decisions.test.ts` | `acp-integration` |
| 21 | 受控網頁搜尋 | [6](06-network.md) | `src/acp/omp/search-transport.ts`、`search-routes.ts` | `tests/acp/omp-search-transport-decisions.test.ts` | `acp-integration` |
| 22 | 網路替換工具的放行閘門 | [6](06-network.md) | `src/acp/omp/fetch-routes.ts`、`search-routes.ts` | `tests/integration/omp-lifecycle/enforcement-composition.integration.test.ts` | `acp-integration` |
| 23 | 替換工具的原生介面契約 | [6](06-network.md) | `src/acp/omp/extension/read-replacement.ts`、`search-replacement.ts` | `tests/acp/omp-search-interface-shape.test.ts` | `acp-integration` |
| 24 | 公開程式碼搜尋（適配後移除） | [6](06-network.md) | `src/acp/omp/fetch-routes.ts`、`search-routes.ts` | `tests/acp/omp-compatibility-contracts.test.ts` | `acp-integration`、`container-packaging` |
| 25 | 部署方宣告的技能根目錄設定 | [7](07-skills.md) | `src/acp/omp-settings.ts`、`src/acp/omp/skill-root-declaration.ts` | `tests/acp/omp-skill-root-declaration.test.ts` | `acp-integration` |
| 26 | 自有技能的讀取與交接修復 | [7](07-skills.md) | `src/acp/omp/extension/read-replacement.ts`、`prompts/skills_root.md` | `tests/acp/omp-skill-uri-authorization.test.ts` | `acp-integration`、`prompt-template-system`、`skills-and-reply` |
| 27 | 技能信任對齊共用根目錄 | [7](07-skills.md) | `src/acp/omp/owned-skills.ts` | `tests/acp/omp-discovery-guard.test.ts` | `acp-integration` |
| 28 | 統一技能根目錄解析 | [7](07-skills.md) | `src/core/skills-root.ts`、`src/acp/skill-inventory.ts` | `tests/core/skill-root-wiring.test.ts` | `acp-integration`、`agent-sandbox-hardening`、`configuration-and-deployment`、`container-packaging`、`skills-and-reply` |
| 29 | 固定版本的 OMP 執行檔與封裝 | [8](08-extension-packaging.md) | `Containerfile`、`src/utils/omp-version.ts` | `tests/utils/omp-packaging.test.ts` | `agent-version-compatibility`、`container-packaging` |
| 30 | 可被原生載入的擴充套件綑綁 | [8](08-extension-packaging.md) | `scripts/omp/bundle-extension.ts` | `tests/acp/omp-owned-module-bundle-smoke.test.ts` | `acp-integration`、`container-packaging` |
| 31 | 受信任擴充模組（整體架構） | [8](08-extension-packaging.md) | `src/acp/omp/extension/*` | `tests/integration/omp-lifecycle/lifecycle.integration.test.ts` | `acp-integration` |
| 32 | 逐啟動復原情境的完整串接 | [9](09-recovery.md) | `src/acp/recovery-ownership.ts` | `tests/acp/recovery-ownership.test.ts` | `acp-integration` |
| 33 | 儀表板可選擇 OMP 代理 | [10](10-dashboard-observability.md) | `src/dashboard/server.ts`、`src/dashboard/public/` | `tests/dashboard/server.test.ts` | `web-dashboard-chat` |
| 34 | 代理思考過程的完整記錄 | [10](10-dashboard-observability.md) | `src/acp/client.ts` | `tests/acp/client.test.ts` | `acp-integration`、`session-audit-log` |
| 35 | 模擬 ACP 生命週期整合測試 | [11](11-testing-docs.md) | `tests/integration/omp-lifecycle/**` | 同左 | `acp-integration` |
| 36 | 模擬技能交接整合測試 | [11](11-testing-docs.md) | `tests/integration/omp-skill-handoff/**` | 同左 | `skills-and-reply`、`configuration-and-deployment` |
| 37 | 邊界修正的文件與決策同步 | [11](11-testing-docs.md) | `docs/OMP_*.md`、`AGENTS.md` | `tests/utils/config-trio-sync.test.ts` | `configuration-and-deployment` |

## 規格需求檔對照

| 規格檔 | 相關功能 |
|---|---|
| `openspec/specs/acp-integration/spec.md` | 1、2、3、4、5、6、7、8、9、10、11、12、13、14、15、16、17、18、19、20、21、22、23、24、25、26、27、28、30、31、32、34、35 |
| `openspec/specs/configuration-and-deployment/spec.md` | 1、28、36、37 |
| `openspec/specs/shared-acp-process-pool/spec.md` | 7 |
| `openspec/specs/container-packaging/spec.md` | 14、24、28、29、30 |
| `openspec/specs/agent-version-compatibility/spec.md` | 29 |
| `openspec/specs/skills-and-reply/spec.md` | 26、28、36 |
| `openspec/specs/prompt-template-system/spec.md` | 26 |
| `openspec/specs/agent-sandbox-hardening/spec.md` | 28 |
| `openspec/specs/session-audit-log/spec.md` | 34 |
| `openspec/specs/web-dashboard-chat/spec.md` | 1、33 |
