#!/usr/bin/env node
/**
 * 上游同步脚本 — 检查 @tencent-connect/openclaw-qqbot 更新并自动剥离纯净源码
 *
 * 流程：
 *  1. 查询 npm registry 最新版本，与根目录 UPSTREAM_VERSION 比对
 *  2. 无更新 → 退出（CI 中后续步骤跳过）
 *  3. 有更新 → 下载 tarball，覆盖纯净文件（无 OpenClaw 依赖，可原样复用）
 *  4. 同步上游声明的 SDK 依赖版本到 package.json
 *  5. 写入新版本号，输出 updated=true 供 CI 继续（install/build/smoke/commit）
 *
 * 纯净文件若在上游被删除/改名（breaking change），脚本以非零码退出，
 * CI 会捕获并自动开 issue。
 *
 * 环境变量：
 *  - NPM_REGISTRY  默认 https://registry.npmjs.org（国内可用 npmmirror）
 *  - GITHUB_OUTPUT CI 输出文件；本地运行时自动降级为仅打印
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REGISTRY = (process.env.NPM_REGISTRY || 'https://registry.npmjs.org').replace(/\/+$/, '');
const PKG = '@tencent-connect%2fopenclaw-qqbot';
const PKG_NAME = '@tencent-connect/openclaw-qqbot';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const versionFile = path.join(root, 'UPSTREAM_VERSION');
const current = fs.existsSync(versionFile) ? fs.readFileSync(versionFile, 'utf8').trim() : '';

const output = (text) => {
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, text);
};

// 1. 查询最新版本
const meta = await (async () => {
  const res = await fetch(`${REGISTRY}/${PKG}/latest`);
  if (!res.ok) throw new Error(`registry query failed: HTTP ${res.status}`);
  return res.json();
})();
const latest = meta.version;
if (!latest) throw new Error('registry response missing version');

if (latest === current) {
  console.log(`upstream unchanged: ${PKG_NAME} v${latest}`);
  output('updated=false\n');
  process.exit(0);
}
console.log(`upstream update found: ${current || '(none)'} -> ${latest}`);

// 2. 下载并解压 tarball
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qqbot-upstream-'));
const tgz = path.join(tmpDir, 'pkg.tgz');
const res = await fetch(meta.dist.tarball);
if (!res.ok) throw new Error(`tarball download failed: HTTP ${res.status}`);
fs.writeFileSync(tgz, Buffer.from(await res.arrayBuffer()));
execFileSync('tar', ['-xzf', tgz, '-C', tmpDir]);
const srcDir = path.join(tmpDir, 'package', 'src');
if (!fs.existsSync(srcDir)) throw new Error('upstream tarball has no src/ directory');

// 3. 覆盖纯净文件（这些文件不依赖 OpenClaw，可从上游原样复制）
const PURE_FILES = [
  'types.ts',
  'request-context.ts',
  'features/msgid-cache.ts',
  'outbound/target.ts',
  'outbound/sanitize.ts',
  'outbound/reply-limiter.ts',
  'utils/mention.ts',
];
for (const f of PURE_FILES) {
  const from = path.join(srcDir, f);
  const to = path.join(root, 'src', f);
  if (!fs.existsSync(from)) {
    console.error(`BREAKING: upstream v${latest} is missing pure file src/${f} — 人工检查剥离方案`);
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  console.log(`  copied src/${f}`);
}

// 4. 同步上游声明的 SDK 依赖版本（保证独立版始终与插件同源）
const upstreamPkg = JSON.parse(fs.readFileSync(path.join(tmpDir, 'package', 'package.json'), 'utf8'));
const sdkVer = upstreamPkg.dependencies?.['@tencent-connect/qqbot-nodejs'];
if (sdkVer) {
  const pkgPath = path.join(root, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  if (pkg.dependencies['@tencent-connect/qqbot-nodejs'] !== sdkVer) {
    pkg.dependencies['@tencent-connect/qqbot-nodejs'] = sdkVer;
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    console.log(`  sdk dep -> ${sdkVer}`);
  }
}

// 5. 记录版本号
fs.writeFileSync(versionFile, `${latest}\n`);
fs.rmSync(tmpDir, { recursive: true, force: true });

console.log(`sync done: v${current || '(none)'} -> v${latest}`);
output('updated=true\n');
output(`old=${current}\n`);
output(`new=${latest}\n`);