# 頻道潛水監聽

頻道潛水（Channel Lurk）功能讓機器人在未被直接標記的情況下，週期性觀察指定頻道的最新訊息，並在符合條件時自然加入討論。此功能僅支援 Discord。

---

## 運作原理

排程器（`src/core/channel-lurk-scheduler.ts`）以 `channelLurk.intervalMs` 為固定間隔，逐一檢查 `channels` 清單中啟用 `channelLurk` 的頻道，並讀取該頻道最近一則訊息。觸發條件有三，訊息並非機器人自己所發、未提及機器人（已提及者由一般對話流程處理），且機器人尚未對該訊息加上表情回應。三個條件全部成立且該訊息尚未處理過時，工作交由代理人工作階段決定是否加入討論。

---

## 隱私與安全界線

頻道潛水預設關閉（`platforms.discord.channelLurk.enabled`），且只能在 `channels` 清單中明確以 `channelLurk: true` 啟用的 Discord 頻道運作。潛水收集到的短期脈絡僅供該特定頻道的情境理解，不會流出至其他使用者的私密記憶庫。
