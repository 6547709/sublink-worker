// ACL4SSR .ini 格式解析器
// 解析 subconverter 风格的 .ini 配置文件，转换为 Clash 完整配置

/**
 * 从 URL 拉取并解析 ACL4SSR ini
 */
export async function fetchAndParseIni(url, userAgent = 'clash.meta') {
  const resp = await fetch(url, {
    headers: { 'User-Agent': userAgent }
  });
  if (!resp.ok) {
    throw new Error(`拉取 ini 失败: ${resp.status} ${resp.statusText}`);
  }
  const text = await resp.text();
  return parseIni(text);
}

/**
 * 解析 ACL4SSR ini 文本
 *
 * 返回结构：
 *   rules: Clash 规则字符串数组
 *   proxyGroups: {name, type, proxies, testUrl?, interval?, tolerance?}[]
 *   ruleProviders: {name, type, url, format, behavior, interval}[]
 */
export function parseIni(text) {
  const rules = [];
  const proxyGroups = [];
  const ruleProviders = [];
  // 用 URL → 短名 映射去重
  const urlToName = new Map();

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith(';') || line.startsWith('#')) continue;

    if (line.startsWith('ruleset=')) {
      const entry = parseRulesetLine(line, urlToName, ruleProviders);
      if (entry) rules.push(entry);
    } else if (line.startsWith('custom_proxy_group=')) {
      const group = parseProxyGroupLine(line);
      if (group) proxyGroups.push(group);
    }
    // 忽略 enable_rule_generator、overwrite_original_rules 等
  }

  return { rules, proxyGroups, ruleProviders };
}

/**
 * 解析单行 ruleset= 指令
 * 格式 1: ruleset=GROUP,URL        → RULE-SET,provider-name,GROUP
 * 格式 2: ruleset=GROUP,[]TYPE,VAL  → TYPE,VAL,GROUP
 * 格式 3: ruleset=GROUP,[]FINAL     → MATCH,GROUP
 */
function parseRulesetLine(line, urlToName, ruleProviders) {
  const payload = line.slice('ruleset='.length);
  const firstComma = payload.indexOf(',');
  if (firstComma === -1) return null;

  const groupName = payload.slice(0, firstComma).trim();
  const target = payload.slice(firstComma + 1).trim();
  if (!groupName || !target) return null;

  if (target === '[]FINAL') {
    return `MATCH,${groupName}`;
  }
  if (target.startsWith('[]')) {
    // 内联规则：[]DOMAIN-SUFFIX,example.com → DOMAIN-SUFFIX,example.com
    const inlineRule = target.slice(2);
    return `${inlineRule},${groupName}`;
  }
  // URL 规则集：注册 provider 并引用 provider 名
  const providerName = registerRuleProvider(target, urlToName, ruleProviders);
  return `RULE-SET,${providerName},${groupName}`;
}

/**
 * 把 URL 注册到 ruleProviders（如果尚未存在），返回 provider 名
 * provider 名用 URL 末段去扩展名生成，保证稳定
 */
function registerRuleProvider(url, urlToName, ruleProviders) {
  if (urlToName.has(url)) return urlToName.get(url);

  // 从 URL 末段提取名字
  // 例如 https://.../BanAD.list → provider-BanAD
  let baseName = 'provider';
  try {
    const u = new URL(url);
    const pathname = u.pathname;
    const lastSlash = pathname.lastIndexOf('/');
    const filename = lastSlash >= 0 ? pathname.slice(lastSlash + 1) : pathname;
    baseName = filename
      .replace(/\.(list|yaml|yml|txt|conf)$/i, '')
      .replace(/[^a-zA-Z0-9_-]/g, '_');
    if (!baseName) baseName = 'provider';
  } catch (e) {
    // URL 解析失败，用 hash
    baseName = 'provider_' + simpleHash(url);
  }

  // 保证唯一
  let name = baseName;
  let i = 2;
  while ([...urlToName.values()].includes(name)) {
    name = `${baseName}_${i++}`;
  }

  urlToName.set(url, name);
  ruleProviders.push({
    name,
    type: 'http',
    url,
    format: 'yaml',
    behavior: 'classical',
    interval: 86400,
    path: `./ruleset/${name}.yaml`
  });
  return name;
}

