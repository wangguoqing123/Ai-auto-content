import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';

function parseAllowedUrl(rawUrl) {
  let url;
  try {
    url = new URL(String(rawUrl || '').trim());
  } catch {
    throw new ArgumentError('weixin resolve-article-url received an invalid URL');
  }
  const host = url.hostname.toLocaleLowerCase();
  const isDirectArticle = host === 'mp.weixin.qq.com' && url.pathname === '/s';
  const isSogouRedirect = host === 'weixin.sogou.com' && url.pathname === '/link';
  if (!isDirectArticle && !isSogouRedirect) {
    throw new ArgumentError('weixin resolve-article-url only accepts Sogou Weixin redirects or mp.weixin.qq.com articles');
  }
  return url.toString();
}

cli({
  site: 'weixin',
  name: 'resolve-article-url',
  access: 'read',
  description: 'Resolve a Sogou Weixin search result to its mp.weixin.qq.com article URL',
  domain: 'weixin.sogou.com',
  strategy: Strategy.PUBLIC,
  browser: true,
  args: [{ name: 'url', required: true }],
  columns: ['url'],
  func: async (page, kwargs) => {
    const sourceUrl = parseAllowedUrl(kwargs.url);
    const source = new URL(sourceUrl);
    if (source.hostname.toLocaleLowerCase() === 'mp.weixin.qq.com') return [{ url: sourceUrl }];

    await page.goto(sourceUrl);
    await page.wait(2);
    const result = await page.evaluate(`(function(){
      return {
        url: window.location.href,
        text: (document.body && document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 1000)
      };
    })()`);
    if (/验证码|安全验证|异常访问|环境异常|完成验证后即可继续访问/.test(result?.text || '')) {
      throw new CommandExecutionError(
        'Weixin article URL resolution requires browser verification',
        'Open the page in Chrome and complete the verification before retrying.',
      );
    }
    let resolved;
    try {
      resolved = new URL(String(result?.url || ''));
    } catch {
      throw new CommandExecutionError('Sogou Weixin did not return a valid article URL');
    }
    if (resolved.hostname.toLocaleLowerCase() !== 'mp.weixin.qq.com' || resolved.pathname !== '/s') {
      throw new CommandExecutionError(
        'Sogou Weixin did not resolve to an article page',
        `Resolved host: ${resolved.hostname || 'unknown'}`,
      );
    }
    return [{ url: resolved.toString() }];
  },
});
