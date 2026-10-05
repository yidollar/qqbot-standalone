# qqbot-standalone

从 [`@tencent-connect/openclaw-qqbot`](https://github.com/tencent-connect/openclaw-qqbot) 插件剥离 OpenClaw 平台依赖后的 **QQ Bot 独立最小核心**。

不安装 OpenClaw，仅依赖官方 SDK [`@tencent-connect/qqbot-nodejs`](https://www.npmjs.com/package/@tencent-connect/qqbot-nodejs)，保留接近原生的收发能力。

## 功能

- **Send-only 模式**：`new QQBotGateway(account)` — 仅 HTTP REST 发送，极简、零落盘
- **收发模式**：`new QQBotGateway(account, { dataDir })` — WebSocket 收线 + SDK 中间件链 + session 持久化
- **发送**：`sendText` / `sendMedia`(图片) / `sendVoice` / `sendVideo` / `sendFile` / `openStream`(流式) / `sendTyping`
- **被动回复**：自动回落 msgid-cache 取最近 msgId；`ReplyLimiter` 超限自动降级主动消息
- **中间件链**（SDK 内置）：errorHandler → messageFilter → mentionGate → contentSanitizer → rateLimiter → concurrencyGuard(串行+合并) → typingIndicator → quoteRef
- **媒体来源**：`data:` / `http(s)://` / `file://` / `~/` / 绝对与相对路径 / Windows 路径 / UNC
- **请求上下文**：AsyncLocalStorage，异步链路里随时可取 accountId / messageId / target

## 已剥离（OpenClaw 依赖）

| 原插件 | 独立版 |
|---|---|
| `dispatchToOpenClaw`（dispatch/\*） | `onMessage` / `onInteraction` 回调传出 |
| `plugin-logger` 的 runtime.logging 桥接 | 纯 console 输出 |
| `bot-instance` 的 OpenClaw 版本引用 | `QQBotStandalone/<ver>` UA |
| 斜杠命令（commands/ 数十个文件） | 移除 |
| attachmentProcessor（STT/SILK 转码） | 移除 |
| policyInjector / dynamicAccessControl（runtime 配置） | 移除（群门控由 SDK mentionGate 静态处理） |
| channel.ts / adapter/\* / index.ts 插件注册 | 移除 |

## 安装

```bash
npm install
npm run build
```

## 快速开始

### 1. Echo Bot（收发模式）

```bash
QQBOT_APP_ID=你的appid \
QQBOT_APP_SECRET=你的secret \
node dist/cli.js
```

Bot 上线后，发任意消息会收到 `echo: <内容>` 回复，用于验证收发链路。

### 2. 作为库使用

```ts
import { QQBotGateway } from 'qqbot-standalone';
import type { ResolvedQQBotAccount } from 'qqbot-standalone';

const account: ResolvedQQBotAccount = {
  accountId: 'mybot',
  enabled: true,
  appId: process.env.QQBOT_APP_ID!,
  clientSecret: process.env.QQBOT_APP_SECRET!,
  secretSource: 'env',
  markdownSupport: false,
  userAgentSuffix: '',
  processingTimeoutMs: 0,
  config: {},
};

// 收发模式
const gw = new QQBotGateway(account, { dataDir: './data' });

await gw.start({
  onReady: () => console.log('bot online'),
  onError: (err) => console.error(err),
  onMessage: async (ctx, msg) => {
    // msg.replyTarget 可直接用于回复
    await gw.sendText(msg.replyTarget, `收到: ${msg.content}`);
    // 富媒体
    // await gw.sendMedia(msg.replyTarget, 'https://example.com/cat.jpg');
    // await gw.sendVoice(msg.replyTarget, { base64: '...' });
    // await gw.sendFile(msg.replyTarget, '/tmp/report.pdf');
  },
  onInteraction: async (event) => {
    // 按钮/菜单回调（SDK 已先 ack）
  },
});

// Send-only 模式（不收消息，仅发送）
const sender = new QQBotGateway(account);
await sender.sendText({ scope: 'c2c', targetId: 'USER_OPENID' }, 'hello');
```

## 环境变量

| 变量 | 说明 | 默认 |
|---|---|---|
| `QQBOT_APP_ID` / `QQBOT_APP_SECRET` | 机器人凭据（CLI 必需） | — |
| `QQBOT_ACCOUNT_ID` | 账户标识 | `default` |
| `QQBOT_DATA_DIR` | 数据目录 | `os.tmpdir()/qqbot-standalone/<accountId>` |
| `QQBOT_BASE_URL` | API 地址 | `https://api.sgroup.qq.com` |
| `QQBOT_OUTBOUND_TIMEOUT_MS` | 文本发送超时 | `30000` |
| `QQBOT_OUTBOUND_MEDIA_TIMEOUT_MS` | 媒体发送超时 | `300000` |

## 目录结构

```
src/
├── index.ts                  # 公共导出
├── cli.ts                    # echo bot 入口
├── bot-instance.ts           # Bot 实例访问器 + UserAgent
├── request-context.ts        # AsyncLocalStorage 请求上下文
├── types.ts                  # 类型定义
├── gateway/
│   ├── qqbot-gateway.ts      # 核心：QQBotGateway（双模式）
│   ├── middleware-setup.ts   # SDK 中间件编排
│   ├── event-handlers.ts     # 入站事件 → 回调
│   ├── mode-marker.ts        # 数据目录
│   └── index.ts
├── outbound/
│   ├── outbound-service.ts   # 出站服务（target 解析 + 被动回复限额）
│   ├── target.ts             # qqbot:c2c:xxx / qqbot:group:xxx 解析
│   ├── reply-limiter.ts      # 被动回复限额
│   └── sanitize.ts           # 文本消毒
├── features/
│   └── msgid-cache.ts        # msgId 缓存（被动回复用）
└── utils/
    ├── mention.ts            # @提及处理
    └── plugin-logger.ts      # 日志
```

## License

MIT（源码基于 `@tencent-connect/openclaw-qqbot`，遵循其原始许可）
