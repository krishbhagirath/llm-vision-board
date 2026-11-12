import 'fake-indexeddb/auto';
import { beforeEach } from 'vitest';
import { VisionBoardDB, useDatabase } from '@/storage/db';

let counter = 0;
beforeEach(() => {
  // Fresh isolated database per test.
  useDatabase(new VisionBoardDB(`test-db-${Date.now()}-${counter++}`));
});
