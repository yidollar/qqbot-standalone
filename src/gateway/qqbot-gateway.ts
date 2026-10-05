/**
 * QQBotGateway — 独立版（standalone）
 *
 * 从 openclaw-qqbot 插件剥离 OpenClaw 依赖后的最小核心：
 * - Send-only 模式：new QQBotGateway(account) → 直接 REST 发送
 * - 完整模式：new QQBotGateway(account, { dataDir }) → WebSocket 收消息 + 中间件 + 回调传出
 *   （原完整模式依赖 PluginRuntime 做 dispatch/session/ref-index，此处以回调替代）
 */
import {
  QQBot,
  FileKVStore,
  kvSessionPersistence,
  MediaFileType,
  type ReplyTarget,
  type QQBotInboundMessage,
  type MiddlewareContext,
  type InteractionEvent,
  type MessageResponse,
  type StreamSession,
} from '@tencent-connect/qqbot-nodejs';
import os from 'node:os';
import type { ResolvedQQBotAccount } from '../types.js';
import type { PluginLogger } from '../utils/plugin-logger.js';
import { createPluginLogger } from '../utils/plugin-logger.js';
import { setupMiddlewares } from './middleware-setup.js';
import { handleMessageStandalone, handleInteractionStandalone } from './event-handlers.js';
import type { MessageCallback, InteractionCallback } from './event-handlers.js';
import { buildUserAgent } from '../bot-instance.js';
import { getCachedMsgId } from '../features/msgid-cache.js';
import { defaultDataDir } from './mode-marker.js';

export type { MessageCallback, InteractionCallback };

export interface GatewayCallbacks {
  onReady?: () => void;
  onError?: (error: Error) => void;
  /** 入站消息回调（替代原 dispatchToOpenClaw） */
  onMessage?: MessageCallback;
  /** 入站交互回调（按钮/菜单；SDK 已先 ack，业务可再带数据 ack） */
  onInteraction?: InteractionCallback;
}

export interface GatewayStartOptions {
  signal?: AbortSignal;
}

export interface SendOptions {
  msgId?: string;
  text?: string;
}

// ── 超时常量 ──

const TEXT_TIMEOUT_MS = 30_000;
const MEDIA_TIMEOUT_MS = 300_000;

function resolveMs(envKey: string, defaultMs: number): number {
  const env = process.env[envKey];
  if (env) {
    const v = Number(env);
    if (!Number.isNaN(v) && v > 0) return v;
  }
  return defaultMs;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  if (ms <= 0) return promise;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`出站超时: ${label} (${ms}ms)`)), ms),
    ),
  ]);
}

/** QQBot 公共构造参数（两种模式共享） */
function baseBotOptions(account: ResolvedQQBotAccount, log: PluginLogger) {
  return {
    appId: account.appId,
    appSecret: account.clientSecret,
    accountId: account.accountId,
    markdownSupport: account.markdownSupport,
    userAgent: buildUserAgent(account.userAgentSuffix),
    baseUrl: process.env.QQBOT_BASE_URL?.replace(/\/+$/, '') || 'https://api.sgroup.qq.com',
    tokenBaseUrl: process.env.QQBOT_TOKEN_BASE_URL?.replace(/\/+$/, '') || 'https://bots.qq.com',
    logger: log as never,
  };
}

/** 完整模式构造参数 */
export interface StandaloneGatewayOptions {
  /** 数据目录（session 持久化等；默认 os.tmpdir()/qqbot-standalone/<accountId>） */
  dataDir?: string;
}

export class QQBotGateway {
  readonly bot: QQBot;
  private readonly account: ResolvedQQBotAccount;
  readonly log: PluginLogger;
  private readonly textTimeout: number;
  private readonly mediaTimeout: number;
  /** 是否为收发模式（传入 opts 构造即为 true） */
  readonly fullMode: boolean;

