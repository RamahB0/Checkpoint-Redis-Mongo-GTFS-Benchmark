// src/benchmark.js
//
// Runs the same GTFS trip-planning queries against a MongoDB store and
// a Redis store (both implementing the shared interface from
// mongoStore.js / redisStore.js) and reports ingestion + query timings
// for each, so the two can be compared directly. Used by both:
//   - demo/run-demo.js (fake in-memory stores, see their headers for why)
//   - a real run against MongoDB Atlas + a real Redis instance, by
//     wiring connectMongo(MONGODB_URI) / connectRedis(REDIS_URL)
//     instead of the fakes (see README.md "Running it for real").

function now() {
  const [sec, nano] = process.hrtime();
  return sec * 1000 + nano / 1e6; // milliseconds
}

async function timeit(label, fn, iterations = 1) {
  const start = now();
  let result;
  for (let i = 0; i < iterations; i++) {
    result = await fn();
  }
  const totalMs = now() - start;
  return { label, totalMs, avgMs: totalMs / iterations, iterations, result };
}

async function runBenchmark({ mongoStore, redisStore, gtfs, iterations = 500 }) {
  const results = { ingestion: [], queries: [] };

  // --- Ingestion ------------------------------------------------------
  results.ingestion.push(
    await timeit('MongoDB ingestGtfs', () => mongoStore.ingestGtfs(gtfs))
  );
  results.ingestion.push(
    await timeit('Redis ingestGtfs', () => redisStore.ingestGtfs(gtfs))
  );

  // --- Representative trip-planning queries, run `iterations` times ---
  // each so the timings are stable enough to compare (a single query
  // against six in-memory/fake records would otherwise be dominated by
  // measurement noise).
  const queryCases = [
    {
      label: 'getStopsForRoute("R1")',
      mongo: (store) => store.getStopsForRoute('R1'),
      redis: (store) => store.getStopsForRoute('R1'),
    },
    {
      label: 'getNextDeparture("S1", 29000)',
      mongo: (store) => store.getNextDeparture('S1', 29000),
      redis: (store) => store.getNextDeparture('S1', 29000),
    },
    {
      label: 'getTripDetails("T1")',
      mongo: (store) => store.getTripDetails('T1'),
      redis: (store) => store.getTripDetails('T1'),
    },
  ];

  for (const qc of queryCases) {
    const mongoResult = await timeit(
      `MongoDB ${qc.label}`,
      () => qc.mongo(mongoStore),
      iterations
    );
    const redisResult = await timeit(
      `Redis ${qc.label}`,
      () => qc.redis(redisStore),
      iterations
    );
    results.queries.push({ label: qc.label, mongo: mongoResult, redis: redisResult });
  }

  return results;
}

function formatReport(results) {
  const lines = [];
  lines.push('=== Ingestion ===');
  for (const r of results.ingestion) {
    lines.push(`${r.label}: ${r.totalMs.toFixed(3)} ms (${r.result} rows)`);
  }

  lines.push('');
  lines.push(`=== Query benchmarks (avg over ${results.queries[0]?.mongo.iterations ?? 0} iterations) ===`);
  for (const q of results.queries) {
    lines.push(`${q.label}`);
    lines.push(`  MongoDB: ${q.mongo.avgMs.toFixed(4)} ms/op (total ${q.mongo.totalMs.toFixed(3)} ms)`);
    lines.push(`  Redis:   ${q.redis.avgMs.toFixed(4)} ms/op (total ${q.redis.totalMs.toFixed(3)} ms)`);
    const faster = q.mongo.avgMs <= q.redis.avgMs ? 'MongoDB' : 'Redis';
    lines.push(`  Faster in this run: ${faster}`);
  }

  return lines.join('\n');
}

module.exports = { runBenchmark, formatReport, timeit };
