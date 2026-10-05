/**
 * SDK 中间件编排 — 独立版
 *
 * 原插件组装 SDK 内置 13 个中间件 + 3 个插件自定义中间件
 * （policyInjector / attachmentProcessor / dynamicAccessControl 依赖 OpenClaw runtime），
 * 并挂载斜杠命令（依赖 commands/ 数十个文件）。
 *
 * 独立版仅保留纯 SDK 中间件：
 *   errorHandler → messageFilter → mentionGate → contentSanitizer
 *   → rateLimiter → concurrencyGuard → typingIndicator → quoteRef
 */
import type { QQBot, MiddlewareContext } from '@tencent-connect/qqbot-nodejs';
import {
  messageFilter,
  contentSanitizer,
  rateLimiter,
  concurrencyGuard,
  mentionGate,
  quoteRef,
  typingIndicator,
  errorHandler,
} from '@tencent-connect/qqbot-nodejs';
import type { ResolvedQQBotAccount } from '../types.js';
import { stripMentionText } from '../utils/mention.js';

export interface MiddlewareSetupOptions {
  /**
   * 内存态引用索引 store（供 quoteRef 解析被引用消息）。
   * 独立版不落盘，进程内 Map 即可；不传则跳过 quoteRef。
   */
  refIndexStore?: Map<string, unknown>;
}

/**
 * 为 QQBot 实例编排独立版中间件链
 */
export function setupMiddlewares(bot: QQBot, account: ResolvedQQBotAccount, opts: MiddlewareSetupOptions = {}): void {
  // 1. 错误兜底（最外层洋葱皮）
  bot.use(errorHandler());

  // 2. 消息过滤：bot 回声 + 消息去重
  bot.use(messageFilter({ skipSelfEcho: false }));

  // 3. 群聊 @bot 门控（SDK 内置：群消息默认要求 @机器人）
  bot.use(mentionGate());

  // 4. 内容清洗（去 @marker、表情标签、多余空白）
  // SDK 用 appId 匹配 @标记，但 QQ openid 不等于 appId，追加 stripMentionText 正确剥离
  bot.use(contentSanitizer({
    parseFaceTags: true,
    transform: (content, ctx) => stripMentionText(content, (ctx.message as any).mentions),
  }));

  // 5. 三层限流（sender / group / global）
  bot.use(rateLimiter());

  // 6. 并发串行+合并（同 peer 串行避免 session conflict；处理中消息合并为一条继续走完链）
  bot.use(concurrencyGuard({
    strategy: 'merge',
    maxQueue: 50,
    maxProcessingMs: account.processingTimeoutMs,
    /** 紧急指令（/stop）跳过排队，立即处理 */
    urgentPredicate: (ctx: MiddlewareContext) => {
      return ((ctx.message.content as string) ?? '').trim() === '/stop';
    },
    onMerge: (buffered) => {
      const last = buffered[buffered.length - 1];
      if (buffered.length === 1) return last;

      // 透传原始消息列表，下游 onMessage 回调可自行取用
      (last.state as Record<string, unknown>).mergedMessages = buffered;

      // 合并附件（所有 buffer 中的附件汇总到 survivor）
      const attachments = buffered.flatMap((c) => c.message.attachments ?? []);
      if (attachments.length > 0) {
        last.message.attachments = attachments;
      }

      return last;
    },
  }));

  // 7. C2C 输入状态指示器
  bot.use(typingIndicator());

  // 8. 引用消息解析（进程内 store，重启后引用关系丢失，可接受）
  if (opts.refIndexStore) {
    bot.use(quoteRef({ store: opts.refIndexStore as never }));
  }
}