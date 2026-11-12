import { useCallback, useEffect, useState } from 'react';
import { bg } from '@/lib/bgClient';
import type { ProviderStatus } from '@/lib/messages';

export interface ProviderStatusState {
  status: ProviderStatus | null;
  /** chrome.runtime is missing (page opened outside the extension) or the background did not answer. */
  unavailable: boolean;
  refresh: () => void;
}

export function extensionAvailable(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.runtime?.id;
}

/** Polls bg.status() every 3s and when the window regains focus. */
export function useProviderStatus(): ProviderStatusState {
  const [status, setStatus] = useState<ProviderStatus | null>(null);
  const [unavailable, setUnavailable] = useState(!extensionAvailable());

  const refresh = useCallback(() => {
    if (!extensionAvailable()) {
      setUnavailable(true);
      return;
    }
    bg.status().then(
      (s) => {
        if (s && typeof s === 'object' && 'tabOpen' in s) {
          setStatus(s);
          setUnavailable(false);
        } else setUnavailable(true);
      },
      () => setUnavailable(true),
    );
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 3000);
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(t);
      window.removeEventListener('focus', refresh);
    };
  }, [refresh]);

  return { status, unavailable, refresh };
}
