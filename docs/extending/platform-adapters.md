# 平台介面介接

AIr-Friends 具備模組化的平台介面卡架構，可擴充支援新的即時通訊軟體或社群平台。

---

## 平台介面卡架構

各平台介面位於 `src/platforms/<platform>/`，並繼承 `src/platforms/platform-adapter.ts` 的抽象類別 `PlatformAdapter`。核心對話引擎只透過抽象方法與平台互動，無須理解各平台的原生資料結構。

`PlatformAdapter` 定義了下列抽象方法（節錄）。

```typescript
export abstract class PlatformAdapter implements MessageFetcher {
  abstract readonly platform: Platform;
  abstract readonly capabilities: PlatformCapabilities;

  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract determineSpontaneousTarget(config: Config): Promise<SpontaneousTarget | null>;
  abstract sendTyping(channelId: string): Promise<void>;
  abstract sendReply(channelId: string, content: string, options?: ReplyOptions): Promise<ReplyResult>;
  abstract editMessage(channelId: string, messageId: string, newContent: string, replyToMessageId?: string): Promise<ReplyResult>;
  abstract addReaction(channelId: string, messageId: string, emoji: string): Promise<ReactionResult>;
  abstract sendFile(channelId: string, files: SendFilePayload[], options?: SendFileOptions): Promise<SendFileResult>;
  abstract fetchRecentMessages(channelId: string, limit: number): Promise<PlatformMessage[]>;
  abstract fetchMessage(channelId: string, messageId: string): Promise<PlatformMessage | null>;
  abstract fetchEmojis(): Promise<PlatformEmoji[]>;
  abstract getUsername(userId: string): Promise<string>;
  abstract isSelf(userId: string): boolean;
  abstract getBotId(): string | null;
  abstract getDmChannelId(userId: string): Promise<string | null>;
  abstract hasBotReaction(channelId: string, messageId: string): Promise<boolean>;
  abstract hasBotMention(channelId: string, messageId: string): Promise<boolean>;

  onEvent(handler: EventHandler): void;
  offEvent(handler: EventHandler): void;
}
```

實際方法簽章與基底類別的行為以 `src/platforms/platform-adapter.ts` 為準。

---

## 標準化事件物件（`NormalizedEvent`）

為了讓核心對話引擎與特定平台的底層資料結構脫鉤，各平台的原生事件在進入核心前，皆須轉換為統一的 `NormalizedEvent`（定義於 `src/types/events.ts`）。

- `platform`：平台識別程式碼（`discord` 或 `misskey`）。
- `channelId`：標準化頻道識別碼。Misskey 另使用 `note:{id}`、`dm:{userId}`、`chat:{userId}` 三種格式。
- `userId`：發言者的標準化使用者 ID。
- `username`：發言者的顯示名稱。
- `messageId`：原始訊息識別碼。
- `isDm`：是否為私訊。
- `guildId`：伺服器識別碼（不適用時為空字串）。
- `content`：清洗掉標記前綴後的乾淨文字內文。
- `timestamp`：訊息原始時間。
- `attachments`：訊息附帶的附件清單。

---

## 新增平台步驟

先在 `src/types/events.ts` 的 `Platform` 型別與 `VALID_PLATFORMS` 清單新增你的平台名稱，再於 `src/platforms/` 下建立新的目錄與介面卡類別（例如 `telegram/adapter.ts`），繼承 `PlatformAdapter` 並實作所有抽象方法。最後在平台註冊流程（`src/platforms/platform-registry.ts` 與 `src/bootstrap.ts`）註冊並啟動該介面卡。