function simpleHash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}

/**
 * 解析单行 custom_proxy_group= 指令
 *
 * 格式: custom_proxy_group=NAME`type`OPT1`OPT2`OPT3...
 *
 * select 类型 OPT：
 *   []DIRECT      → DIRECT
 *   []REJECT      → REJECT
 *   (.*)          → __ALL__ （所有用户代理）
 *   其他          → 引用其他代理组名
 *
 * url-test 类型 OPT（顺序固定）：
 *   必填：(.*)
 *   可选：test-url (http://...)
 *   可选：interval (整数秒)
 *   可选：,,tolerance
 */
function parseProxyGroupLine(line) {
  const payload = line.slice('custom_proxy_group='.length);
  const parts = payload.split('`');
  if (parts.length < 2) return null;

  const [name, type, ...options] = parts;
  if (!name || !type) return null;

  const group = {
    name: name.trim(),
    type: type.trim(),
    proxies: []
  };

  if (type === 'url-test' || type === 'fallback') {
    // url-test/fallback 格式：`(.*)` + 可选 test-url + interval + ,tolerance
    for (const opt of options) {
      const t = opt.trim();
      if (!t) continue;
      if (t === '(.*)') {
        group.proxies.push('__ALL__');
      } else if (t.startsWith('http://') || t.startsWith('https://')) {
        group.testUrl = t;
      } else if (/^\d+$/.test(t)) {
        group.interval = parseInt(t);
      } else if (t.startsWith(',,')) {
        // ,,tolerance → tolerance
        group.tolerance = parseInt(t.slice(2)) || 50;
      }
    }
    // 默认值
    if (!group.testUrl) group.testUrl = 'http://www.gstatic.com/generate_204';
    if (!group.interval) group.interval = 300;
    if (group.tolerance === undefined) group.tolerance = 50;
  } else {
    // select 类型
    for (const opt of options) {
      const t = opt.trim();
      if (!t) continue;
      if (t === '[]DIRECT') group.proxies.push('DIRECT');
      else if (t === '[]REJECT') group.proxies.push('REJECT');
      else if (t === '(.*)') group.proxies.push('__ALL__');
      else if (t.startsWith('[]')) group.proxies.push(t.slice(2));  // []GROUP_NAME → GROUP_NAME
      else group.proxies.push(t);
    }
  }

  return group;
}

/**
 * 从 ini + 代理节点生成完整 Clash YAML
 */
export function buildClashConfigFromIni(proxies, ini) {
  const proxyNames = proxies.map(p => p.tag).filter(Boolean);

  const proxyGroups = ini.proxyGroups.map(group => {
    const expandedProxies = [];
    for (const p of group.proxies) {
      if (p === '__ALL__') {
        expandedProxies.push(...proxyNames);
      } else {
        expandedProxies.push(p);
      }
    }
    const unique = [...new Set(expandedProxies)];
    const result = {
      name: group.name,
      type: group.type,
      proxies: unique
    };
    if (group.type === 'url-test' || group.type === 'fallback') {
      result.url = group.testUrl;
      result.interval = group.interval;
      result.tolerance = group.tolerance;
    }
    return result;
  });

  // rule-providers 配置
  const ruleProviders = {};
  for (const p of ini.ruleProviders) {
    ruleProviders[p.name] = {
      type: p.type,
      behavior: p.behavior,
      url: p.url,
      path: p.path,
      interval: p.interval
    };
  }

  return {
    'port': 7890,
    'socks-port': 7891,
    'allow-lan': false,
    'mode': 'rule',
    'log-level': 'info',
    'geodata-mode': true,
    'geo-auto-update': true,
    'geodata-loader': 'standard',
    'geox-url': {
      'geoip': 'https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@release/geoip.dat',
      'geosite': 'https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@release/geosite.dat',
      'mmdb': 'https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@release/country.mmdb'
    },
    'dns': {
      'enable': true,
      'ipv6': true,
      'enhanced-mode': 'fake-ip',
      'nameserver': [
        'https://120.53.53.53/dns-query',
        'https://223.5.5.5/dns-query'
      ],
      'proxy-server-nameserver': [
        'https://120.53.53.53/dns-query',
        'https://223.5.5.5/dns-query'
      ],
      'nameserver-policy': {
        'geosite:cn,private': [
          'https://120.53.53.53/dns-query',
          'https://223.5.5.5/dns-query'
        ],
        'geosite:geolocation-!cn': [
          'https://dns.cloudflare.com/dns-query',
          'https://dns.google/dns-query'
        ]
      }
    },
    'proxies': proxies,
    'proxy-groups': proxyGroups,
    'rule-providers': ruleProviders,
    'rules': ini.rules
  };
}

