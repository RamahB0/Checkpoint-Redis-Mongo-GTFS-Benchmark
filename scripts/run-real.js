// scripts/run-real.js
//
// Entry point for running this checkpoint's benchmark against REAL
// MongoDB and Redis instances (as opposed to demo/run-demo.js, which
// uses in-memory fakes because this sandbox can't reach either
// database - see README.md "Verifying it works").
//
// Usage:
//   cp .env.example .env         # fill in MONGODB_URI and REDIS_URL
//   npm install
//   node scripts/run-real.js
//
// This is the same runBenchmark() call as the demo, just given stores
// backed by real connections instead of fakes - src/mongoStore.js and
// src/redisStore.js don't change at all between the two modes.

require('dotenv').config();
const { loadGtfs } = require('../src/loadGtfs');
const { connectMongo } = require('../src/mongoStore');
const { connectRedis } = require('../src/redisStore');
const { runBenchmark, formatReport } = require('../src/benchmark');

async function main() {
  const { MONGODB_URI, REDIS_URL } = process.env;
  if (!MONGODB_URI || !REDIS_URL) {
    console.error('Set MONGODB_URI and REDIS_URL (see .env.example) before running this script.');
    process.exit(1);
  }

  const gtfs = loadGtfs();
  const mongoStore = await connectMongo(MONGODB_URI);
  const redisStore = await connectRedis(REDIS_URL);

  try {
    const results = await runBenchmark({ mongoStore, redisStore, gtfs, iterations: 500 });
    console.log(formatReport(results));
  } finally {
    await mongoStore.close();
    await redisStore.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
