import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/storage/db';
import { DEFAULT_SETTINGS, type AppSettings } from '@/types';

/** Live app settings. `undefined` while loading. */
export function useSettings(): AppSettings | undefined {
  return useLiveQuery(async () => {
    const row = await db.settings.get('app');
    return { ...DEFAULT_SETTINGS, ...(row?.value ?? {}) };
  }, []);
}