/**
 * 从 ini + 代理节点生成 Sing-box JSON 配置
 */
export function buildSingboxConfigFromIni(proxies, ini) {
  const proxyNames = proxies.map(p => p.tag).filter(Boolean);

  const outbounds = [];
  for (const group of ini.proxyGroups) {
    const expandedProxies = [];
    for (const p of group.proxies) {
      if (p === '__ALL__') expandedProxies.push(...proxyNames);
      else expandedProxies.push(p);
    }
    const unique = [...new Set(expandedProxies)];
    const ob = {
      type: group.type === 'url-test' ? 'urltest' : 'selector',
      tag: group.name,
      outbounds: unique
    };
    if (group.type === 'url-test' || group.type === 'fallback') {
      ob.url = group.testUrl;
      ob.interval = `${group.interval}s`;
      ob.tolerance = group.tolerance;
    }
    outbounds.push(ob);
  }

  // 收集 rule_set 标签
  const routeRuleSets = ini.ruleProviders.map(p => ({
    tag: p.name,
    type: 'remote',
    format: p.format || 'yaml',
    url: p.url,
    download_detour: 'DIRECT'
  }));

  const rules = [];
  for (const ruleLine of ini.rules) {
    const parts = ruleLine.split(',');
    if (parts[0] === 'RULE-SET' && parts.length >= 3) {
      rules.push({
        rule_set: [parts[1]],
        outbound: parts[2]
      });
    } else if (parts[0] === 'MATCH') {
      // final 在 route.final 设置
    } else if (parts.length >= 3) {
      const [type, value, outbound, ...flags] = parts;
      const rule = { outbound };
      const flagNoResolve = flags.includes('no-resolve');
      switch (type) {
        case 'DOMAIN-SUFFIX':
          rule.domain_suffix = value;
          break;
        case 'DOMAIN-KEYWORD':
          rule.domain_keyword = value;
          break;
        case 'DOMAIN':
          rule.domain = value;
          break;
        case 'IP-CIDR':
        case 'IP-CIDR6':
          rule.ip_cidr = value;
          if (flagNoResolve) rule.no_resolve = true;
          break;
        case 'GEOIP':
          rule.geoip = value;
          if (flagNoResolve) rule.no_resolve = true;
          break;
        case 'PROCESS-NAME':
          rule.process_name = value;
          break;
      }
      if (Object.keys(rule).length > 1) rules.push(rule);
    }
  }

  const finalRule = ini.rules.find(r => r.startsWith('MATCH,'));
  const finalOutbound = finalRule ? finalRule.slice('MATCH,'.length) : proxyNames[0] || 'DIRECT';

  return {
    log: { level: 'info' },
    dns: {
      servers: [
        { tag: 'dns_proxy', address: 'tcp://1.1.1.1', detour: proxyNames[0] || 'DIRECT', strategy: 'ipv4_only' },
        { tag: 'dns_direct', address: 'https://dns.alidns.com/dns-query', detour: 'DIRECT', strategy: 'ipv4_only' },
        { tag: 'dns_fakeip', address: 'fakeip' }
      ],
      final: 'dns_direct',
      independent_cache: true,
      fakeip: { enabled: true, inet4_range: '198.18.0.0/15', inet6_range: 'fc00::/18' }
    },
    inbounds: [
      { type: 'mixed', tag: 'mixed-in', listen: '0.0.0.0', listen_port: 2080 },
      { type: 'tun', tag: 'tun-in', address: '172.19.0.1/30', auto_route: true, strict_route: true, stack: 'mixed', sniff: true }
    ],
    outbounds: [
      { type: 'block', tag: 'REJECT' },
      { type: 'direct', tag: 'DIRECT' },
      ...outbounds,
      ...proxies
    ],
    route: {
      rule_set: routeRuleSets,
      rules,
      final: finalOutbound,
      auto_detect_interface: true
    }
  };
}

