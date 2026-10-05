/**
 * QQBotGateway 事件处理 — 独立版
 *
 * 原插件将消息 dispatch 到 OpenClaw AI 框架；独立版改为：
 * - message: cacheMsgId + runWithRequestContext 后直接回调 onMessage
 * - interaction: ack 交互（原配置查询/更新/审批逻辑依赖 OpenClaw runtime，全部移除）
 */

import type { MiddlewareContext, QQBotInboundMessage, InteractionEvent } from '@tencent-connect/qqbot-nodejs';
import type { ResolvedQQBotAccount } from '../types.js';
import type { PluginLogger } from '../utils/plugin-logger.js';
import { runWithRequestContext } from '../request-context.js';
import { cacheMsgId } from '../features/msgid-cache.js';

export type MessageCallback = (
  ctx: MiddlewareContext,
  msg: QQBotInboundMessage,
  account: ResolvedQQBotAccount,
) => Promise<void> | void;

export type InteractionCallback = (
  event: InteractionEvent,
  account: ResolvedQQBotAccount,
) => Promise<void> | void;

export async function handleMessageStandalone(
  ctx: MiddlewareContext,
  msg: QQBotInboundMessage,
  account: ResolvedQQBotAccount,
  log: PluginLogger,
  onMessage?: MessageCallback,
): Promise<void> {
  const hlog = log.child('handle');
  const scope = msg.replyTarget.scope;
  const targetId = scope === 'group'
    ? `qqbot:group:${msg.replyTarget.targetId}`
    : `qqbot:c2c:${msg.replyTarget.targetId}`;

  const mergedCount = (ctx.state.mergedMessages as unknown[] | undefined)?.length;
  if (mergedCount) {
    hlog.info(`merged batch count=${mergedCount} msgId=${msg.messageId}`);
  } else {
    hlog.debug(`enter msgId=${msg.messageId} scope=${scope} contentLen=${(msg.content ?? '').length}`);
  }

  try {
    // 缓存 msgId 供后续被动回复（超时后自动降级为主动消息）
    cacheMsgId(scope, msg.replyTarget.targetId, msg.messageId);

    await runWithRequestContext(
      {
        accountId: account.accountId,
        messageId: msg.messageId,
        openId: msg.senderId,
        target: targetId,
      },
      () => onMessage?.(ctx, msg, account),
    );
  } catch (err) {
    hlog.error(`dispatch error: ${err}`);
  }
  hlog.debug(`done msgId=${msg.messageId}`);
}

export async function handleInteractionStandalone(
  event: InteractionEvent,
  account: ResolvedQQBotAccount,
  log: PluginLogger,
  acknowledgeInteraction: (id: string, code?: number, data?: Record<string, unknown>) => Promise<void>,
  onInteraction?: InteractionCallback,
): Promise<void> {
  // 先 ack，避免客户端等待超时
  try { await acknowledgeInteraction(event.id); } catch { /* ignore */ }

  if (onInteraction) {
    try {
      await onInteraction(event, account);
    } catch (err) {
      log.error(`interaction callback error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}