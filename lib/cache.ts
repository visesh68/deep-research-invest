/**
 * Tiny in-process LRU with per-entry TTL. No dependencies, no infrastructure.
 *
 * Scope and honesty about it: this lives in module scope, so it is shared by every
 * request handled by the SAME warm serverless instance and is lost on cold start.
 * It is therefore a best-effort credit saver, not a guarantee — two concurrent users
 * on two instances will both miss. That is the correct trade at this size: it costs
 * nothing, adds no secret, and cannot fail a request. A shared Redis is the upgrade
 * path once the hit rate actually needs to be reliable.
 *
 * Recency is tracked by Map insertion order: re-inserting on read moves an entry to
 * the tail, so the least-recently-used key is always the first one the iterator yields.
 */

export type CacheStats = {
  hits: number;
  misses: number;
  evictions: number;
  expirations: number;
  size: number;
};

export type CacheHit<T> = { value: T; ageMs: number };

export type LruCache<T> = {
  get(key: string): CacheHit<T> | undefined;
  set(key: string, value: T): void;
  delete(key: string): void;
  clear(): void;
  stats(): CacheStats;
};

type Entry<T> = { value: T; storedAt: number };

export function createLruCache<T>(opts: { max: number; ttlMs: number }): LruCache<T> {
  const map = new Map<string, Entry<T>>();
  let hits = 0;
  let misses = 0;
  let evictions = 0;
  let expirations = 0;

  // A single flag rather than a check at every call site, so the kill switch
  // cannot be forgotten in one of them.
  const enabled = process.env.RESEARCH_CACHE !== "0";

  return {
    get(key) {
      if (!enabled) return undefined;
      const entry = map.get(key);
      if (!entry) {
        misses++;
        return undefined;
      }
      const ageMs = Date.now() - entry.storedAt;
      if (ageMs > opts.ttlMs) {
        map.delete(key);
        expirations++;
        misses++;
        return undefined;
      }
      // Re-insert to mark as most recently used.
      map.delete(key);
      map.set(key, entry);
      hits++;
      return { value: entry.value, ageMs };
    },

    set(key, value) {
      if (!enabled) return;
      if (map.has(key)) map.delete(key);
      map.set(key, { value, storedAt: Date.now() });
      while (map.size > opts.max) {
        const oldest = map.keys().next().value;
        if (oldest === undefined) break;
        map.delete(oldest);
        evictions++;
      }
    },

    delete(key) {
      map.delete(key);
    },

    clear() {
      map.clear();
    },

    stats() {
      return { hits, misses, evictions, expirations, size: map.size };
    },
  };
}

/**
 * Cache key for a user question.
 *
 * Deliberately conservative: lowercase, collapse whitespace, drop trailing
 * punctuation. Aggressive normalization (stripping stopwords, stemming) would
 * start colliding genuinely different questions — "bull case on X" and "bear case
 * on X" must never share a key. Under-normalizing costs a cache miss; over-
 * normalizing serves the wrong research note, so the asymmetry decides it.
 */
export function questionCacheKey(question: string): string {
  return question
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[?.!]+$/, "");
}
