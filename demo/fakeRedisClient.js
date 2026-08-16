// demo/fakeRedisClient.js
//
// A tiny in-memory stand-in for the subset of the ioredis API that
// src/redisStore.js actually uses (hset, hgetall, sadd, smembers,
// zadd, zrangebyscore, zrange). Implements real hash/set/sorted-set
// semantics with plain JS Maps so demo/run-demo.js can drive the
// *real* src/redisStore.js query logic end-to-end.
//
// Why this exists: this sandbox has no route to a real Redis server
// either (no package registry access to fetch/run a redis-server
// binary, same class of restriction documented for MongoDB in the
// sibling Azure-MERN-Deployment checkpoint's README). Production code
// (src/redisStore.js's connectRedis) is unaffected - it still uses a
// real ioredis client against a real Redis connection URL.

function createFakeRedisClient() {
  const hashes = new Map(); // key -> Map(field -> value)
  const sets = new Map(); // key -> Set(member)
  const zsets = new Map(); // key -> Map(member -> score)

  return {
    async hset(key, fieldsObj) {
      if (!hashes.has(key)) hashes.set(key, new Map());
      const hash = hashes.get(key);
      for (const [field, value] of Object.entries(fieldsObj)) {
        hash.set(field, String(value));
      }
      return Object.keys(fieldsObj).length;
    },

    async hgetall(key) {
      const hash = hashes.get(key);
      if (!hash) return {};
      return Object.fromEntries(hash.entries());
    },

    async sadd(key, member) {
      if (!sets.has(key)) sets.set(key, new Set());
      const before = sets.get(key).size;
      sets.get(key).add(member);
      return sets.get(key).size - before;
    },

    async smembers(key) {
      return Array.from(sets.get(key) || []);
    },

    async zadd(key, score, member) {
      if (!zsets.has(key)) zsets.set(key, new Map());
      zsets.get(key).set(member, Number(score));
      return 1;
    },

    async zrangebyscore(key, min, max, ...rest) {
      const zset = zsets.get(key) || new Map();
      const lo = min === '-inf' ? -Infinity : Number(min);
      const hi = max === '+inf' ? Infinity : Number(max);

      let entries = Array.from(zset.entries())
        .filter(([, score]) => score >= lo && score <= hi)
        .sort((a, b) => a[1] - b[1]);

      const limitIdx = rest.findIndex((r) => String(r).toUpperCase() === 'LIMIT');
      if (limitIdx !== -1) {
        const offset = Number(rest[limitIdx + 1]);
        const count = Number(rest[limitIdx + 2]);
        entries = entries.slice(offset, offset + count);
      }

      const withScores = rest.some((r) => String(r).toUpperCase() === 'WITHSCORES');
      return entries.flatMap(([member, score]) =>
        withScores ? [member, String(score)] : [member]
      );
    },

    async zrange(key, start, stop) {
      const zset = zsets.get(key) || new Map();
      const entries = Array.from(zset.entries()).sort((a, b) => a[1] - b[1]);
      const end = stop === -1 ? entries.length : stop + 1;
      return entries.slice(start, end).map(([member]) => member);
    },
  };
}

module.exports = { createFakeRedisClient };
