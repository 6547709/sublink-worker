// 简单的订阅转换 Worker - 支持自定义 ACL4SSR 规则

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

async function handleRequest(request) {
  const url = new URL(request.url);
  
  // 处理 /sub 路由
  if (url.pathname === '/sub') {
    return await handleSubscription(url);
  }
  
  // 首页显示使用说明
  if (url.pathname === '/') {
    return new Response(getUsageHTML(), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }
  
  return new Response('404 Not Found', { status: 404 });
}

async function handleSubscription(url) {
  try {
    // 获取参数
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
    
    // 请求转换
    const response = await fetch(convertUrl.toString());
    
    if (!response.ok) {
      return new Response(`转换失败: ${response.status}`, { status: response.status });
    }
    
    const content = await response.text();
    
    // 返回结果
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

function getUsageHTML() {
  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>订阅转换 - ACL4SSR 规则</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            max-width: 900px;
            margin: 50px auto;
            padding: 20px;
            line-height: 1.6;
            background: #f5f5f5;
        }
        .container {
            background: white;
            padding: 30px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        h1 { color: #333; margin-bottom: 10px; }
        h2 { color: #555; margin-top: 30px; border-bottom: 2px solid #007bff; padding-bottom: 10px; }
        code {
            background: #f4f4f4;
            padding: 2px 6px;
            border-radius: 3px;
            font-family: 'Monaco', 'Courier New', monospace;
            color: #c7254e;
        }
        .example {
            background: #f8f9fa;
            padding: 15px;
            border-radius: 5px;
            margin: 15px 0;
            border-left: 4px solid #007bff;
            overflow-x: auto;
        }
        .example code {
            background: transparent;
            color: #333;
            word-break: break-all;
        }
        .note {
            background: #fff3cd;
            border-left: 4px solid #ffc107;
            padding: 15px;
            margin: 15px 0;
            border-radius: 4px;
        }
        ul { padding-left: 25px; }
        li { margin: 8px 0; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🚀 订阅转换服务</h1>
        <p>支持自定义 ACL4SSR 规则的订阅转换</p>
        
        <h2>📖 使用方法</h2>
        <p>访问 <code>/sub</code> 路径，并传入以下参数：</p>
        
        <h3>必需参数：</h3>
        <ul>
            <li><code>url</code> - 你的订阅链接（需要 URL 编码）</li>
            <li><code>config</code> - ACL4SSR 规则文件的 URL（需要 URL 编码）</li>
        </ul>
        
        <h3>可选参数：</h3>
        <ul>
            <li><code>target</code> - 目标格式：clash, surge, singbox（默认：clash）</li>
            <li><code>backend</code> - 转换后端 API（默认：https://api.v1.mk）</li>
        </ul>

        <h2>💡 使用示例</h2>
        
        <div class="example">
            <strong>基本用法：</strong><br>
            <code>https://your-worker.workers.dev/sub?target=clash&url=你的订阅链接&config=https://规则文件URL</code>
        </div>

        <div class="example">
            <strong>完整示例（使用 ACL4SSR_Online_Full_Google_XQ）：</strong><br>
            <code>https://your-worker.workers.dev/sub?target=clash&url=https%3A%2F%2Fsub.ssr.sh%2Flink%2FGjgUUvREWgSPsXRX%3Fclash%3D2&config=https%3A%2F%2Fraw.githubusercontent.com%2F6547709%2FACL4SSR%2Fmaster%2FClash%2Fconfig%2FACL4SSR_Online_Full_Google_XQ.ini</code>
        </div>

        <h2>📋 常用 ACL4SSR 规则</h2>
        <div class="example">
            <strong>标准完整规则：</strong><br>
            <code>https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/config/ACL4SSR_Online_Full.ini</code>
        </div>
        
        <div class="example">
            <strong>完整 Google 规则：</strong><br>
            <code>https://raw.githubusercontent.com/6547709/ACL4SSR/master/Clash/config/ACL4SSR_Online_Full_Google_XQ.ini</code>
        </div>
        
        <div class="example">
            <strong>精简规则：</strong><br>
            <code>https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/config/ACL4SSR_Online_Mini.ini</code>
        </div>

        <div class="note">
            <strong>⚠️ 注意事项：</strong>
            <ul style="margin: 10px 0 0 0;">
                <li>订阅链接和规则 URL 都需要进行 URL 编码</li>
                <li>可以使用任何在线的 .ini 规则文件</li>
                <li>支持 Clash、Surge、Singbox 等多种格式</li>
            </ul>
        </div>

        <h2>🔗 URL 编码工具</h2>
        <p>在浏览器控制台使用：<code>encodeURIComponent('你的URL')</code></p>
    </div>
</body>
</html>
  `;
}
