/**
 * bot-instance — 独立版 Bot 实例访问器
 *
 * 移除 OpenClaw 版本引用，buildUserAgent 不再携带 OpenClaw 框架版本。
 * 保留 getBotForAccount / tryGetBotForAccount 供外部快速拿 SDK 实例。
 */
import os from 'node:os';
import type { QQBot } from '@tencent-connect/qqbot-nodejs';
import { getGateway } from './outbound/outbound-service.js';

const PLUGIN_VERSION = '1.0.0'; // 独立版版本（原 __PLUGIN_VERSION__ 编译注入）

export function buildUserAgent(suffix?: string): string {
  const base = `QQBotStandalone/${PLUGIN_VERSION} (Node/${process.versions.node}; ${os.platform()})`;
  return suffix ? `${base} ${suffix}` : base;
}

// ── Bot 实例获取 ──

/**
 * 获取指定账户的 QQBot SDK 实例。
 *
 * @throws 如果该账户的 gateway 尚未启动
 */
export function getBotForAccount(accountId: string): QQBot {
  const gw = getGateway(accountId);
  if (!gw) {
    throw new Error(`[qqbot] Bot "${accountId}" not running — gateway not started`);
  }
  return gw.bot;
}

/**
 * 尝试获取指定账户的 QQBot SDK 实例（不抛异常）。
 * 返回 null 表示 gateway 尚未启动。
 */
export function tryGetBotForAccount(accountId: string): QQBot | null {
  const gw = getGateway(accountId);
  return gw?.bot ?? null;
}