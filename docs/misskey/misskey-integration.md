# 07 - Misskey 整合指南

本章節深入解析如何連接到 Misskey 實例，包括認證機制、REST API、WebSocket 串流等實作細節。閱讀本指南後，你將能獨立實作 Misskey Bot。

---

## 整合架構概覽

```
┌─────────────────┐
│   (Bot)      │
└────────┬────────┘
         │
         ├──────────────┐
         │              │
    ┌────▼─────┐   ┌────▼──────────┐
    │ REST API │   │ WebSocket     │
    │ (got)    │   │ (reconnecting-│
    │          │   │  websocket)   │
    └────┬─────┘   └────┬──────────┘
         │              │
         │              │
    ┌────▼──────────────▼─────┐
    │  Misskey Instance       │
    │  https://misskey.io     │
    └─────────────────────────┘
```

### 通訊方式

| 方式 | 用途 | 實作 |
|------|------|------|
| **REST API** | 發文、反應、上傳檔案、查詢資料 | `got.post()` |
| **WebSocket** | 即時接收提及、回覆、通知、聊天訊息 | `reconnecting-websocket` |

---

## 認證機制

### 取得存取權杖 (Access Token)

**在 Misskey 網頁介面操作**：

1. 登入 Bot 專用帳號
2. 前往 **設定 → API**
3. 點擊 **存取權杖建立**
4. 勾選以下權限：
   - ✓ 查看帳號資訊
   - ✓ 發表或刪除貼文
   - ✓ 傳送或查看私訊
   - ✓ 對貼文添加反應
   - ✓ 查看通知
   - ✓ 使用雲端硬碟
5. 儲存產生的權杖到 `config.json` 的 `i` 欄位

### 權杖使用方式

使用 **Bearer Token 機制**，在所有 API 請求中附帶 `i` 參數：

```typescript
// REST API
{
  "i": "your-access-token",
  // ...其他參數
}

// WebSocket 連接
wss://misskey.io/streaming?i=your-access-token
```

> **安全注意事項**：
> - 權杖等同帳號密碼，切勿公開
> - 建議定期輪換權杖
> - 使用環境變數或加密儲存

---

## REST API 整合

### URL 建構邏輯

`src/config.ts` 自動從 `host` 產生 API 端點：

```typescript
import config from '../config.json' with { type: 'json' };

// 自動建構 API URL 和 WebSocket URL
config.wsUrl = config.host.replace('http', 'ws');
config.apiUrl = config.host + '/api';

export default config as Config;
```

**範例**：

| config.host | config.apiUrl | config.wsUrl |
|-------------|---------------|--------------|
| `https://misskey.io` | `https://misskey.io/api` | `wss://misskey.io` |
| `http://localhost:3000` | `http://localhost:3000/api` | `ws://localhost:3000` |

### API 呼叫實作

的 `api()` 方法統一處理所有 REST API 請求：

