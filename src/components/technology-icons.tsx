'use client';

import { createContext, useContext } from 'react';
import { findIcon, type LocalIcon } from '@/shared/technology-icons';

export const TechnologyIcons = createContext<LocalIcon[]>([]);
export const useTechnologyIcons = () => useContext(TechnologyIcons);
export function LanguageLogo({ language }: { language: string }) {
  const icon = findIcon(useTechnologyIcons(), language);
  return <span className="language-chip">{icon && <img src={icon.dataUrl} alt={`${language} Logo`} width={12} height={12} />}{language}</span>;
}
