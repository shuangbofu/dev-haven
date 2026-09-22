'use client';
import { useEffect, useState } from 'react';
import type { Preferences } from '@/shared/application';
export function applyAppearance(preferences: Preferences) {
  const dark = preferences.theme === 'dark' || preferences.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.dataset.accent = preferences.accent;
  try { localStorage.setItem('devhaven-appearance', JSON.stringify({ theme: preferences.theme, accent: preferences.accent })); } catch { /* The persisted application preference remains authoritative. */ }
  window.dispatchEvent(new Event('devhaven-theme'));
}
export function useResolvedTheme() {
  const [dark, setDark] = useState(() => typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark');
  useEffect(() => {
    const update = () => setDark(document.documentElement.dataset.theme === 'dark'); update();
    window.addEventListener('devhaven-theme', update);
    return () => window.removeEventListener('devhaven-theme', update);
  }, []);
  return dark;
}