  /** Send-only 模式：仅发送（无中间件、无 WS 收线） */
  constructor(account: ResolvedQQBotAccount);
  /**
   * 收发模式：WebSocket 收线 + SDK 中间件 + 回调传出
   * （替代原 `constructor(account, runtime, log?)` 完整模式）
   */
  constructor(account: ResolvedQQBotAccount, opts: StandaloneGatewayOptions);
  constructor(account: ResolvedQQBotAccount, opts?: StandaloneGatewayOptions) {
    this.textTimeout = resolveMs('QQBOT_OUTBOUND_TIMEOUT_MS', TEXT_TIMEOUT_MS);
    this.mediaTimeout = resolveMs('QQBOT_OUTBOUND_MEDIA_TIMEOUT_MS', MEDIA_TIMEOUT_MS);
    this.account = account;
    this.log = createPluginLogger({ prefix: `[qqbot:${account.accountId}]` });
    this.fullMode = !!opts;

    if (!opts) {
      // Send-only：极简 QQBot 实例，仅 HTTP REST 发送
      this.bot = new QQBot({ ...baseBotOptions(account, this.log), tokenPrefetch: 'async' });
      return;
    }

    // 收发模式：含 WebSocket 连接 + 中间件 + 回调路由
    const dataDir = opts.dataDir ?? defaultDataDir(account.accountId);

    this.bot = new QQBot({
      ...baseBotOptions(account, this.log),
      transport: 'websocket',
      sessionPersistence: kvSessionPersistence({
        store: new FileKVStore({ dir: dataDir, fileName: 'session.json' }),
        accountId: account.accountId,
      }),
      tokenPrefetch: 'sync',
    });

    setupMiddlewares(this.bot, account);
  }

  /**
   * 启动收发模式网关
   *
   * @param callbacks 业务回调（onReady/onError/onMessage/onInteraction）
   * @throws 若以 send-only 构造（未传 opts）调用 start
   */
  async start(callbacks?: GatewayCallbacks, options?: GatewayStartOptions): Promise<void> {
    if (!this.fullMode) {
      throw new Error(`[qqbot] Cannot start send-only gateway "${this.account.accountId}" — construct with { dataDir } for full mode`);
    }

    const handleReady = () => {
      this.log.info('Gateway ready');
      callbacks?.onReady?.();
    };
    this.bot.on('ready', handleReady);
    this.bot.on('resumed', handleReady);

    this.bot.on('error', (err: Error) => {
      this.log.error(`Gateway error: ${err.message}`);
      callbacks?.onError?.(err);
    });

    const gatewayLog = this.log.child('gateway');

    this.bot.on('message', async (ctx: MiddlewareContext, msg: QQBotInboundMessage) => {
      gatewayLog.debug(`message msgId=${msg.messageId}`);
      try {
        await handleMessageStandalone(ctx, msg, this.account, this.log, callbacks?.onMessage);
      } catch (err) {
        gatewayLog.error(`Dispatch error: ${err instanceof Error ? err.message : String(err)}`);
      }
    });

    this.bot.on('interaction', (ctx, event: InteractionEvent) => {
      handleInteractionStandalone(
        event,
        this.account,
        this.log,
        (id, code, data) => this.bot.acknowledgeInteraction(id, code, data),
        callbacks?.onInteraction,
      ).catch((err) => {
        this.log.error(`Interaction error: ${err instanceof Error ? err.message : String(err)}`);
      });
    });

    await this.bot.start(options?.signal);
  }

  /** 停止网关（SDK 的 stop 为同步语义，此处保持 async 签名便于调用方统一 await） */
  async stop(): Promise<void> {
    this.bot.stop();
  }

  async sendText(target: ReplyTarget, text: string, opts?: SendOptions): Promise<MessageResponse> {
    return withTimeout(
      this.bot.sendText(attachMsgId(target, opts), text),
      this.textTimeout, 'sendText',
    );
  }

  async sendMedia(
    target: ReplyTarget,
    source: string,
    opts?: SendOptions & { fileType?: MediaFileType },
  ): Promise<MessageResponse> {
    const resolvedTarget = attachMsgId(target, opts);
    const fileType = opts?.fileType ?? MediaFileType.IMAGE;
    const sourceOpts = resolveMediaSource(source);
    const result = await withTimeout(
      this.bot.sendMedia({ target: resolvedTarget, fileType, ...sourceOpts, content: opts?.text }),
      this.mediaTimeout, 'sendMedia',
    );
    return result.message ?? { id: '', timestamp: Date.now() };
  }

