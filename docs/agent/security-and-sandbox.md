# 沙盒與安全界線

在結合社群聊天與自主 AI 代理人的系統中，安全性與沙盒隔離機制是保護主機與使用者資料的核心防線。

---

## 使用者工作區邊界 (Workspace Boundary)

AIr-Friends 嚴格貫徹工作區信任邊界原則。每個使用者的獨立工作目錄格式為 `repo/workspaces/{platform}/{userId}/`，代理人啟動子行程時，工作目錄（cwd）會被強制釘選在該使用者的工作區內，產生的暫存檔案統一置於 `{workspace}/tmp/{sessionId}/`。系統檔案存取防護層會攔截並拒絕任何路徑遍歷（Directory Traversal）嘗試，例如 `../` 或符號連結跳躍；在 ACP 回呼層面，使用者 A 也無法透過回呼 API 存取使用者 B 的工作區目錄與記憶檔案。

---

## 限制模式 (Restricted) 與 YOLO 模式

系統支援兩種代理人授權與執行模式。

| 模式名稱 | 權限要求與授權機制 | 適用場景 |
| :--- | :--- | :--- |
| **Restricted（限制模式，預設）** | 任何寫入檔案、刪除操作或外部指令呼叫，必須通過 ACP 權限審查機制（Approval Gate）。所有破壞性操作皆會被嚴格審查或預設拒絕。 | 公開伺服器、多使用者群聊、生產環境 |
| **YOLO 模式（自動核准模式）** | 自動核准代理人發出的所有工具呼叫與檔案修改請求，完全略過人工確認。 | 本機單人開發、高度受信任的專用測試頻道 |

帳號層級的 YOLO 控制可以在組態中針對指定管理員帳號設定 `yolo: true`（如 `{platform}/account/{id}`）。此時該帳號無論是在私訊或頻道中互動，代理人都會以 YOLO 模式執行，而不影響其他一般使用者的限制模式。

---

## 明確安全保證與限制 (Guarantees & Limitations)

在架構設計上，AIr-Friends 明確界定防護範疇與其限制。

### 選擇性作業系統層級沙盒 (Opt-in OS Confinement)

搭配 bwrap 建立的掛載隔離是明確的選擇性功能（`agent.sandbox.filesystemConfinement: true`），需要主機核心具備未授權使用者命名空間（User Namespace）支援。無根容器環境無法使用這項隔離，因為 bwrap 必須在新建的命名空間中重新掛載 `/proc`，此動作在雙重巢狀使用者命名空間中必然失敗（例如 Rootless Podman 會出現 `Can't mount proc … Permission denied`），加掛額外能力亦無法繞過。啟用前請以 `scripts/probe-sandbox-caps.sh` 在實際部署環境中驗證。

Kubernetes 另有前置條件。節點須允許未授權使用者命名空間（`user.max_user_namespaces > 0`，Talos 預設值為 `0`）；Pod 須指定非預設的 `seccompProfile`，因為 containerd 預設 seccomp 設定檔會以 `CAP_SYS_ADMIN` 攔阻 `unshare` 與 `clone(CLONE_NEWUSER)`，並須將命名空間的 PodSecurity 等級自 `baseline` 放寬；`/proc` 的遮罩掛載另需以 `securityContext.procMount: Unmasked` 解除，而該項自 K8s 1.30 起要求 `hostUsers: false`，連帶需要 containerd 2.0 以上（或 CRI-O 1.25 以上）。無法滿足上述條件的叢集應維持 `filesystemConfinement: false`，改依賴永遠啟用的權限閘門、環境變數過濾與輸出代理。

設定啟用了檔案系統沙盒隔離，但主機環境缺乏支援時（如無法建立命名空間，或 `/usr/local` 符號連結拓樸限制），系統會直接擲出例外並終止啟動，不會暗中降級至未隔離狀態。若需在無沙盒環境執行，必須由維運人員主動將該設定調整為 `false`。

### 原生工具與環境權限界限

ACP 回呼保護主要約束透過 ACP 協定請求的檔案操作。外部代理人二進位檔若透過底層原生 Shell 或內建工具存取未掛載隔離的本機檔案，仍受作業系統行程權限規範。

### 輸出代理限制（Egress Proxy Limitations）

`agent.sandbox.egressProxy` 預設啟用，在輸出端套用 SSRF 規則，阻擋回送位址、私有網段、連結本地與雲端中介資料位址。它不解析或過濾允許目標的封包內容，也不等同於完整的防火牆。

### OMP 原生上游差異 (Accepted Upstream Differences)

OMP 與 OpenCode 的原生工具解析邏輯存在差異，部分工具名稱與原生載入機制由專案自訂的原生擴充套件（Trusted Extension）進行相容性適配。

### 證據邊界分立原則 (Evidence Boundaries)

原始碼審查（Source Audit）確認上游與專案的合約邏輯靜態規範；單元與模擬測試（Unit/Mock）只證明本專案客戶端層面的邏輯決策正確，不代表官方代理人二進位檔的真實行為；映像檔二進位派發（Native Dispatch）驗證二進位檔在特定測試套件下的原生工具派發能力；維運者執行階段驗收（Operator Runtime Acceptance）則要求維運人員在具備真實權限的環境中執行驗收指令，親自確認真實環境能否阻擋未授權行為。
