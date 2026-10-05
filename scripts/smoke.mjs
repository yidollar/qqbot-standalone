#!/usr/bin/env node
/**
 * 冒烟测试 — 验证独立版核心链路（无真实凭据，不联网）
 */
import assert from 'node:assert/strict';

const m = await import('../dist/index.js');

// 1. 导出完整性
for (const name of [
  'QQBotGateway', 'OutboundService', 'ReplyLimiter', 'sendText', 'sendMedia',
  'sendVoice', 'sendVideo', 'parseTarget', 'normalizeTarget', 'isQQBotTarget',
  'sanitizeQQBotText', 'cacheMsgId', 'getCachedMsgId', 'clearMsgIdCache',
  'stripMentionText', 'detectWasMentioned', 'createPluginLogger',
  'runWithRequestContext', 'getRequestContext', 'getRequestTarget',
  'getRequestAccountId', 'buildUserAgent', 'getBotForAccount',
  'tryGetBotForAccount', 'registerGateway', 'unregisterGateway', 'getGateway',
  'defaultDataDir', 'dataDirMarker',
]) {
  assert.ok(m[name] !== undefined, `missing export: ${name}`);
}
console.log('  [1] exports OK');

// 2. target 解析
assert.deepEqual(m.parseTarget('qqbot:group:ABC123'), { scope: 'group', targetId: 'ABC123' });
assert.deepEqual(m.parseTarget('qqbot:c2c:U1'), { scope: 'c2c', targetId: 'U1' });
assert.equal(m.normalizeTarget('0123456789abcdef0123456789abcdef'), 'qqbot:c2c:0123456789abcdef0123456789abcdef');
assert.equal(m.isQQBotTarget('qqbot:group:g1'), true);
console.log('  [2] target OK');

// 3. 消毒
assert.equal(m.sanitizeQQBotText('<system-reminder>x</system-reminder>hello'), 'hello');
console.log('  [3] sanitize OK');

// 4. msgId 缓存
m.cacheMsgId('c2c', 'u1', 'm1');
assert.equal(m.getCachedMsgId('c2c', 'u1'), 'm1');
console.log('  [4] msgid-cache OK');

// 5. 被动回复限额
const rl = new m.ReplyLimiter({ limit: 2 });
rl.record('x'); rl.record('x');
assert.equal(rl.checkLimit('x').allowed, false);
assert.equal(rl.checkLimit('x').shouldFallbackToProactive, true);
console.log('  [5] reply-limiter OK');

// 6. 请求上下文
const target = m.runWithRequestContext({ target: 'qqbot:c2c:z' }, () => m.getRequestTarget());
assert.equal(target, 'qqbot:c2c:z');
console.log('  [6] request-context OK');

// 7. send-only 网关
const acct = {
  accountId: 'test', enabled: true, appId: 'a', clientSecret: 'b',
  secretSource: 'env', markdownSupport: false, userAgentSuffix: '',
  processingTimeoutMs: 0, config: {},
};
const gw = new m.QQBotGateway(acct);
assert.equal(gw.fullMode, false);
assert.equal(gw.bot.appId, 'a');
await assert.rejects(() => gw.start({}), /Cannot start send-only/);
console.log('  [7] send-only gateway OK');

// 8. 收发模式网关（不联网，仅构造）
const gw2 = new m.QQBotGateway(acct, { dataDir: '/tmp/qqbot-smoke-test' });
assert.equal(gw2.fullMode, true);
console.log('  [8] full-mode gateway OK');

// 9. UserAgent
assert.match(m.buildUserAgent(), /^QQBotStandalone\//);
console.log('  [9] user-agent OK');

console.log('SMOKE_TEST_ALL_OK');