// 订阅转换 Worker - 支持自定义订阅和规则 URL

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

async function handleRequest(request) {
  const url = new URL(request.url);
  
  // 处理 /sub 路由
  if (url.pathname === '/sub') {
    return await handleSubscription(url);
  }
  
  // 首页显示配置界面
  if (url.pathname === '/') {
    return new Response(getConfigHTML(), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }
  
  return new Response('404 Not Found', { status: 404 });
}

async function handleSubscription(url) {
  try {
    const target = url.searchParams.get('target') || 'clash';
    const subscriptionUrl = url.searchParams.get('url');
    const configUrl = url.searchParams.get('config');
    const backend = url.searchParams.get('backend') || 'https://api.v1.mk';
    
    if (!subscriptionUrl) {
      return new Response('错误：缺少 url 参数', { status: 400 });
    }
    
    if (!configUrl) {
      return new Response('错误：缺少 config 参数', { status: 400 });
    }
    
    // 构建转换请求
    const convertUrl = new URL(`${backend}/sub`);
    convertUrl.searchParams.set('target', target);
    convertUrl.searchParams.set('url', subscriptionUrl);
    convertUrl.searchParams.set('config', configUrl);
    convertUrl.searchParams.set('emoji', 'true');
    convertUrl.searchParams.set('list', 'false');
    convertUrl.searchParams.set('tfo', 'false');
    convertUrl.searchParams.set('scv', 'true');
    convertUrl.searchParams.set('fdn', 'false');
    convertUrl.searchParams.set('sort', 'false');
    
    const response = await fetch(convertUrl.toString());
    
    if (!response.ok) {
      return new Response(`转换失败: ${response.status}`, { status: response.status });
    }
    
    const content = await response.text();
    
    return new Response(content, {
      headers: {
        'Content-Type': target === 'clash' ? 'text/yaml; charset=utf-8' : 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="config.${target === 'clash' ? 'yaml' : 'conf'}"`,
        'Access-Control-Allow-Origin': '*'
      }
    });
    
  } catch (error) {
    return new Response(`错误: ${error.message}`, { status: 500 });
  }
}

function getConfigHTML() {
  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>订阅转换 - 自定义配置</title>
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
        .row {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
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
            box-shadow: 0 8px 20px rgba(16, 185, 129, 0.4);
        }
        .btn-shorten {
            background: #8b5cf6;
            color: white;
        }
        .btn-shorten:hover {
            background: #7c3aed;
            transform: translateY(-2px);
            box-shadow: 0 8px 20px rgba(139, 92, 246, 0.4);
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
        <p class="subtitle">支持自定义订阅链接和 ACL4SSR 规则</p>
        
        <div class="form-group">
            <label>订阅链接 *</label>
            <textarea id="subscriptionUrl" placeholder="多个订阅链接或节点请每行一条，支持手动使用 | 分割多链接或节点"></textarea>
        </div>

        <div class="preset-rules">
            <h3>📋 预设规则（点击选择）</h3>
            <div class="preset-item" data-url="https://raw.githubusercontent.com/6547709/ACL4SSR/master/Clash/config/ACL4SSR_Online_Full_Google_XQ.ini">
                <span class="preset-name">ACL4SSR Google-XQ</span>
                <span class="preset-url">完整 Google 规则（推荐）</span>
            </div>
            <div class="preset-item" data-url="https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/config/ACL4SSR_Online_Full.ini">
                <span class="preset-name">ACL4SSR 完整规则</span>
                <span class="preset-url">标准完整规则</span>
            </div>
            <div class="preset-item" data-url="https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/config/ACL4SSR_Online.ini">
                <span class="preset-name">ACL4SSR 标准规则</span>
                <span class="preset-url">标准在线规则</span>
            </div>
            <div class="preset-item" data-url="https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/config/ACL4SSR_Online_Mini.ini">
                <span class="preset-name">ACL4SSR 精简规则</span>
                <span class="preset-url">精简版规则</span>
            </div>
        </div>

        <div class="form-group">
            <label>自定义规则地址（可选）</label>
            <input type="text" id="customRuleUrl" placeholder="留空则使用上面选中的预设规则">
        </div>

        <div class="row">
            <div class="form-group">
                <label>客户端</label>
                <select id="target">
                    <option value="clash">Clash</option>
                    <option value="surge">Surge</option>
                    <option value="singbox">Singbox</option>
                </select>
            </div>
            <div class="form-group">
                <label>后端服务</label>
                <input type="text" id="backend" value="https://api.v1.mk">
            </div>
        </div>

        <div class="button-group">
            <button class="btn-convert" onclick="convert()">转换</button>
            <button class="btn-shorten" onclick="generateShortLink()">生成短链</button>
        </div>

        <div class="result" id="result">
            <strong>✅ 转换链接：</strong>
            <div class="result-url" id="resultUrl"></div>
            <button class="copy-btn" onclick="copyResult()">📋 复制链接</button>
        </div>
    </div>

    <script>
        let selectedRuleUrl = 'https://raw.githubusercontent.com/6547709/ACL4SSR/master/Clash/config/ACL4SSR_Online_Full_Google_XQ.ini';

        // 预设规则选择
        document.querySelectorAll('.preset-item').forEach(item => {
            item.addEventListener('click', function() {
                document.querySelectorAll('.preset-item').forEach(i => i.classList.remove('active'));
                this.classList.add('active');
                selectedRuleUrl = this.dataset.url;
                document.getElementById('customRuleUrl').value = '';
            });
        });

        // 默认选中第一个
        document.querySelector('.preset-item').classList.add('active');

        function convert() {
            const subscriptionUrl = document.getElementById('subscriptionUrl').value.trim();
            const customRuleUrl = document.getElementById('customRuleUrl').value.trim();
            const target = document.getElementById('target').value;
            const backend = document.getElementById('backend').value.trim();

            if (!subscriptionUrl) {
                alert('请输入订阅链接');
                return;
            }

            const ruleUrl = customRuleUrl || selectedRuleUrl;
            
            const url = new URL(window.location.origin + '/sub');
            url.searchParams.set('target', target);
            url.searchParams.set('url', subscriptionUrl);
            url.searchParams.set('config', ruleUrl);
            if (backend && backend !== 'https://api.v1.mk') {
                url.searchParams.set('backend', backend);
            }

            const resultUrl = url.toString();
            document.getElementById('resultUrl').textContent = resultUrl;
            document.getElementById('result').classList.add('show');

            // 自动打开链接
            window.open(resultUrl, '_blank');
        }

        function generateShortLink() {
            alert('短链功能需要额外配置 KV 存储，暂未实现');
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
