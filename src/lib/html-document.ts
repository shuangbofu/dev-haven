// Executable HTML exclusively for an opaque-origin sandboxed iframe, never innerHTML.
export function safeHTMLDocument(content: string, dark: boolean) {
  const document = new DOMParser().parseFromString(content, 'text/html');
  // Keep scripts, event handlers and controls. CSP and sandbox enforce isolation.
  document.querySelectorAll('base, meta[http-equiv], iframe, frame, frameset, object, embed, link, script[src]').forEach(node => node.remove());
  const policy = document.createElement('meta');
  policy.httpEquiv = 'Content-Security-Policy';
  policy.content = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
  document.head.prepend(policy);
  const style = document.createElement('style');
  style.textContent = `:root{color-scheme:${dark ? 'dark' : 'light'}}body{margin:24px;color:${dark ? '#e4e4e7' : '#27272a'};background:${dark ? '#09090b' : '#fff'};font:14px/1.8 system-ui,sans-serif;overflow-wrap:anywhere}img{max-width:100%}pre{overflow:auto}*{box-sizing:border-box;scrollbar-gutter:stable;scrollbar-width:thin;scrollbar-color:#a1a1aa55 transparent}`;
  // Authored styles follow the defaults so document layouts retain their appearance.
  policy.after(style);
  const navigation = document.createElement('script');
  // A srcdoc fragment URL otherwise resolves against the parent application's URL.
  // Cancel browser navigation without stopping document click/submit handlers.
  navigation.textContent = `document.addEventListener('click',event=>{
    const link=event.target instanceof Element?event.target.closest('a[href],area[href]'):null;
    if(!link||event.defaultPrevented)return;
    const href=link.getAttribute('href');event.preventDefault();
    if(href&&href.startsWith('#')){let id=href.slice(1);try{id=decodeURIComponent(id)}catch{}
      const target=document.getElementById(id)||document.getElementsByName(id)[0];
      if(target)target.scrollIntoView();else if(!id)window.scrollTo(0,0);
    }
  });document.addEventListener('submit',event=>event.preventDefault());`;
  style.after(navigation);
  return `<!doctype html>${document.documentElement.outerHTML}`;
}
