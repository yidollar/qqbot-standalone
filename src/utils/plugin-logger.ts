/**
 * PluginLogger — 统一日志接口（独立版）
 *
 * 原插件通过 OpenClaw runtime.logging.getChildLogger 桥接框架日志；
 * 独立版移除 frameworkSink，统一使用 console 输出（保留 RequestContext trace 富化）。
 */

import { getRequestContext } from '../request-context.js';

export interface PluginLogger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
  debug(msg: string, meta?: Record<string, unknown>): void;
  child(tag: string): PluginLogger;
}

export interface PluginLoggerOpts {
  prefix?: string;
  output?: Pick<PluginLogger, 'info' | 'warn' | 'error' | 'debug'>;
  /** 强制 console 输出（默认已全部 console） */
  forceConsole?: boolean;
}

// ─── Console sink ──────────────────────────────────────────────────────────

function consoleSink(): Pick<PluginLogger, 'info' | 'warn' | 'error' | 'debug'> {
  const C = '\x1b[36m', Y = '\x1b[33m', R = '\x1b[31m', G = '\x1b[90m', X = '\x1b[0m';
  return {
    debug: (m) => console.debug(`${G}[qqbot]${X}`, m),
    info: (m) => console.log(`${C}[qqbot]${X}`, m),
    warn: (m) => console.warn(`${Y}[qqbot]${X}`, m),
    error: (m) => console.error(`${R}[qqbot]${X}`, m),
  };
}

// ─── Trace metadata ─────────────────────────────────────────────────────────

function enrichMeta(meta?: Record<string, unknown>): Record<string, unknown> | undefined {
  const ctx = getRequestContext();
  if (!ctx) return meta;
  const trace: Record<string, unknown> = {};
  if (ctx.accountId) trace.accountId = ctx.accountId;
  if (ctx.messageId) trace.messageId = ctx.messageId;
  if (ctx.openId) trace.openId = ctx.openId;
  if (Object.keys(trace).length === 0) return meta;
  return meta ? { ...trace, ...meta } : trace;
}

// ─── Factory ────────────────────────────────────────────────────────────────

export function createPluginLogger(opts: PluginLoggerOpts = {}): PluginLogger {
  const output = opts.output ?? consoleSink();
  const prefix = opts.prefix ?? '';

  const fmt = (msg: string): string =>
    prefix ? `${prefix} ${msg}` : msg;

  const buildChild = (parentPrefix: string, tag: string): PluginLogger =>
    createPluginLogger({
      output,
      prefix: parentPrefix ? `${parentPrefix}[${tag}]` : `[${tag}]`,
    });

  return {
    info: (msg, meta) => output.info(fmt(msg), enrichMeta(meta)),
    warn: (msg, meta) => output.warn(fmt(msg), enrichMeta(meta)),
    error: (msg, meta) => output.error(fmt(msg), enrichMeta(meta)),
    debug: (msg, meta) => output.debug(fmt(msg), enrichMeta(meta)),
    child: (tag: string) => buildChild(prefix, tag),
  };
}