/**
 * mode-marker — 独立版数据目录工具
 *
 * 原插件使用 OpenClaw runtime 提供的数据目录；独立版直接
 * 从环境变量或系统临时目录解析数据目录，并下发给网关。
 */
import os from 'node:os';

export const dataDirMarker = 'qqbot-standalone-data-dir';

export function defaultDataDir(accountId: string): string {
  const base =
    process.env.QQBOT_STANDALONE_DATA_DIR ||
    process.env.OPENCLAW_STATE_DIR ||
    os.tmpdir();
  return `${base}/qqbot-standalone/${accountId}`;
}