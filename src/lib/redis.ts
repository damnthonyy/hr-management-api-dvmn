import IORedis, { type Redis } from "ioredis";
import { env } from "../config/env";

let client: Redis | null = null;

export function getRedis(): Redis {
  if (!client) {
    client = new IORedis(env.redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
    });
  }
  return client;
}

export const bullConnection = {
  url: env.redisUrl,
  maxRetriesPerRequest: null,
};

export async function pingRedis(): Promise<string> {
  return getRedis().ping();
}

export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit();
    client = null;
  }
}
