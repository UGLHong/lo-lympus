import 'dotenv/config';

import { Mastra } from '@mastra/core';
import { Memory } from '@mastra/memory';
import { PostgresStore } from '@mastra/pg';

import { pool } from '../db/client';

const globalForMastra = globalThis as unknown as {
  __olympusStorage?: PostgresStore;
  __olympusMemory?: Memory;
  __olympusMastra?: Mastra;
};

function getStorage(): PostgresStore {
  if (globalForMastra.__olympusStorage) return globalForMastra.__olympusStorage;
  const storage = new PostgresStore({
    id: 'olympus-memory',
    pool,
  });
  globalForMastra.__olympusStorage = storage;
  return storage;
}

export function getMemory(): Memory {
  if (globalForMastra.__olympusMemory) return globalForMastra.__olympusMemory;
  const memory = new Memory({
    storage: getStorage(),
    options: {
      lastMessages: 20,
      semanticRecall: false,
    },
  });
  globalForMastra.__olympusMemory = memory;
  return memory;
}

export function getMastra(): Mastra {
  if (globalForMastra.__olympusMastra) return globalForMastra.__olympusMastra;
  const mastra = new Mastra({
    storage: getStorage(),
  });
  globalForMastra.__olympusMastra = mastra;
  return mastra;
}
