import { SingboxConfigBuilder } from './SingboxConfigBuilder.js';
import { generateHtml } from './htmlBuilder.js';
import { ClashConfigBuilder } from './ClashConfigBuilder.js';
import { SurgeConfigBuilder } from './SurgeConfigBuilder.js';
import { decodeBase64, encodeBase64, GenerateWebPath } from './utils.js';
import { PREDEFINED_RULE_SETS, ACL4SSR_RULES } from './config.js';
import { t, setLanguage } from './i18n/index.js';
import yaml from 'js-yaml';

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

async function handleRequest(request) {
  try {
    const url = new URL(request.url);
    const lang = url.searchParams.get('lang');
    setLanguage(lang || request.headers.get('accept-language')?.split(',')[0]);
    
    if (request.method === 'GET' && url.pathname === '/') {
      return new Response(generateHtml('', '', '', '', url.origin), {
        headers: { 'Content-Type': 'text/html' }
      });
    } 
    // 新增：ACL4SSR 外部转换路由
    else if (url.pathname === '/acl4ssr') {
      return await handleACL4SSRConversion(url);
    }
    else if (url.pathname.startsWith('/singbox') || url.pathname.startsWith('/clash') || url.pathname.startsWith('/surge')) {
      const inputString = url.searchParams.get('config');
      let selectedRules = url.searchParams.get('selectedRules');
      let customRules = url.searchParams.get('customRules');
      let lang = url.searchParams.get('lang') || 'zh-CN';
      let userAgent = url.searchParams.get('ua');
      if (!userAgent) {
        userAgent = 'curl/7.74.0';
      }

      if (!inputString) {
        return new Response(t('missingConfig'), { status: 400 });
      }

      if (PREDEFINED_RULE_SETS[selectedRules]) {
        selectedRules = PREDEFINED_RULE_SETS[selectedRules];
      } else {
        try {
          selectedRules = JSON.parse(decodeURIComponent(selectedRules));
        } catch (error) {
          console.error('Error parsing selectedRules:', error);
          selectedRules = PREDEFINED_RULE_SETS.minimal;
        }
      }

      try {
        customRules = JSON.parse(decodeURIComponent(customRules));
      } catch (error) {
        console.error('Error parsing customRules:', error);
        customRules = [];
      }

      const configId = url.searchParams.get('configId');
      let baseConfig;
      if (configId) {
        const customConfig = await SUBLINK_KV.get(configId);
        if (customConfig) {
          baseConfig = JSON.parse(customConfig);
        }
      }

      let configBuilder;
      if (url.pathname.startsWith('/singbox')) {
        configBuilder = new SingboxConfigBuilder(inputString, selectedRules, customRules, baseConfig, lang, userAgent);
      } else if (url.pathname.startsWith('/clash')) {
        configBuilder = new ClashConfigBuilder(inputString, selectedRules, customRules, baseConfig, lang, userAgent);
      } else {
        configBuilder = new SurgeConfigBuilder(inputString, selectedRules, customRules, baseConfig, lang, userAgent)
          .setSubscriptionUrl(url.href);
      }

      const config = await configBuilder.build();

      const headers = {
        'content-type': url.pathname.startsWith('/singbox')
          ? 'application/json; charset=utf-8'
          : url.pathname.startsWith('/clash')
            ? 'text/yaml; charset=utf-8'
            : 'text/plain; charset=utf-8'
      };

      if (url.pathname.startsWith('/surge')) {
        headers['subscription-userinfo'] = 'upload=0; download=0; total=10737418240; expire=2546249531';
      }

      return new Response(
        url.pathname.startsWith('/singbox') ? JSON.stringify(config, null, 2) : config,
        { headers }
      );

    } else if (url.pathname === '/shorten') {
      const originalUrl = url.searchParams.get('url');
      if (!originalUrl) {
        return new Response(t('missingUrl'), { status: 400 });
      }

      const shortCode = GenerateWebPath();
      await SUBLINK_KV.put(shortCode, originalUrl);

      const shortUrl = `${url.origin}/s/${shortCode}`;
      return new Response(JSON.stringify({ shortUrl }), {
        headers: { 'Content-Type': 'application/json' }
      });

    } else if (url.pathname === '/shorten-v2') {
      const originalUrl = url.searchParams.get('url');
      let shortCode = url.searchParams.get('shortCode');

      if (!originalUrl) {
        return new Response('Missing URL parameter', { status: 400 });
      }

      const parsedUrl = new URL(originalUrl);
      const queryString = parsedUrl.search;

      if (!shortCode) {
        shortCode = GenerateWebPath();
      }

      await SUBLINK_KV.put(shortCode, queryString);

      return new Response(shortCode, {
        headers: { 'Content-Type': 'text/plain' }
      });

    } else if (url.pathname.startsWith('/b/') || url.pathname.startsWith('/c/') || url.pathname.startsWith('/x/') || url.pathname.startsWith('/s/')) {
      const shortCode = url.pathname.split('/')[2];
      const originalParam = await SUBLINK_KV.get(shortCode);
      let originalUrl;

      if (url.pathname.startsWith('/b/')) {
        originalUrl = `${url.origin}/singbox${originalParam}`;
      } else if (url.pathname.startsWith('/c/')) {
        originalUrl = `${url.origin}/clash${originalParam}`;
      } else if (url.pathname.startsWith('/x/')) {
        originalUrl = `${url.origin}/xray${originalParam}`;
      } else if (url.pathname.startsWith('/s/')) {
        originalUrl = `${url.origin}/surge${originalParam}`;
      }

      if (originalUrl === null) {
        return new Response(t('shortUrlNotFound'), { status: 404 });
      }

      return Response.redirect(originalUrl, 302);
    } else if (url.pathname.startsWith('/xray')) {
      const inputString = url.searchParams.get('config');
      const proxylist = inputString.split('\n');

      const finalProxyList = [];
      let userAgent = url.searchParams.get('ua');
      if (!userAgent) {
        userAgent = 'curl/7.74.0';
      }
      let headers = new Headers({
        "User-Agent"   : userAgent
      });

      for (const proxy of proxylist) {
        if (proxy.startsWith('http://') || proxy.startsWith('https://')) {
          try {
            const response = await fetch(proxy, {
              method : 'GET',
              headers : headers
            })
            const text = await response.text();
            let decodedText;
            decodedText = decodeBase64(text.trim());
            if (decodedText.includes('%')) {
              decodedText = decodeURIComponent(decodedText);
            }
            finalProxyList.push(...decodedText.split('\n'));
          } catch (e) {
            console.warn('Failed to fetch the proxy:', e);
          }
        } else {
          finalProxyList.push(proxy);
        }
      }

      const finalString = finalProxyList.join('\n');

      if (!finalString) {
        return new Response('Missing config parameter', { status: 400 });
      }

      return new Response(encodeBase64(finalString), {
        headers: { 'content-type': 'application/json; charset=utf-8' }
      });
    } else if (url.pathname === '/favicon.ico') {
      return Response.redirect('https://cravatar.cn/avatar/9240d78bbea4cf05fb04f2b86f22b18d?s=160&d=retro&r=g', 301)
    } else if (url.pathname === '/config') {
      const { type, content } = await request.json();
      const configId = `${type}_${GenerateWebPath(8)}`;

      try {
        let configString;
        if (type === 'clash') {
          if (typeof content === 'string' && (content.trim().startsWith('-') || content.includes(':'))) {
            const yamlConfig = yaml.load(content);
            configString = JSON.stringify(yamlConfig);
          } else {
            configString = typeof content === 'object'
              ? JSON.stringify(content)
              : content;
          }
        } else {
          configString = typeof content === 'object'
            ? JSON.stringify(content)
            : content;
        }

        JSON.parse(configString);

        await SUBLINK_KV.put(configId, configString, {
          expirationTtl: 60 * 60 * 24 * 30
        });

        return new Response(configId, {
          headers: { 'Content-Type': 'text/plain' }
        });
      } catch (error) {
        console.error('Config validation error:', error);
        return new Response(t('invalidFormat') + error.message, {
          status: 400,
          headers: { 'Content-Type': 'text/plain' }
        });
      }
    } else if (url.pathname === '/resolve') {
      const shortUrl = url.searchParams.get('url');
      if (!shortUrl) {
        return new Response(t('missingUrl'), { status: 400 });
      }

      try {
        const urlObj = new URL(shortUrl);
        const pathParts = urlObj.pathname.split('/');
        
        if (pathParts.length < 3) {
          return new Response(t('invalidShortUrl'), { status: 400 });
        }

        const prefix = pathParts[1];
        const shortCode = pathParts[2];

        if (!['b', 'c', 'x', 's'].includes(prefix)) {
          return new Response(t('invalidShortUrl'), { status: 400 });
        }

        const originalParam = await SUBLINK_KV.get(shortCode);
        if (originalParam === null) {
          return new Response(t('shortUrlNotFound'), { status: 404 });
        }

        let originalUrl;
        if (prefix === 'b') {
          originalUrl = `${url.origin}/singbox${originalParam}`;
        } else if (prefix === 'c') {
          originalUrl = `${url.origin}/clash${originalParam}`;
        } else if (prefix === 'x') {
          originalUrl = `${url.origin}/xray${originalParam}`;
        } else if (prefix === 's') {
          originalUrl = `${url.origin}/surge${originalParam}`;
        }

        return new Response(JSON.stringify({ originalUrl }), {
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (error) {
        return new Response(t('invalidShortUrl'), { status: 400 });
      }
    }

    return new Response(t('notFound'), { status: 404 });
  } catch (error) {
    console.error('Error processing request:', error);
    return new Response(t('internalError'), { status: 500 });
  }
}

// 新增：ACL4SSR 转换处理函数
async function handleACL4SSRConversion(url) {
  try {
    const target = url.searchParams.get('target') || 'clash';
    const subscriptionUrl = url.searchParams.get('url');
    const configType = url.searchParams.get('config') || 'acl4ssr_online_full_google';
    const backend = url.searchParams.get('backend') || 'https://api.v1.mk';
    
    // 额外参数
    const emoji = url.searchParams.get('emoji') !== 'false';
    const list = url.searchParams.get('list') === 'true';
    const tfo = url.searchParams.get('tfo') === 'true';
    const scv = url.searchParams.get('scv') !== 'false';
    const fdn = url.searchParams.get('fdn') === 'true';
    const sort = url.searchParams.get('sort') === 'true';
    
    if (!subscriptionUrl) {
      return new Response('缺少订阅链接参数 url', { status: 400 });
    }

    // 获取 ACL4SSR 规则 URL
    let ruleUrl;
    if (configType.startsWith('http://') || configType.startsWith('https://')) {
      ruleUrl = configType;
    } else if (ACL4SSR_RULES[configType]) {
      ruleUrl = ACL4SSR_RULES[configType];
    } else {
      ruleUrl = ACL4SSR_RULES['acl4ssr_online_full_google'];
    }
    
    // 构建转换请求 URL
    const convertUrl = new URL(`${backend}/sub`);
    convertUrl.searchParams.set('target', target);
    convertUrl.searchParams.set('url', subscriptionUrl);
    convertUrl.searchParams.set('config', ruleUrl);
    convertUrl.searchParams.set('emoji', emoji);
    convertUrl.searchParams.set('list', list);
    convertUrl.searchParams.set('tfo', tfo);
    convertUrl.searchParams.set('scv', scv);
    convertUrl.searchParams.set('fdn', fdn);
    convertUrl.searchParams.set('sort', sort);
    
    // 请求转换
    const response = await fetch(convertUrl.toString());
    
    if (!response.ok) {
      throw new Error(`转换失败: ${response.status} ${response.statusText}`);
    }

    const content = await response.text();
    
    const contentType = target === 'clash' ? 'text/yaml; charset=utf-8' 
                      : target === 'surge' ? 'text/plain; charset=utf-8'
                      : 'application/json; charset=utf-8';
    
    return new Response(content, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="config.${target === 'clash' ? 'yaml' : 'conf'}"`,
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*'
      }
    });

  } catch (error) {
    return new Response(`ACL4SSR转换出错: ${error.message}`, { status: 500 });
  }
}
