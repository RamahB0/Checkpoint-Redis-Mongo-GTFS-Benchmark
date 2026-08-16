// demo/run-demo.js
//
// Verification + benchmark entry point for this sandbox environment,
// where no real MongoDB or Redis server is reachable (see the fake
// store files' headers for the full explanation). This script:
//   1. Ingests the sample GTFS dataset into a fake MongoDB store and a
//      fake Redis store (both driving the REAL src/mongoStore.js and
//      src/redisStore.js query logic - only the underlying
//      model/client is faked).
//   2. Asserts both stores agree on every query, so the two
//      implementations are verified functionally equivalent, not just
//      independently "not crashing".
//   3. Runs the timing benchmark from src/benchmark.js and prints a
//      report.
//
// `npm run demo` captures this script's output to ../output.txt.
//
// To run against real databases instead, see README.md "Running it
// for real" - it's the same runBenchmark() call, just given stores
// from connectMongo(MONGODB_URI) / connectRedis(REDIS_URL).

const assert = require('assert');
const { loadGtfs } = require('../src/loadGtfs');
const { createMongoStore } = require('../src/mongoStore');
const { createRedisStore } = require('../src/redisStore');
const { runBenchmark, formatReport } = require('../src/benchmark');
const { createFakeStopTimeModel } = require('./fakeMongoModel');
const { createFakeRedisClient } = require('./fakeRedisClient');

function section(title) {
  console.log(`\n=== ${title} ===`);
}

async function verifyStoresAgree(mongoStore, redisStore) {
  section('Correctness check: MongoDB store vs Redis store agree');

  const mongoStops = await mongoStore.getStopsForRoute('R1');
  const redisStops = await redisStore.getStopsForRoute('R1');
  const normalize = (stops) =>
    [...stops].sort((a, b) => a.stop_id.localeCompare(b.stop_id));
  assert.deepStrictEqual(normalize(mongoStops), normalize(redisStops));
  console.log(`getStopsForRoute("R1") -> ${mongoStops.map((s) => s.stop_name).join(', ')}`);

  const mongoNext = await mongoStore.getNextDeparture('S1', 29000);
  const redisNext = await redisStore.getNextDeparture('S1', 29000);
  assert.strictEqual(mongoNext.trip_id, redisNext.trip_id);
  assert.strictEqual(mongoNext.departure_time, redisNext.departure_time);
  console.log(
    `getNextDeparture("S1", 29000) -> trip ${mongoNext.trip_id} at ${mongoNext.departure_time}s (both stores agree)`
  );

  const mongoTrip = await mongoStore.getTripDetails('T1');
  const redisTrip = await redisStore.getTripDetails('T1');
  assert.deepStrictEqual(mongoTrip, redisTrip);
  console.log(
    `getTripDetails("T1") -> ${mongoTrip.map((s) => `${s.stop_name}@${s.departure_time}`).join(' -> ')}`
  );

  // A stop with no more departures after the given time should come
  // back null from both stores.
  const mongoNone = await mongoStore.getNextDeparture('S4', 99999);
  const redisNone = await redisStore.getNextDeparture('S4', 99999);
  assert.strictEqual(mongoNone, null);
  assert.strictEqual(redisNone, null);
  console.log('getNextDeparture("S4", 99999) -> null in both stores (no departures left)');

  console.log('\nAll correctness assertions passed.');
}

async function main() {
  const gtfs = loadGtfs();

  const mongoStore = createMongoStore(createFakeStopTimeModel());
  const redisStore = createRedisStore(createFakeRedisClient());

  section('Ingesting sample GTFS data');
  const mongoCount = await mongoStore.ingestGtfs(gtfs);
  const redisCount = await redisStore.ingestGtfs(gtfs);
  console.log(`MongoDB store: ingested ${mongoCount} stop_times rows`);
  console.log(`Redis store:   ingested ${redisCount} stop_times rows`);

  await verifyStoresAgree(mongoStore, redisStore);

  section('Running timing benchmark');
  const results = await runBenchmark({ mongoStore, redisStore, gtfs, iterations: 500 });
  console.log(formatReport(results));

  section('Done');
  console.log(
    'In production, these same src/mongoStore.js and src/redisStore.js modules connect to a real MongoDB Atlas cluster and a real Redis instance via connectMongo(MONGODB_URI) / connectRedis(REDIS_URL) - see README.md.'
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
