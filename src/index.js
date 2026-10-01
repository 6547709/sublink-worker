// 订阅转换 Worker - 本地转换实现
// 支持 ACL4SSR ini URL 模式（preset 模式暂未实现）

import yaml from 'js-yaml';
import { ProxyParser } from './ProxyParsers.js';
import { PREDEFINED_RULE_SETS, UNIFIED_RULES } from './config.js';
import { fetchAndParseIni, buildClashConfigFromIni } from './IniParser.js';
import { parseClashYaml } from './ClashYamlParser.js';

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

async function handleRequest(request) {
  const url = new URL(request.url);

  if (url.pathname === '/sub') {
    return await handleSubscription(url);
  }

  if (url.pathname === '/') {
    return new Response(getConfigHTML(), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }

  return new Response('404 Not Found', { status: 404 });
}

/**
 * 核心订阅转换路由
 * 支持：
 *   - target=clash（当前唯一支持的目标）
 *   - url=订阅链接（必需）
 *   - config=ACL4SSR ini URL（必需）
 *   - lang=zh-CN|en-US|fa-IR|ru-RU
 *   - userAgent=HTTP User-Agent（默认 clash.meta）
 */
async function handleSubscription(url) {
  try {
    const target = url.searchParams.get('target') || 'clash';
    const subscriptionUrl = url.searchParams.get('url');
    const configUrl = url.searchParams.get('config');
    const lang = url.searchParams.get('lang') || 'zh-CN';
    const userAgent = url.searchParams.get('userAgent') || 'clash.meta';

    if (!subscriptionUrl) {
      return new Response('错误：缺少 url 参数', { status: 400 });
    }
    if (!configUrl) {
      return new Response('错误：缺少 config 参数', { status: 400 });
    }
    if (target !== 'clash') {
      return new Response(`错误：当前仅支持 target=clash`, { status: 400 });
    }

    // 1. 拉取订阅内容
    const resp = await fetch(subscriptionUrl, {
      headers: { 'User-Agent': userAgent }
    });
    if (!resp.ok) {
      return new Response(`错误：拉取订阅失败 ${resp.status}`, { status: 502 });
    }
    const contentType = (resp.headers.get('content-type') || '').toLowerCase();
    const text = await resp.text();

    // 2. 判断输入格式并解析为内部 proxy 对象数组
    const trimmed = text.trim();
    let proxies;
    const isYaml = contentType.includes('yaml')
      || trimmed.startsWith('proxies:')
      || trimmed.startsWith('mixed-port:')
      || /^port:\s*\d/m.test(trimmed)
      || /^-\s*name:/m.test(trimmed);
    if (isYaml) {
      // Clash YAML 格式
      proxies = parseClashYaml(text);
    } else {
      // base64 或 URI 列表
      const lines = await ProxyParser.parse(subscriptionUrl, userAgent);
      if (!Array.isArray(lines) || lines.length === 0) {
        return new Response('错误：订阅解析失败或为空', { status: 400 });
      }
      proxies = await parseAllProxies(lines, userAgent);
    }

    if (!proxies || proxies.length === 0) {
      return new Response('错误：未解析到任何代理节点', { status: 400 });
    }

    // 3. 判断 config 模式
    const isPreset = !!PREDEFINED_RULE_SETS[configUrl];

    let configObject;
    if (isPreset) {
      // preset 模式：用 UNIFIED_RULES 构建（轻量版）
      configObject = buildClashConfigFromPreset(proxies, configUrl);
    } else {
      // ini URL 模式：本地解析 ACL4SSR ini
      const ini = await fetchAndParseIni(configUrl, userAgent);
      configObject = buildClashConfigFromIni(proxies, ini);
    }

    // 4. 序列化为 YAML
    const output = yaml.dump(configObject, {
      lineWidth: -1,
      noRefs: true,
      sortKeys: false
    });

    return new Response(output, {
      headers: {
        'Content-Type': 'text/yaml; charset=utf-8',
        'Content-Disposition': `attachment; filename="config.yaml"`,
        'Access-Control-Allow-Origin': '*'
      }
    });

  } catch (error) {
    return new Response(`错误: ${error.message}`, { status: 500 });
  }
}

/**
 * 解析订阅里的所有代理 URI
 */
async function parseAllProxies(lines, userAgent) {
  const proxies = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const result = await ProxyParser.parse(trimmed, userAgent);
      if (Array.isArray(result)) {
        for (const sub of result) {
          const p = await ProxyParser.parse(sub.trim(), userAgent);
          if (p && !Array.isArray(p)) proxies.push(p);
        }
      } else if (result) {
        proxies.push(result);
      }
    } catch (e) {
      continue;
    }
  }
  return proxies;
}