**核心實作** ([src/ai.ts](src/ai.ts#L414-L421))：

```typescript
import got from 'got';

@bindThis
public api(endpoint: string, param?: any) {
    this.log(`API: ${endpoint}`);
    return got.post(`${config.apiUrl}/${endpoint}`, {
        json: Object.assign({
            i: config.i  // 自動附加認證權杖
        }, param)
    }).json();
}
```

### 常用 API 端點

#### 1. 發文 (`notes/create`)

**包裝方法** ([src/ai.ts](src/ai.ts#L399-L403))：

```typescript
@bindThis
public async post(param: any) {
    const res = await this.api('notes/create', param);
    return res.createdNote;
}
```

**使用範例**：

```typescript
// 簡單發文
await this.ai.post({
    text: 'Hello, Misskey!'
});

// 回覆貼文並附檔案
await this.ai.post({
    text: '這是回覆',
    replyId: originalNoteId,
    fileIds: [uploadedFileId],
    visibility: 'home'  // 'public' | 'home' | 'followers' | 'specified'
});

// 內容警告 (CW)
await this.ai.post({
    cw: '劇透注意',
    text: '電影結局是...',
    poll: {
        choices: ['選項A', '選項B'],
        multiple: false,
        expiresAt: Date.now() + 86400000  // 24小時後
    }
});
```

#### 2. 添加反應 (`notes/reactions/create`)

```typescript
await this.ai.api('notes/reactions/create', {
    noteId: 'note-id-here',
    reaction: 'love'  // 或 '❤️', ':custom_emoji:', 等
});
```

#### 3. 上傳檔案 (`drive/files/create`)

**實作** ([src/ai.ts](src/ai.ts#L386-L397))：

```typescript
import { FormData, File } from 'formdata-node';

@bindThis
public async upload(file: Buffer | fs.ReadStream, meta: { 
    filename: string, 
    contentType: string 
}) {
    const form = new FormData();
    form.set('i', config.i);
    form.set('file', new File([file], meta.filename, { 
        type: meta.contentType 
    }));

    const res = await got.post({
        url: `${config.apiUrl}/drive/files/create`,
        body: form
    }).json();
    return res;
}
```

**使用範例**：

```typescript
// 上傳圖片
const imageBuffer = await generateImage();
const uploadedFile = await this.ai.upload(imageBuffer, {
    filename: 'generated.png',
    contentType: 'image/png'
});

// 發文並附檔案
await this.ai.post({
    text: '生成的圖片：',
    fileIds: [uploadedFile.id]
});
```

#### 4. 查詢貼文 (`notes/show`)

```typescript
const note = await this.ai.api('notes/show', {
    noteId: 'xxxxxxxxxx'
});

console.log(note.text);
console.log(note.user.username);
console.log(note.files);
```

#### 5. 查詢對話串 (`notes/conversation`)

```typescript
// 取得某則貼文之前的對話
const conversation = await this.ai.api('notes/conversation', {
    noteId: msg.id,
    limit: 10  // 最多 100
});

// conversation 是陣列，從舊到新排序
for (const note of conversation) {
    console.log(`${note.user.username}: ${note.text}`);
}
```

#### 6. 查詢時間軸 (`notes/local-timeline`)

```typescript
const tl = await this.ai.api('notes/local-timeline', {
    limit: 20,         // 預設 10，最大 100
    withFiles: false,  // 只顯示有檔案的貼文
    withRenotes: true  // 包含轉發
});
```

#### 7. 傳送私訊 (`chat/messages/create-to-user`)

**包裝方法** ([src/ai.ts](src/ai.ts#L408-L412))：

```typescript
@bindThis
public sendMessage(userId: any, param: any) {
    return this.api('chat/messages/create-to-user', 
        Object.assign({ toUserId: userId }, param)
    );
}
```

**使用範例**：

```typescript
await this.ai.sendMessage('user-id-here', {
    text: '私訊內容',
    fileId: uploadedFileId  // 選填
});
```

### 錯誤處理

```typescript
try {
    const result = await this.ai.api('notes/create', { text: '測試' });
} catch (error) {
    if (error.response) {
        // API 回傳錯誤
        console.error(`API Error ${error.response.statusCode}:`, error.response.body);
        
        // 常見錯誤碼
        // 400: 參數錯誤
        // 401: 認證失敗 (權杖無效)
        // 403: 權限不足
        // 429: 請求速率限制
        // 500: 伺服器錯誤
    } else {
        // 網路錯誤
        console.error('Network error:', error.message);
    }
}
```

### 速率限制處理

Misskey 有速率限制機制。建議使用 `promise-retry` 處理暫時性失敗：

```typescript
import promiseRetry from 'promise-retry';

await promiseRetry((retry) => {
    return this.ai.api('notes/create', { text: '重試' })
        .catch((error) => {
            if (error.response?.statusCode === 429) {
                // 遇到速率限制，重試
                retry(error);
            }
            throw error;  // 其他錯誤不重試
        });
}, {
    retries: 3,
    minTimeout: 1000,
    maxTimeout: 5000
});
```

---

## WebSocket 串流整合

### 連線建立

**實作** ([src/stream.ts](src/stream.ts#L26-L35))：

```typescript
import WebSocket from 'ws';
import _ReconnectingWebsocket from 'reconnecting-websocket';

const ReconnectingWebsocket = _ReconnectingWebsocket as unknown 
    as typeof _ReconnectingWebsocket['default'];

export default class Stream extends EventEmitter {
    private stream: any;
    
    constructor() {
        super();
        
        // 在 URL 中附加認證權杖
        this.stream = new ReconnectingWebsocket(
            `${config.wsUrl}/streaming?i=${config.i}`,
            [],
            { WebSocket: WebSocket }
        );
        
        // 註冊事件監聽器
        this.stream.addEventListener('open', this.onOpen);
        this.stream.addEventListener('close', this.onClose);
        this.stream.addEventListener('message', this.onMessage);
    }
}
```

### 自動重連機制

`reconnecting-websocket` 提供自動重連功能：

- 連線關閉時自動重試
- 指數退避演算法（首次 1 秒，然後 2 秒、4 秒...）
- 重連時自動恢復所有頻道訂閱

**重連處理** ([src/stream.ts](src/stream.ts#L77-L92))：

```typescript
@bindThis
private onOpen() {
    const isReconnect = this.state == 'reconnecting';
    this.state = 'connected';
    this.emit('_connected_');
    
    // 重送緩衝區中的訊息
    const _buffer = [...this.buffer];
    this.buffer = [];
    for (const data of _buffer) {
        this.send(data);
    }
    
    // 重連時恢復所有頻道訂閱
    if (isReconnect) {
        this.sharedConnectionPools.forEach(p => p.connect());
        this.nonSharedConnections.forEach(c => c.connect());
    }
}
```

### 訊息緩衝機制

連線中斷時，待傳送的訊息會暫存在緩衝區：

```typescript
@bindThis
public send(typeOrPayload, payload?) {
    const data = payload === undefined ? typeOrPayload : {
        type: typeOrPayload,
        body: payload
    };
    
    // 未連線時緩衝訊息
    if (this.state != 'connected') {
        this.buffer.push(data);
        return;
    }
    
    this.stream.send(JSON.stringify(data));
}
```

### 頻道訂閱系統

Misskey WebSocket 使用「頻道」概念區分不同訊息來源。

#### 頻道類型

| 頻道名稱 | 用途 | 訂閱方式 |
|---------|------|----------|
| `main` | 通知、提及、回覆、轉推 | `useSharedConnection` |
| `homeTimeline` | 首頁時間軸 | `useSharedConnection` |
| `localTimeline` | 本地時間軸 | `useSharedConnection` |
| `hybridTimeline` | 混合時間軸 | `useSharedConnection` |
| `globalTimeline` | 全域時間軸 | `useSharedConnection` |
| `chatUser` | 與特定使用者的聊天 | `connectToChannel` (需參數) |
| `channel` | 特定頻道 (Misskey Channel) | `connectToChannel` (需參數) |

#### 共用連線 (Shared Connection)

適用於不需參數的頻道，多個監聽者共用同一個訂閱。

**實作** ([src/stream.ts](src/stream.ts#L38-L50))：

```typescript
@bindThis
public useSharedConnection(channel: string): SharedConnection {
    // 尋找或建立連線池
    let pool = this.sharedConnectionPools.find(p => p.channel === channel);
    
    if (pool == null) {
        pool = new Pool(this, channel);
        this.sharedConnectionPools.push(pool);
    }
    
    const connection = new SharedConnection(this, channel, pool);
    this.sharedConnections.push(connection);
    return connection;
}
```

**使用範例** ([src/ai.ts](src/ai.ts#L140))：

```typescript
const mainStream = this.connection.useSharedConnection('main');

// 監聽提及
mainStream.on('mention', async data => {
    if (data.userId == this.account.id) return;
    console.log(`Mentioned by @${data.user.username}: ${data.text}`);
});

// 監聽回覆
mainStream.on('reply', async data => {
    console.log(`Reply from @${data.user.username}`);
});

// 監聽轉推
mainStream.on('renote', async data => {
    console.log(`Renoted by @${data.user.username}`);
});

// 監聽通知
mainStream.on('notification', data => {
    console.log(`Notification type: ${data.type}`);
});

// 監聽私訊
mainStream.on('newChatMessage', data => {
    console.log(`Chat from @${data.fromUser.username}: ${data.text}`);
});
```

#### 獨立連線 (Non-Shared Connection)

適用於需要參數的頻道，每個監聽者有獨立訂閱。

**實作** ([src/stream.ts](src/stream.ts#L57-L62))：

```typescript
@bindThis
public connectToChannel(channel: string, params?: any): NonSharedConnection {
    const connection = new NonSharedConnection(this, channel, params);
    this.nonSharedConnections.push(connection);
    return connection;
}
```

**使用範例** ([src/ai.ts](src/ai.ts#L183-L206))：

```typescript
// 訂閱與特定使用者的聊天
const chatStream = this.connection.connectToChannel('chatUser', {
    otherId: userId,
});

// 監聽該使用者的私訊
chatStream.on('message', (data) => {
    console.log(`New chat message: ${data.text}`);
    
    // 標記為已讀
    chatStream.send('read', { id: data.id });
});

// 2 分鐘後自動關閉連線（節省資源）
setTimeout(() => {
    chatStream.dispose();
}, 120000);
```

### 連線池機制

共用連線使用池化管理，自動處理訂閱計數和資源釋放。

**池化實作** ([src/stream.ts](src/stream.ts#L170-L222))：

```typescript
class Pool {
    private users = 0;  // 使用者計數
    private disposeTimerId: any;
    private isConnected = false;
    
    @bindThis
    public inc() {
        if (this.users === 0 && !this.isConnected) {
            this.connect();  // 首位使用者時建立連線
        }
        this.users++;
        
        // 取消關閉計時器
        if (this.disposeTimerId) {
            clearTimeout(this.disposeTimerId);
            this.disposeTimerId = null;
        }
    }
    
    @bindThis
    public dec() {
        this.users--;
        
        // 無使用者時，等待 3 秒後關閉連線
        if (this.users === 0) {
            this.disposeTimerId = setTimeout(() => {
                this.disconnect();
            }, 3000);
        }
    }
}
```

### WebSocket 訊息格式

#### 訂閱頻道

```json
{
  "type": "connect",
  "body": {
    "channel": "main",
    "id": "random-connection-id"
  }
}
```

#### 取消訂閱

```json
{
  "type": "disconnect",
  "body": {
    "id": "random-connection-id"
  }
}
```

#### 接收訊息

```json
{
  "type": "channel",
  "body": {
    "id": "connection-id",
    "type": "mention",
    "body": {
      "id": "note-id",
      "text": "message content",
      "user": { "id": "user-id", "username": "username" }
    }
  }
}
```

### 訊息分發

**實作** ([src/stream.ts](src/stream.ts#L102-L122))：

```typescript
@bindThis
private onMessage(message) {
    const { type, body } = JSON.parse(message.data);
    
    if (type == 'channel') {
        const id = body.id;
        
        // 尋找對應的連線
        let connections = this.sharedConnections.filter(c => c.id === id);
        if (connections.length === 0) {
            connections = [this.nonSharedConnections.find(c => c.id === id)];
        }
        
        // 廣播給所有監聽者
        for (const c of connections.filter(c => c != null)) {
            c!.emit(body.type, body.body);
            c!.emit('*', { type: body.type, body: body.body });
        }
    } else {
        this.emit(type, body);
        this.emit('*', { type, body });
    }
}
```

---

## 完整實作範例

### 簡易 Misskey Bot

```typescript
import got from 'got';
import WebSocket from 'ws';
import ReconnectingWebsocket from 'reconnecting-websocket';
import { EventEmitter } from 'events';

interface Config {
    host: string;
    i: string;
}

class SimpleMisskeyBot extends EventEmitter {
    private config: Config;
    private ws: any;
    
    constructor(config: Config) {
        super();
        this.config = config;
    }
    
    // REST API 呼叫
    async api(endpoint: string, params: any = {}) {
        const res = await got.post(`${this.config.host}/api/${endpoint}`, {
            json: { i: this.config.i, ...params }
        }).json();
        return res;
    }
    
    // 發文
    async post(text: string) {
        return await this.api('notes/create', { text });
    }
    
    // 連接 WebSocket
    connect() {
        const wsUrl = this.config.host.replace('http', 'ws');
        this.ws = new ReconnectingWebsocket(
            `${wsUrl}/streaming?i=${this.config.i}`,
            [],
            { WebSocket }
        );
        
        this.ws.addEventListener('open', () => {
            console.log('Connected');
            
            // 訂閱 main 頻道
            this.ws.send(JSON.stringify({
                type: 'connect',
                body: { channel: 'main', id: 'main' }
            }));
        });
        
        this.ws.addEventListener('message', (event) => {
            const { type, body } = JSON.parse(event.data);
            
            if (type === 'channel' && body.type === 'mention') {
                this.emit('mention', body.body);
            }
        });
    }
    
    // 關閉連線
    close() {
        this.ws.close();
    }
}

// 使用範例
const bot = new SimpleMisskeyBot({
    host: 'https://misskey.io',
    i: 'your-access-token'
});

bot.on('mention', async (note) => {
    console.log(`Mentioned: ${note.text}`);
    
    // 自動回覆
    await bot.post(`@${note.user.username} 你好！`);
    
    // 添加反應
    await bot.api('notes/reactions/create', {
        noteId: note.id,
        reaction: '👍'
    });
});

bot.connect();
```

---

## 最佳實踐

### 1. 認證安全

```typescript
// ❌ 錯誤：直接在程式碼中寫死
const config = { i: 'abc123...' };

// ✅ 正確：使用環境變數或設定檔
const config = {
    i: process.env.MISSKEY_TOKEN || require('./config.json').i
};
```

### 2. 速率限制

```typescript
// 實作簡單的速率限制器
class RateLimiter {
    private queue: (() => Promise<any>)[] = [];
    private running = false;
    
    async add<T>(fn: () => Promise<T>): Promise<T> {
        return new Promise((resolve, reject) => {
            this.queue.push(async () => {
                try {
                    const result = await fn();
                    resolve(result);
                } catch (error) {
                    reject(error);
                }
            });
            this.process();
        });
    }
    
    private async process() {
        if (this.running || this.queue.length === 0) return;
        
        this.running = true;
        const fn = this.queue.shift()!;
        await fn();
        
        // 每個請求間隔 1 秒
        await new Promise(r => setTimeout(r, 1000));
        
        this.running = false;
        this.process();
    }
}

const limiter = new RateLimiter();
await limiter.add(() => bot.api('notes/create', { text: '訊息' }));
```

### 3. 錯誤監控

```typescript
// 監控 WebSocket 狀態
ws.addEventListener('error', (error) => {
    console.error('WebSocket error:', error);
    // 發送告警通知
});

ws.addEventListener('close', () => {
    console.warn('WebSocket closed, will reconnect...');
});

// 監控 API 失敗
async function safeApi(endpoint: string, params: any) {
    try {
        return await bot.api(endpoint, params);
    } catch (error) {
        console.error(`API ${endpoint} failed:`, error);
        // 記錄到日誌系統
        return null;
    }
}
```

### 4. 資源清理

```typescript
// 定時清理不再使用的連線
setInterval(() => {
    // SharedConnection 會自動在 3 秒後關閉
    // NonSharedConnection 需要手動管理
    unusedConnections.forEach(conn => conn.dispose());
}, 60000);
```

---

## 除錯技巧

### 1. WebSocket 訊息記錄

```typescript
ws.addEventListener('message', (event) => {
    console.log('Received:', JSON.parse(event.data));
});

const originalSend = ws.send.bind(ws);
ws.send = (data: string) => {
    console.log('Sending:', JSON.parse(data));
    return originalSend(data);
};
```

### 2. API 請求記錄

```typescript
// 在 got 請求前後記錄
const api = async (endpoint: string, params: any) => {
    console.log(`→ API ${endpoint}:`, params);
    const start = Date.now();
    
    try {
        const result = await got.post(/*...*/);
        console.log(`← API ${endpoint} (${Date.now() - start}ms):`, result);
        return result;
    } catch (error) {
        console.error(`✗ API ${endpoint} failed:`, error.message);
        throw error;
    }
};
```

### 3. 連線狀態監控

```typescript
setInterval(() => {
    console.log({
        wsState: ws.readyState,  // 0=連接中, 1=已連接, 2=關閉中, 3=已關閉
        sharedConnections: bot.connection.sharedConnections.length,
        nonSharedConnections: bot.connection.nonSharedConnections.length,
        bufferedMessages: bot.connection.buffer.length
    });
}, 5000);
```

---

## 常見問題

### Q1: 為什麼我的 Bot 沒收到提及？

**檢查清單**：

- ✓ 權杖是否有「查看通知」權限？
- ✓ WebSocket 是否已連接？(`ws.readyState === 1`)
- ✓ 是否已訂閱 `main` 頻道？
- ✓ 是否過濾掉自己的訊息？(`if (data.userId == this.account.id) return;`)
- ✓ Misskey 版本是否相容？（建議 v12.0.0 以上）

### Q2: API 回應 401 Unauthorized

**可能原因**：

1. 權杖錯誤或過期 → 重新產生權杖
2. 權杖沒有對應權限 → 檢查 API 設定頁面
3. 請求格式錯誤 → 確認 `i` 參數位於 JSON body 中

### Q3: WebSocket 頻繁斷線重連

**解決方法**：

1. 檢查網路穩定性
2. 增加 `reconnecting-websocket` 的 `maxRetries`
3. 實作指數退避 (exponential backoff)
4. 確認伺服器負載狀態

### Q4: 如何處理大量訊息？

**建議**：

```typescript
// 使用佇列處理
import PQueue from 'p-queue';

const queue = new PQueue({ concurrency: 1, interval: 1000, intervalCap: 1 });

mainStream.on('mention', async (data) => {
    queue.add(async () => {
        await handleMention(data);
    });
});
```

---

## 參考資料

- [Misskey API 文件](https://misskey-hub.net/docs/api/)
- [Misskey.js (官方 SDK)](https://github.com/misskey-dev/misskey.js)
- [reconnecting-websocket npm](https://www.npmjs.com/package/reconnecting-websocket)
- [got HTTP client 文件](https://github.com/sindresorhus/got)

---

閱讀完本指南，你已具備獨立實作 Misskey Bot 的能力。建議從簡單的「收到提及就回覆」開始練習，逐步加入更複雜的功能。
