/**
 * proxy-bootstrap — 独立版网络引导
 *
 * 场景：设备上有全局 VPN（tun0 + 本地 HTTP 代理），root 进程的 DNS 查询会被
 * VPN 路由规则吞掉（getaddrinfo EAI_AGAIN）。Node 内置 fetch（undici）不读
 * 系统代理，ws 包的 WebSocket 握手也不走代理。
 *
 * 本模块在程序入口最早处执行一次（通过 QQBOT_PROXY 环境变量启用）：
 * 1. undici 全局 dispatcher → 所有 fetch（token/API/媒体上传）经代理出网
 * 2. https.request patch → 识别 ws 的握手请求（带 Sec-WebSocket-Key 头），
 *    将其 createConnection 替换为「CONNECT 隧道 + TLS 升级」，网关长连接经代理出网
 */
import { ProxyAgent, setGlobalDispatcher } from 'undici';
import net from 'node:net';
import tls from 'node:tls';
import https from 'node:https';

export function setupProxy(): void {
  const proxyUrl = process.env.QQBOT_PROXY;
  if (!proxyUrl) return;

  // 1. fetch（undici）走代理
  setGlobalDispatcher(new ProxyAgent(proxyUrl));

  // 2. WebSocket 握手走代理（CONNECT 隧道）
  const proxy = new URL(proxyUrl);
  const proxyHost = proxy.hostname.replace(/^\[|\]$/g, '');
  const proxyPort = Number(proxy.port) || (proxy.protocol === 'https:' ? 443 : 80);
  const origRequest = https.request.bind(https);

  https.request = function patchedRequest(this: unknown, ...args: unknown[]) {
    const opts = args.find(
      (a): a is Record<string, unknown> =>
        !!a && typeof a === 'object' && !Array.isArray(a) && !(a instanceof URL),
    );
    const headers = opts?.headers as Record<string, unknown> | undefined;
    if (opts && opts.createConnection && headers?.['Sec-WebSocket-Key']) {
      const host = String(opts.host);
      const port = Number(opts.port) || 443;
      opts.createConnection = (
        _copts: unknown,
        cb: (err: Error | null, sock?: tls.TLSSocket) => void,
      ) => {
        const raw = net.connect(proxyPort, proxyHost, () => {
          raw.write(`CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n\r\n`);
        });
        let buf = '';
        const onData = (d: Buffer) => {
          buf += d.toString('latin1');
          if (buf.includes('\r\n\r\n')) {
            raw.removeListener('data', onData);
            if (/HTTP\/1\.[01] 200/.test(buf)) {
              const tlsSock = tls.connect({ socket: raw, servername: host });
              tlsSock.on('secureConnect', () => cb(null, tlsSock));
            } else {
              raw.destroy();
              cb(new Error(`proxy CONNECT failed: ${buf.split('\r\n')[0]}`));
            }
          }
        };
        raw.on('data', onData);
        raw.on('error', (e) => cb(e));
        return undefined; // 异步回调模式（http.ClientRequest 支持）
      };
    }
    return origRequest(...(args as Parameters<typeof https.request>));
  } as typeof https.request;
}