/**
 * 用 UNIFIED_RULES（preset 模式）构建 Clash 配置
 */
function buildClashConfigFromPreset(proxies, presetKey) {
  const ruleNames = PREDEFINED_RULE_SETS[presetKey] || PREDEFINED_RULE_SETS.minimal;
  const proxyList = proxies.map(p => p.tag).filter(Boolean);

  const proxyGroups = [];
  proxyGroups.push({
    name: '🚀 节点选择',
    type: 'select',
    proxies: ['DIRECT', 'REJECT', ...proxyList]
  });
  for (const ruleName of ruleNames) {
    if (ruleName === 'Location:CN' || ruleName === 'Private' || ruleName === 'Non-China') {
      continue;  // 跳过内置特殊组，下面单独处理
    }
    proxyGroups.push({
      name: ruleName,
      type: 'select',
      proxies: ['🚀 节点选择', ...proxyList]
    });
  }

  const ruleProviders = {};
  const rules = [];

  for (const rule of UNIFIED_RULES) {
    if (!ruleNames.includes(rule.name)) continue;
    rule.site_rules.forEach(site => {
      const name = `provider-${site}`;
      ruleProviders[name] = {
        type: 'http',
        behavior: 'classical',
        url: `https://gh-proxy.com/https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/${site}.mrs`,
        path: `./ruleset/${site}.mrs`,
        interval: 86400
      };
      rules.push(`RULE-SET,${name},${rule.name}`);
    });
    rule.ip_rules.forEach(ip => {
      const name = `provider-${ip}`;
      ruleProviders[name] = {
        type: 'http',
        behavior: 'classical',
        url: `https://gh-proxy.com/https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geoip/${ip}.mrs`,
        path: `./ruleset/${ip}.mrs`,
        interval: 86400
      };
      rules.push(`RULE-SET,${name},${rule.name}`);
    });
  }

  rules.push('MATCH,🚀 节点选择');

  return {
    'port': 7890,
    'socks-port': 7891,
    'allow-lan': false,
    'mode': 'rule',
    'log-level': 'info',
    'geodata-mode': true,
    'geo-auto-update': true,
    'geodata-loader': 'standard',
    'dns': {
      'enable': true,
      'ipv6': true,
      'enhanced-mode': 'fake-ip',
      'nameserver': [
        'https://120.53.53.53/dns-query',
        'https://223.5.5.5/dns-query'
      ]
    },
    'proxies': proxies,
    'proxy-groups': proxyGroups,
    'rule-providers': ruleProviders,
    'rules': rules
  };
}

