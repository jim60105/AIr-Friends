# 平台介面介接

AIr-Friends 具備模組化的平台介面卡架構，可輕鬆擴充支援新的即時通訊軟體或社群平台。

---

## 平台介面卡架構

所有平台介面皆位於 `src/platforms/` 目錄中，並實作核心的 `PlatformAdapter` 抽象介面：

```typescript
export interface PlatformAdapter {
  readonly platform: SupportedPlatform;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  sendMessage(channelId: string, content: string, options?: MessageOptions): Promise<void>;
  onMessage(handler: (event: NormalizedEvent) => Promise<void>): void;
}
```

---

## 標準化事件物件 (`NormalizedEvent`)

為了讓核心對話引擎與特定平台的底層資料結構脫鉤，所有外部平台的原生訊息物件在進入核心前，皆須被轉換為統一的 `NormalizedEvent`：

- `platform`：平台識別程式碼。
- `channelId`：標準化頻道識別碼。
- `userId`：發言者的標準化使用者 ID。
- `userName`：發言者的顯示暱稱。
- `content`：清洗掉標記前綴後的乾淨文字內文。
- `raw`：保留的原始平台事件物件（供特定擴充功能使用）。

---

## 新增平台步驟

1. 在 `src/types/events.ts` 中的 `SupportedPlatform` 聯合型別新增你的平台名稱。
2. 在 `src/platforms/` 下建立新的目錄與介面卡類別（例如 `telegram/adapter.ts`），實作連線、訊息監聽與發送邏輯。
3. 在 `src/core/agent-core.ts` 中註冊並啟動該介面卡。
