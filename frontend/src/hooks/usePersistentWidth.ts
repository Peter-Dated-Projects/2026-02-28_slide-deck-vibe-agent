import { useEffect, useState } from 'react';

interface UsePersistentWidthOptions {
  storageKey: string;
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
}

const clampWidth = (width: number, minWidth: number, maxWidth: number) => {
  return Math.min(maxWidth, Math.max(minWidth, width));
};

const readStoredWidth = ({
  storageKey,
  defaultWidth,
  minWidth,
  maxWidth,
}: UsePersistentWidthOptions) => {
  if (typeof window === 'undefined') {
    return defaultWidth;
  }

  const storedWidth = window.localStorage.getItem(storageKey);
  const parsedWidth = Number(storedWidth);

  if (!Number.isFinite(parsedWidth)) {
    return defaultWidth;
  }

  return clampWidth(parsedWidth, minWidth, maxWidth);
};

export function usePersistentWidth(options: UsePersistentWidthOptions) {
  const { storageKey, defaultWidth, minWidth, maxWidth } = options;
  const [width, setWidth] = useState(() => readStoredWidth(options));

  useEffect(() => {
    window.localStorage.setItem(
      storageKey,
      String(clampWidth(width, minWidth, maxWidth)),
    );
  }, [maxWidth, minWidth, storageKey, width]);

  return [width, setWidth] as const;
}