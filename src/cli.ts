/**
 * qqbot-standalone CLI 入口
 *
 * 用法：
 *   QQBOT_APP_ID=xxx QQBOT_APP_SECRET=xxx node dist/cli.js
 *
 * 可选环境变量：
 *   QQBOT_ACCOUNT_ID   账户标识（默认 "default"）
 *   QQBOT_MARKDOWN     是否启用 markdown（"1"/"true"）
 *   QQBOT_DATA_DIR     数据目录（session 持久化）
 *
 * 行为：启动 WebSocket 收线，收到的所有消息原样 echo 回去，验证收发链路。
 */
import { QQBotGateway } from './gateway/qqbot-gateway.js';
import type { ResolvedQQBotAccount } from './types.js';

const appId = process.env.QQBOT_APP_ID;
const appSecret = process.env.QQBOT_APP_SECRET;

if (!appId || !appSecret) {
  console.error('[qqbot-standalone] 缺少环境变量 QQBOT_APP_ID / QQBOT_APP_SECRET');
  process.exit(1);
}

const boolEnv = (v: string | undefined) =>
  v === '1' || v === 'true' || v === 'yes';

const account: ResolvedQQBotAccount = {
  accountId: process.env.QQBOT_ACCOUNT_ID || 'default',
  enabled: true,
  appId,
  clientSecret: appSecret,
  secretSource: 'env',
  markdownSupport: boolEnv(process.env.QQBOT_MARKDOWN),
  userAgentSuffix: '',
  processingTimeoutMs: 0,
  config: {},
};

const gw = new QQBotGateway(account, {
  dataDir: process.env.QQBOT_DATA_DIR,
});

const shutdown = async (sig: string) => {
  console.log(`[qqbot-standalone] ${sig} received, shutting down...`);
  await gw.stop();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

gw.start({
  onReady: () => {
    console.log('[qqbot-standalone] Bot online — 发送任意消息即可收到 echo 回复');
  },
  onError: (err) => {
    console.error('[qqbot-standalone] gateway error:', err.message);
  },
  onMessage: async (_ctx, msg) => {
    console.log(`[qqbot-standalone] 收到消息 scope=${msg.replyTarget.scope} from=${msg.senderId} content=${JSON.stringify(msg.content)}`);
    await gw.sendText(msg.replyTarget, `echo: ${msg.content}`);
  },
}).catch((err) => {
  console.error('[qqbot-standalone] start failed:', err);
  process.exit(1);
});