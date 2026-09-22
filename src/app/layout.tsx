import type { Metadata } from 'next';
import '@fontsource-variable/noto-sans-sc';
import './globals.css';
import './library.css';
import './markdown.css';
import './memory.css';
import './toolbar.css';
import './search.css';
export const metadata: Metadata = { title: 'DevHaven', description: '开发环境版本管理', icons: { icon: './icon.png' } };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="zh-CN" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: `(function(){try{var p=JSON.parse(localStorage.getItem('devhaven-appearance')||'{}');document.documentElement.dataset.theme=p.theme==='dark'||p.theme!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.dataset.accent=['blue','violet','teal','amber','rose','neutral'].includes(p.accent)?p.accent:'blue'}catch(e){}})()` }} /></head><body>{children}</body></html>; }