  async sendVoice(
    target: ReplyTarget,
    source: { url?: string; base64?: string; localPath?: string },
    opts?: SendOptions,
  ): Promise<MessageResponse> {
    const resolvedTarget = attachMsgId(target, opts);

    if (source.base64) {
      const result = await withTimeout(
        this.bot.sendMedia({ target: resolvedTarget, fileType: MediaFileType.VOICE, fileData: source.base64, content: opts?.text }),
        this.mediaTimeout, 'sendVoice(base64)',
      );
      return result.message ?? { id: '', timestamp: Date.now() };
    }
    if (source.localPath) {
      const result = await withTimeout(
        this.bot.sendMedia({ target: resolvedTarget, fileType: MediaFileType.VOICE, localPath: source.localPath, content: opts?.text }),
        this.mediaTimeout, 'sendVoice(path)',
      );
      return result.message ?? { id: '', timestamp: Date.now() };
    }
    const result = await withTimeout(
      this.bot.sendMedia({ target: resolvedTarget, fileType: MediaFileType.VOICE, url: source.url!, content: opts?.text }),
      this.mediaTimeout, 'sendVoice(url)',
    );
    return result.message ?? { id: '', timestamp: Date.now() };
  }

  async sendVideo(
    target: ReplyTarget,
    source: string,
    opts?: SendOptions,
  ): Promise<MessageResponse> {
    const resolvedTarget = attachMsgId(target, opts);
    const sourceOpts = resolveMediaSource(source);
    const result = await withTimeout(
      this.bot.sendMedia({ target: resolvedTarget, fileType: MediaFileType.VIDEO, ...sourceOpts, content: opts?.text }),
      this.mediaTimeout, 'sendVideo',
    );
    return result.message ?? { id: '', timestamp: Date.now() };
  }

  async sendFile(
    target: ReplyTarget,
    source: string,
    opts?: SendOptions & { fileName?: string },
  ): Promise<MessageResponse> {
    const resolvedTarget = attachMsgId(target, opts);
    const sourceOpts = resolveMediaSource(source);
    const result = await withTimeout(
      this.bot.sendMedia({ target: resolvedTarget, fileType: MediaFileType.FILE, ...sourceOpts, fileName: opts?.fileName, content: opts?.text }),
      this.mediaTimeout, 'sendFile',
    );
    return result.message ?? { id: '', timestamp: Date.now() };
  }

  openStream(target: ReplyTarget, msgId: string): StreamSession {
    return this.bot.openStream({
      target: { ...target, msgId },
    });
  }

  async sendTyping(target: ReplyTarget): Promise<void> {
    await this.bot.sendTyping(target);
  }
}

// ── 辅助 ──

/** 显式 msgId 优先，其次回落到 msgid-cache 中最近一条未过期的入站 msgId */
function attachMsgId(target: ReplyTarget, opts?: SendOptions): ReplyTarget {
  if (opts?.msgId) return { ...target, msgId: opts.msgId };
  const cached = getCachedMsgId(target.scope, target.targetId);
  return cached ? { ...target, msgId: cached } : target;
}

/** 媒体来源解析：data: / http(s) / file:// / ~/ / 绝对与相对路径 / Windows 路径 / UNC */
function resolveMediaSource(source: string): { url?: string; localPath?: string; fileData?: string } {
  if (source.startsWith('data:')) {
    const commaIdx = source.indexOf(',');
    if (commaIdx > 0) {
      return { fileData: source.slice(commaIdx + 1) };
    }
    return { fileData: source };
  }
  if (source.startsWith('http://') || source.startsWith('https://')) {
    return { url: source };
  }
  if (source.startsWith('file://')) {
    let p = source.slice('file://'.length);
    if (/^\/[a-zA-Z]:[\\/]/.test(p)) p = p.slice(1);
    try { p = decodeURIComponent(p); } catch { /* keep raw */ }
    return { localPath: p };
  }
  if (source === '~' || source.startsWith('~/') || source.startsWith('~\\')) {
    return { localPath: source.replace(/^~/, os.homedir()) };
  }
  if (
    source.startsWith('/') ||
    source.startsWith('./') || source.startsWith('../') ||
    source.startsWith('.\\') || source.startsWith('..\\') ||
    /^[a-zA-Z]:[\\/]/.test(source) ||
    source.startsWith('\\\\')
  ) {
    return { localPath: source };
  }
  return { url: source };
}