function getConfigHTML() {
  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>订阅转换 - 本地转换版</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .container {
            background: white;
            border-radius: 16px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            padding: 40px;
            max-width: 900px;
            width: 100%;
        }
        h1 {
            color: #333;
            margin-bottom: 10px;
            font-size: 28px;
        }
        .subtitle {
            color: #666;
            margin-bottom: 30px;
            font-size: 14px;
        }
        .form-group {
            margin-bottom: 24px;
        }
        label {
            display: block;
            margin-bottom: 8px;
            color: #333;
            font-weight: 500;
            font-size: 14px;
        }
        input, select, textarea {
            width: 100%;
            padding: 12px;
            border: 2px solid #e0e0e0;
            border-radius: 8px;
            font-size: 14px;
            transition: border-color 0.3s;
            font-family: inherit;
        }
        input:focus, select:focus, textarea:focus {
            outline: none;
            border-color: #667eea;
        }
        textarea {
            resize: vertical;
            min-height: 100px;
            font-family: 'Monaco', 'Courier New', monospace;
        }
        .preset-rules {
            background: #f8f9fa;
            border-radius: 8px;
            padding: 16px;
            margin-bottom: 20px;
        }
        .preset-rules h3 {
            font-size: 16px;
            color: #333;
            margin-bottom: 12px;
        }
        .preset-item {
            background: white;
            padding: 10px 12px;
            border-radius: 6px;
            margin-bottom: 8px;
            cursor: pointer;
            transition: all 0.3s;
            border: 2px solid transparent;
            font-size: 13px;
        }
        .preset-item:hover {
            border-color: #667eea;
            transform: translateX(4px);
        }
        .preset-item.active {
            background: #667eea;
            color: white;
        }
        .preset-name {
            font-weight: 600;
            display: block;
            margin-bottom: 4px;
        }
        .preset-url {
            font-size: 11px;
            opacity: 0.7;
            word-break: break-all;
        }
        .button-group {
            display: flex;
            gap: 12px;
            margin-top: 30px;
        }
        button {
            flex: 1;
            padding: 14px 24px;
            border: none;
            border-radius: 8px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s;
        }
        .btn-convert {
            background: #10b981;
            color: white;
        }
        .btn-convert:hover {
            background: #059669;
            transform: translateY(-2px);
            box-shadow: 0 8px 20px rgba(0, 0, 0, 0.15);
        }
        .info {
            margin-top: 20px;
            padding: 12px 16px;
            background: #eff6ff;
            border-left: 4px solid #3b82f6;
            border-radius: 4px;
            font-size: 13px;
            color: #1e40af;
        }
        .result {
            margin-top: 24px;
            padding: 16px;
            background: #f0fdf4;
            border: 2px solid #10b981;
            border-radius: 8px;
            display: none;
        }
        .result.show { display: block; }
        .result-url {
            word-break: break-all;
            background: white;
            padding: 12px;
            border-radius: 6px;
            margin-top: 8px;
            font-family: 'Monaco', 'Courier New', monospace;
            font-size: 13px;
        }
        .copy-btn {
            margin-top: 12px;
            padding: 8px 16px;
            background: #10b981;
            color: white;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
        }
        .copy-btn:hover {
            background: #059669;
        }
        @media (max-width: 768px) {
            .row { grid-template-columns: 1fr; }
            .button-group { flex-direction: column; }
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🚀 订阅转换服务</h1>
        <p class="subtitle">本地转换 · 不依赖第三方后端 · server 字段原样保留</p>

        <div class="info">
            ✨ 当前版本使用本地解析引擎，代理节点的 IP/域名 <b>原样保留</b>，不会被替换为 Cloudflare 等 CDN IP。
        </div>

        <div class="form-group">
            <label>订阅链接 *</label>
            <textarea id="subscriptionUrl" placeholder="多个订阅链接或节点请每行一条，支持手动使用 | 分割多链接或节点"></textarea>
        </div>

        <div class="form-group">
            <label>ACL4SSR ini 配置 URL</label>
            <input type="text" id="configInput" placeholder="ACL4SSR ini 文件的 URL">
            <div class="preset-rules">
                <h3>📋 常用配置</h3>
                <div class="preset-item" data-config="https://raw.githubusercontent.com/6547709/ACL4SSR/master/Clash/config/ACL4SSR_Online_Full_Google_XQ.ini">
                    <span class="preset-name">ACL4SSR Google-XQ</span>
                    <span class="preset-url">完整 Google 规则</span>
                </div>
                <div class="preset-item" data-config="https://raw.githubusercontent.com/6547709/ACL4SSR/master/Clash/config/ACL4SSR_Online_Full_Google_VPS.ini">
                    <span class="preset-name">ACL4SSR Google-VPS</span>
                    <span class="preset-url">完整 Google 规则（VPS 版）</span>
                </div>
            </div>
        </div>

        <div class="button-group">
            <button class="btn-convert" onclick="convert()">转换</button>
        </div>

        <div class="result" id="result">
            <strong>✅ 转换链接：</strong>
            <div class="result-url" id="resultUrl"></div>
            <button class="copy-btn" onclick="copyResult()">📋 复制链接</button>
        </div>
    </div>

    <script>
        let selectedConfig = 'https://raw.githubusercontent.com/6547709/ACL4SSR/master/Clash/config/ACL4SSR_Online_Full_Google_XQ.ini';

        document.querySelectorAll('.preset-item').forEach(item => {
            item.addEventListener('click', function() {
                document.querySelectorAll('.preset-item').forEach(i => i.classList.remove('active'));
                this.classList.add('active');
                selectedConfig = this.dataset.config;
                document.getElementById('configInput').value = '';
            });
        });

        document.querySelector('.preset-item').classList.add('active');

        function convert() {
            const subscriptionUrl = document.getElementById('subscriptionUrl').value.trim();
            const configInput = document.getElementById('configInput').value.trim();

            if (!subscriptionUrl) {
                alert('请输入订阅链接');
                return;
            }

            const config = configInput || selectedConfig;

            const url = new URL(window.location.origin + '/sub');
            url.searchParams.set('target', 'clash');
            url.searchParams.set('url', subscriptionUrl);
            url.searchParams.set('config', config);

            const resultUrl = url.toString();
            document.getElementById('resultUrl').textContent = resultUrl;
            document.getElementById('result').classList.add('show');

            window.open(resultUrl, '_blank');
        }

        function copyResult() {
            const resultUrl = document.getElementById('resultUrl').textContent;
            navigator.clipboard.writeText(resultUrl).then(() => {
                alert('✅ 链接已复制到剪贴板');
            }).catch(() => {
                alert('❌ 复制失败，请手动复制');
            });
        }
    </script>
</body>
</html>
  `;
}
