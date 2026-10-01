// 测试 IniParser 解析逻辑
import { parseIni, buildClashConfigFromIni } from '../src/IniParser.js';

const iniText = `;acl4SSR规则
ruleset=🎯 全球直连,https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/LocalAreaNetwork.list
ruleset=🛑 广告拦截,https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/BanAD.list
ruleset=📢 谷歌FCM,[]DOMAIN-SUFFIX,xn--ngstr-lra8j.com
ruleset=🎯 全球直连,[]GEOIP,CN
ruleset=🐟 漏网之鱼,[]FINAL
custom_proxy_group=🚀 节点选择\`select\`(.*)\`[]DIRECT
custom_proxy_group=♻️ 自动选择\`url-test\`(.*)\`http://www.gstatic.com/generate_204\`300,,50
custom_proxy_group=🛑 广告拦截\`select\`[]REJECT\`[]DIRECT
enable_rule_generator=true
overwrite_original_rules=true`;

console.log('=== parseIni ===');
const ini = parseIni(iniText);
console.log('rules:');
ini.rules.forEach(r => console.log('  ', r));
console.log('\nproxyGroups:');
ini.proxyGroups.forEach(g => console.log('  ', JSON.stringify(g)));
console.log('\nruleProviders:');
ini.ruleProviders.forEach(p => console.log('  ', JSON.stringify(p)));

console.log('\n=== buildClashConfigFromIni (with mock proxies) ===');
const mockProxies = [
  { tag: 'dmit-liguoqiang', type: 'vless', server: '179.255.110.14', server_port: 443, uuid: 'test-uuid', tls: { enabled: true, server_name: 'addons.mozilla.org', reality: { public_key: 'pk', short_id: 'sid' } } }
];
const cfg = buildClashConfigFromIni(mockProxies, ini);
console.log('proxy-groups:');
cfg['proxy-groups'].forEach(g => console.log('  ', JSON.stringify(g)));
console.log('\nrule-providers:', Object.keys(cfg['rule-providers']));
console.log('\nrules count:', cfg.rules.length);