/**
 * 从 ini + 代理节点生成 Surge 配置文本
 */
export function buildSurgeConfigFromIni(proxies, ini) {
  const proxyNames = proxies.map(p => p.tag).filter(Boolean);

  const lines = [];
  lines.push('[General]');
  lines.push('allow-wifi-access = false');
  lines.push('http-listen = 127.0.0.1:6152');
  lines.push('socks5-listen = 127.0.0.1:6153');
  lines.push('mode = rule');
  lines.push('log-level = info');
  lines.push('');
  lines.push('[Replica]');
  lines.push('hide-apple-request = true');
  lines.push('hide-crashlytics-request = true');
  lines.push('');
  lines.push('[Proxy]');
  lines.push('DIRECT = direct');
  lines.push('REJECT = reject');
  for (const proxy of proxies) {
    lines.push(convertProxyToSurge(proxy));
  }
  lines.push('');
  lines.push('[Proxy Group]');
  for (const group of ini.proxyGroups) {
    const expandedProxies = [];
    for (const p of group.proxies) {
      if (p === '__ALL__') expandedProxies.push(...proxyNames);
      else expandedProxies.push(p);
    }
    const unique = [...new Set(expandedProxies)];
    let suffix = '';
    if (group.type === 'url-test' || group.type === 'fallback') {
      suffix = `, url=${group.testUrl}, interval=${group.interval}, tolerance=${group.tolerance}`;
    }
    lines.push(`${group.name} = ${group.type}, ${unique.join(', ')}${suffix}`);
  }
  lines.push('');
  lines.push('[Rule]');
  for (const rule of ini.rules) {
    lines.push(rule);
  }
  return lines.join('\n');
}

function convertProxyToSurge(proxy) {
  const tag = proxy.tag || 'Proxy';
  switch (proxy.type) {
    case 'vless': {
      let s = `${tag} = vless, ${proxy.server}, ${proxy.server_port}, username=${proxy.uuid}`;
      if (proxy.tls?.enabled) {
        s += ', tls=true';
        if (proxy.tls.server_name) s += `, sni=${proxy.tls.server_name}`;
        if (proxy.tls.reality?.public_key) s += `, reality=true, public-key=${proxy.tls.reality.public_key}, short-id=${proxy.tls.reality.short_id}`;
      }
      if (proxy.flow) s += `, flow=${proxy.flow}`;
      return s;
    }
    case 'vmess': {
      let s = `${tag} = vmess, ${proxy.server}, ${proxy.server_port}, username=${proxy.uuid}`;
      if (proxy.tls?.enabled && proxy.tls.server_name) s += `, sni=${proxy.tls.server_name}`;
      if (proxy.alter_id !== undefined) s += `, vmess-aead=${proxy.alter_id === 0}`;
      return s;
    }
    case 'shadowsocks': {
      return `${tag} = ss, ${proxy.server}, ${proxy.server_port}, encrypt-method=${proxy.method}, password=${proxy.password}`;
    }
    case 'trojan': {
      let s = `${tag} = trojan, ${proxy.server}, ${proxy.server_port}, password=${proxy.password}`;
      if (proxy.tls?.server_name) s += `, sni=${proxy.tls.server_name}`;
      return s;
    }
    case 'hysteria2': {
      let s = `${tag} = hysteria2, ${proxy.server}, ${proxy.server_port}, password=${proxy.password}`;
      if (proxy.tls?.server_name) s += `, sni=${proxy.tls.server_name}`;
      return s;
    }
    case 'tuic': {
      let s = `${tag} = tuic, ${proxy.server}, ${proxy.server_port}, password=${proxy.password}, uuid=${proxy.uuid}`;
      if (proxy.tls?.server_name) s += `, sni=${proxy.tls.server_name}`;
      return s;
    }
    default:
      return `# ${tag} = unsupported(${proxy.type})`;
  }
}
