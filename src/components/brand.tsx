import brandIcons from '@/shared/brand-icons.json';
import type { ToolId } from '@/shared/catalog';
import { cn } from '@/lib/utils';
const { siNodedotjs, siPython, siOpenjdk, siGo, siRust, siApachemaven, siYarn, siPnpm, siElectron, siApple, siLinux, siGradle, siUv } = brandIcons;
const icons = { node: siNodedotjs, python: siPython, java: siOpenjdk, go: siGo, rust: siRust, maven: siApachemaven, yarn: siYarn, pnpm: siPnpm, electron: siElectron, gradle: siGradle, uv: siUv };
export function BrandLogo({ className }: { className?: string }) {
  return <img className={cn('brand-logo size-9', className)} src="./icon.png" width={36} height={36} alt="DevHaven Logo" draggable={false} />;
}
export function ToolLogo({ id, className, bare = false }: { id: ToolId; className?: string; bare?: boolean }) {
  if (id === 'java' || id === 'maven') return <span className={cn('tool-logo', bare && 'tool-logo-bare', id === 'maven' && 'maven-logo', className)}><img src={`./brands/${id}.svg`} alt={`${id === 'java' ? 'Java' : 'Apache Maven'} Logo`} width={id === 'maven' ? 58 : 26} height={26} /></span>;
  const icon = icons[id]; const color = id === 'rust' ? '#96583b' : `#${icon.hex}`;
  return <span className={cn('tool-logo', id === 'gradle' && 'gradle-logo', bare && 'tool-logo-bare', className)} style={{ color, backgroundColor: bare ? undefined : `${color}0d` }}><svg role="img" aria-label={`${icon.title} Logo`} viewBox="0 0 24 24" fill="currentColor"><path d={icon.path} /></svg></span>;
}
export function PlatformLogo({ platform, className }: { platform: string; className?: string }) {
  const icon = platform === 'darwin' ? siApple : siLinux;
  return <svg className={cn('size-4', className)} viewBox="0 0 24 24" fill="currentColor" role="img" aria-label={platform === 'win32' ? 'Windows' : icon.title}>{platform === 'win32' ? <path d="M1 3.5 10.5 2.2v9.1H1zm11-1.5L23 .5v10.8H12zM1 12.8h9.5v9L1 20.5zm11 0h11v10.7L12 22z" /> : <path d={icon.path} />}</svg>;
}
