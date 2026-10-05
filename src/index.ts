export { QQBotGateway } from './gateway/qqbot-gateway.js';
export type {
  GatewayCallbacks,
  GatewayStartOptions,
  SendOptions,
  StandaloneGatewayOptions,
  MessageCallback,
  InteractionCallback,
} from './gateway/qqbot-gateway.js';
export { defaultDataDir, dataDirMarker } from './gateway/mode-marker.js';
export {
  sendText,
  sendMedia,
  sendVoice,
  sendVideo,
  OutboundService,
  registerGateway,
  unregisterGateway,
  getGateway,
} from './outbound/outbound-service.js';
export type { SendResult, MediaKind } from './outbound/outbound-service.js';
export { parseTarget, normalizeTarget, isQQBotTarget } from './outbound/target.js';
export { ReplyLimiter } from './outbound/reply-limiter.js';
export type { ReplyLimiterConfig, ReplyLimitResult } from './outbound/reply-limiter.js';
export { sanitizeQQBotText } from './outbound/sanitize.js';
export { cacheMsgId, getCachedMsgId, clearMsgIdCache } from './features/msgid-cache.js';
export { stripMentionText, detectWasMentioned } from './utils/mention.js';
export { createPluginLogger } from './utils/plugin-logger.js';
export type { PluginLogger, PluginLoggerOpts } from './utils/plugin-logger.js';
export {
  runWithRequestContext,
  getRequestContext,
  getRequestTarget,
  getRequestAccountId,
} from './request-context.js';
export type { RequestContext } from './request-context.js';
export { buildUserAgent, getBotForAccount, tryGetBotForAccount } from './bot-instance.js';
export type {
  ResolvedQQBotAccount,
  QQBotAccountConfig,
  GroupConfig,
  GroupPolicy,
} from './types.js';