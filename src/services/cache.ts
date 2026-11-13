import { getRedis } from "../lib/redis";

export async function cacheGet<T>(key: string): Promise<T | null> {
  const raw = await getRedis().get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds = 60): Promise<void> {
  await getRedis().set(key, JSON.stringify(value), "EX", ttlSeconds);
}

export async function cacheDelete(key: string): Promise<void> {
  await getRedis().del(key);
}

/**
 * KEYS walks the whole keyspace in one blocking call (Redis is single
 * threaded: every client waits). SCAN iterates in small batches instead.
 */
export async function cacheDeletePattern(pattern: string): Promise<number> {
  const redis = getRedis();
  let cursor = "0";
  let deleted = 0;
  do {
    const [next, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 200);
    if (keys.length > 0) deleted += await redis.unlink(...keys);
    cursor = next;
  } while (cursor !== "0");
  return deleted;
}
