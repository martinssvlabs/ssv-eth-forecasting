'use client';

import { useEffect, useState } from 'react';
import styles from './ThemeToggle.module.css';

type ThemeMode = 'light' | 'dark';

const STORAGE_KEY = 'theme';

const resolveSystemTheme = (): ThemeMode => {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
};

const applyTheme = (theme: ThemeMode): void => {
  document.documentElement.setAttribute('data-theme', theme);
};

const resolveInitialTheme = (): ThemeMode => {
  if (typeof document === 'undefined') return 'light';

  const current = document.documentElement.getAttribute('data-theme');
  if (current === 'light' || current === 'dark') {
    return current;
  }

  return resolveSystemTheme();
};

export function ThemeToggle() {
  const [theme, setTheme] = useState<ThemeMode>(resolveInitialTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const onToggle = () => {
    const next: ThemeMode = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    applyTheme(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Non-blocking.
    }
  };

  return (
    <button
      type="button"
      className={styles.toggle}
      onClick={onToggle}
      aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      <span className={styles.icon} aria-hidden="true">
        {theme === 'dark' ? '☀' : '☾'}
      </span>
    </button>
  );
}
