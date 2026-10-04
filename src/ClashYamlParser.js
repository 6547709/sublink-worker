// Clash YAML 订阅格式解析器
// 把上游订阅（Clash YAML 格式）解析为内部 proxy 对象数组
import yaml from 'js-yaml';

/**
 * 解析 Clash YAML 文本，提取 proxy 列表
 * @param {string} text YAML 内容
 * @returns {Array} 内部 proxy 对象数组
 */
export function parseClashYaml(text) {
  let doc;
  try {
    doc = yaml.load(text);
  } catch (e) {
    throw new Error(`YAML 解析失败: ${e.message}`);
  }

  if (!doc || typeof doc !== 'object') {
    throw new Error('YAML 内容无效');
  }

  const proxies = Array.isArray(doc.proxies) ? doc.proxies : [];
  return proxies.map(clashProxyToInternal).filter(Boolean);
}

/**
 * 把 Clash 格式的 proxy 对象转为内部 proxy 对象
 * 对应 ProxyParser 输出的格式
 */
function clashProxyToInternal(cp) {
  if (!cp || !cp.type || !cp.name) return null;

  const base = {
    tag: cp.name,
    type: cp.type === 'ss' ? 'shadowsocks' : cp.type,
    server: cp.server,
    server_port: parseInt(cp.port),
    tcp_fast_open: !!cp.tfo
  };

  switch (cp.type) {
    case 'ss':
    case 'shadowsocks':
      return {
        ...base,
        method: cp.cipher,
        password: cp.password
      };

    case 'vmess':
      return {
        ...base,
        uuid: cp.uuid,
        alter_id: parseInt(cp.alterId ?? cp.alter_id ?? 0),
        security: cp.cipher || 'auto',
        tls: cp.tls ? buildTls(cp) : undefined,
        transport: buildTransport(cp)
      };

    case 'vless':
      return {
        ...base,
        uuid: cp.uuid,
        flow: cp.flow,
        tls: buildTls(cp),
        transport: buildTransport(cp)
      };

    case 'trojan':
      return {
        ...base,
        password: cp.password,
        tls: buildTls(cp),
        transport: buildTransport(cp),
        flow: cp.flow
      };

    case 'hysteria2':
      return {
        ...base,
        password: cp.password,
        tls: buildTls(cp),
        obfs: cp.obfs ? {
          type: cp.obfs,
          password: cp['obfs-password']
        } : {},
        auth: cp.auth,
        recv_window_conn: cp['recv-window-conn'] ? parseInt(cp['recv-window-conn']) : undefined,
        up_mbps: cp.up ? parseInt(cp.up) : undefined,
        down_mbps: cp.down ? parseInt(cp.down) : undefined
      };

    case 'tuic':
      return {
        ...base,
        uuid: cp.uuid,
        password: cp.password,
        tls: buildTls(cp),
        congestion_control: cp['congestion-controller'],
        flow: cp.flow
      };

    default:
      // 未知类型原样返回
      return { ...base };
  }
}

function buildTls(cp) {
  if (!cp.tls) return undefined;
  const tls = {
    enabled: true,
    server_name: cp.servername || cp.sni,
    insecure: !!cp['skip-cert-verify']
  };
  if (cp['client-fingerprint']) {
    tls.utls = {
      enabled: true,
      fingerprint: cp['client-fingerprint']
    };
  }
  if (cp['reality-opts']) {
    tls.reality = {
      enabled: true,
      public_key: cp['reality-opts']['public-key'],
      short_id: cp['reality-opts']['short-id']
    };
  }
  if (cp.alpn) {
    tls.alpn = Array.isArray(cp.alpn) ? cp.alpn : cp.alpn.split(',');
  }
  return tls;
}

function buildTransport(cp) {
  if (!cp.network || cp.network === 'tcp' || cp.network === 'tcp,udp') {
    if (!cp['ws-opts'] && !cp['grpc-opts']) return undefined;
  }
  const transport = {
    type: cp.network || 'tcp'
  };
  if (cp['ws-opts']) {
    transport.type = 'ws';
    transport.path = cp['ws-opts'].path;
    if (cp['ws-opts'].headers) {
      transport.headers = cp['ws-opts'].headers;
    }
  }
  if (cp['grpc-opts']) {
    transport.type = 'grpc';
    transport.service_name = cp['grpc-opts']['grpc-service-name'];
  }
  return transport;
}

/**
 * 把内部 proxy 对象转回 Clash YAML 格式
 * （内部格式是 Sing-box 风格的：tls 是 dict，transport 是嵌套对象）
 * （Clash 格式要求：tls 是 bool，ws-opts/grpc-opts/reality-opts 是顶层字段）
 */
export function internalProxyToClash(p) {
  if (!p || !p.type) return null;
  const out = {
    name: p.tag,
    type: p.type === 'shadowsocks' ? 'ss' : p.type,
    server: p.server,
    port: p.server_port
  };

  // 通用基础字段
  out.tfo = !!p.tcp_fast_open;
  out['skip-cert-verify'] = !!(p.tls?.insecure);

  switch (p.type) {
    case 'shadowsocks':
    case 'ss':
      out.cipher = p.method;
      out.password = p.password;
      break;

    case 'vmess':
      out.uuid = p.uuid;
      out.alterId = p.alter_id || 0;
      out.cipher = p.security || 'auto';
      out.network = p.transport?.type || 'tcp';
      attachTransport(out, p.transport);
      break;

    case 'vless':
      out.uuid = p.uuid;
      out.network = p.transport?.type || 'tcp';
      if (p.flow) out.flow = p.flow;
      attachTransport(out, p.transport);
      break;

    case 'trojan':
      out.password = p.password;
      out.network = p.transport?.type || 'tcp';
      if (p.flow) out.flow = p.flow;
      attachTransport(out, p.transport);
      break;

    case 'hysteria2':
      out.password = p.password;
      if (p.obfs?.type) {
        out.obfs = p.obfs.type;
        out['obfs-password'] = p.obfs.password;
      }
      if (p.auth) out.auth = p.auth;
      if (p.recv_window_conn !== undefined) out['recv-window-conn'] = p.recv_window_conn;
      if (p.up_mbps !== undefined) out.up = p.up_mbps;
      if (p.down_mbps !== undefined) out.down = p.down_mbps;
      break;

    case 'tuic':
      out.uuid = p.uuid;
      out.password = p.password;
      if (p.congestion_control) out['congestion-controller'] = p.congestion_control;
      if (p.flow) out.flow = p.flow;
      break;
  }

  // TLS 块（Clash 顶层字段）
  if (p.tls?.enabled) {
    out.tls = true;
    if (p.tls.server_name) out.servername = p.tls.server_name;
    if (p.tls.utls?.fingerprint) out['client-fingerprint'] = p.tls.utls.fingerprint;
    if (Array.isArray(p.tls.alpn) && p.tls.alpn.length > 0) out.alpn = p.tls.alpn;
    if (p.tls.reality) {
      out['reality-opts'] = {
        'public-key': p.tls.reality.public_key,
        'short-id': p.tls.reality.short_id
      };
    }
  }

  return out;
}

function attachTransport(out, transport) {
  if (!transport || transport.type === 'tcp' || transport.type === 'tcp,udp') return;
  if (transport.type === 'ws') {
    out.network = 'ws';
    out['ws-opts'] = {
      path: transport.path || '/',
      headers: transport.headers || {}
    };
  } else if (transport.type === 'grpc') {
    out.network = 'grpc';
    out['grpc-opts'] = {
      'grpc-service-name': transport.service_name || ''
    };
  }
}
