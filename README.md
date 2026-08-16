# Checkpoint: Application-Based Benchmarking on Redis and MongoDB for Trip Planning using GTFS Data

This repo implements and benchmarks two ways of storing/querying [GTFS](https://gtfs.org/)
(General Transit Feed Specification) transit data for trip planning: a
MongoDB-backed store and a Redis-backed store, both behind the same
interface, so they can be compared directly. It also answers, in full,
every question from the checkpoint's instructions.

## What's here

- `data/` - a small hand-written GTFS-shaped dataset: two routes, four
  trips, six stops, and their stop times.
- `src/mongoStore.js` - MongoDB (Mongoose) implementation of the
  trip-planning queries.
- `src/redisStore.js` - Redis (ioredis) implementation of the same
  queries, using hashes/sets/sorted sets.
- `src/benchmark.js` - runs both stores through ingestion + a set of
  representative queries and reports timings.
- `src/loadGtfs.js` - loads the sample dataset.
- `demo/` - lets the benchmark run **inside this sandbox**, which has
  no route to a real MongoDB or Redis server (see "Verifying it
  works" below) by swapping in small, faithful in-memory fakes of the
  Mongoose model and the ioredis client.
- `scripts/run-real.js` - the same benchmark, wired to real
  `MONGODB_URI` / `REDIS_URL` connections, for running outside this
  sandbox.
- `output.txt` - captured, verified output of `npm run demo`.

## 1. Introduction to GTFS Data

**What is GTFS data, and what kind of information does it contain?**
GTFS (General Transit Feed Specification) is an open standard for
publishing public transit schedules and associated geographic
information. A GTFS feed is a zip of plain-text CSV files, the core
ones being `stops.txt` (stop locations and names), `routes.txt`
(the transit lines a agency runs), `trips.txt` (a specific scheduled
run of a route, e.g. the 8:00am Blue Line), and `stop_times.txt`
(which stops a trip visits, in what order, and at what time). This
repo's `data/*.json` files are a small hand-written subset of exactly
those fields.

**How can GTFS data be used for trip planning?** A trip planner
answers questions like "what stops does this route serve", "when's
the next bus from here", and "what's my full itinerary for this
trip" - all of which are just queries over `stops`, `routes`, `trips`,
and `stop_times`, joined and filtered by stop, route, or time. That's
exactly the query set this repo implements and benchmarks
(`getStopsForRoute`, `getNextDeparture`, `getTripDetails`).

## 2. Overview of Redis and MongoDB

**What are Redis and MongoDB, and how do they differ from traditional
SQL databases?** Both are NoSQL databases - they don't require a
fixed, upfront schema and don't primarily use SQL/joins the way a
relational database (Postgres, MySQL) does. Redis is an in-memory
key-value store: everything lives in RAM, addressed by key, using a
handful of built-in data structures (strings, hashes, sets, sorted
sets, lists). MongoDB is a document database: it stores JSON-like
documents (BSON) in disk-backed collections, supports rich queries,
secondary indexes, and joins (`$lookup`), much closer to SQL in
query expressiveness while remaining schema-flexible.

**Key features:**

- Redis: in-memory (sub-millisecond latency), a small set of
  purpose-built data structures rather than one general one,
  optional persistence (RDB snapshots / AOF log), pub/sub, and
  master-replica replication/clustering for scale.
- MongoDB: disk-backed with a working-set cache, a full query
  language (filtering, aggregation pipelines, geospatial queries),
  secondary indexes, ACID transactions (since 4.0), and native
  horizontal scaling via sharding.

## 3. Benchmarking Criteria

**What criteria would you use to benchmark the performance of Redis
and MongoDB?** This repo measures, per operation: (1) ingestion time
- how long it takes to load the GTFS dataset in; (2) query latency -
average time per call, over many iterations, for each representative
trip-planning query (`src/benchmark.js` runs each query 500 times and
reports the average). A fuller benchmark would add: memory footprint
per record, behavior under concurrent load, and latency at a much
larger dataset size (see "Scalability and Efficiency" below).

**Why is it important to benchmark databases for application-based
scenarios?** Generic database benchmarks (raw read/write throughput)
don't tell you how a database performs for *your* actual access
patterns. A trip planner's dominant query - "what's the next
departure from this stop" - is a very different shape than, say, a
full-text search or an analytics rollup, and different databases
handle it differently well. Benchmarking with the application's real
queries (as this repo does) is the only way to know which store is
actually the better fit.

## 4. Data Ingestion and Storage

**How would you ingest GTFS data into Redis and MongoDB?** Both
`ingestGtfs()` implementations (`src/mongoStore.js`,
`src/redisStore.js`) take the same parsed `{ stops, trips, stopTimes
}` object and load it in a single pass: MongoDB gets one denormalized
document per stop_time (see below); Redis gets a handful of
purpose-built structures per entity (see below). At production scale,
a real GTFS feed's CSVs would be streamed and batched rather than
loaded fully into memory first, but the ingestion *logic* is
identical.

**Compare the data storage mechanisms of Redis and MongoDB.**
MongoDB's `StopTime` documents are intentionally denormalized - each
document embeds the stop name and trip headsign alongside the raw
stop_time fields, so the hottest query (departures from a stop) never
needs a `$lookup`/join; a compound index on `{ stop_id: 1,
departure_time: 1 }` backs it directly. Redis has no query language
at all, so each access pattern gets its own structure: a **sorted
set** `stop:{id}:departures` (member = trip_id, score = departure
time) makes "next departure after time X" an O(log N) range query; a
**set** `route:{id}:stops` holds the stops served by a route; **hashes**
(`stop:{id}`, `trip:{id}`, `st:{tripId}:{stopId}`) hold the rest of
each entity's fields. This is the central Redis trade-off: extremely
fast for the exact patterns you designed for, at the cost of having to
design (and duplicate data across) a structure per pattern up front.

## 5. Query Performance

**How do Redis and MongoDB handle queries for trip planning using
GTFS data?** MongoDB answers `getNextDeparture` with an indexed
`find({stop_id, departure_time: {$gte}}).sort({departure_time:
1}).limit(1)` - the query planner uses the compound index directly.
Redis answers the same question with `ZRANGEBYSCORE
stop:{id}:departures afterTime +inf LIMIT 0 1` on the pre-built sorted
set - conceptually the same "walk the index in score order" operation,
just expressed as a native Redis command instead of a query-planner
decision.

**Example queries this repo runs** (see `src/mongoStore.js` /
`src/redisStore.js` for both implementations):

- `getStopsForRoute("R1")` - all stops served by the Blue Line.
- `getNextDeparture("S1", 29000)` - next departure from Downtown after
  8:03:20am (29000s after midnight).
- `getTripDetails("T1")` - the full stop-by-stop itinerary for one
  scheduled trip.

## 6. Scalability and Efficiency

**Discuss the scalability of Redis and MongoDB when dealing with
large GTFS datasets.** A large real-world feed (e.g. a major metro
system) can have hundreds of thousands of stop_times rows. MongoDB
scales that by sharding the collection (e.g. by `stop_id`) across
multiple nodes, with the working set cached in RAM and the rest on
disk - so dataset size is bounded by disk, not RAM. Redis keeps
*everything* in RAM, so it scales primarily by adding more memory or
by sharding across a Redis Cluster; for a nationwide, always-growing
GTFS archive, that gets expensive fast unless the working set is kept
intentionally small (e.g. only "today's" schedule, with historical
data pushed to MongoDB).

**Which database would you recommend for a large-scale trip planning
application, and why?** A hybrid: MongoDB as the system of record for
the full GTFS feed (routes, trips, stops, calendars, all history),
and Redis as a caching/hot-path layer in front of it for the small,
frequently-hit slice of data - "next departures for the stops near
me right now" - the same caching pattern used in this course's Azure
MERN checkpoint. That gets MongoDB's scale and query flexibility for
the bulk of the data, and Redis's speed for the queries that are on
the critical path of the user-facing app.

## 7. Practical Application

**Design a simple trip planning application using either Redis or
MongoDB. Explain the steps you would take to implement this
application.** This repo *is* that implementation, built against
both databases behind one interface so it doubles as the comparison:

1. Parse a GTFS feed into `stops`, `routes`, `trips`, `stop_times`
   (`src/loadGtfs.js` does this for the sample dataset).
2. Ingest it into the chosen store with a schema/structure suited to
   the app's queries (`ingestGtfs()` in `src/mongoStore.js` /
   `src/redisStore.js`).
3. Implement the trip-planning queries the app actually needs:
   stops-for-a-route, next-departure-from-a-stop, and
   full-itinerary-for-a-trip (all three, in both stores).
4. Expose those as an API layer (e.g. Express routes calling into
   `mongoStore`/`redisStore` - the same shape as this course's Azure
   MERN checkpoint's `routes/tasks.js`) for a frontend to consume.
5. Benchmark and iterate: `src/benchmark.js` closes the loop by
   measuring whether the chosen store/schema actually performs well
   for those queries, so schema decisions are backed by numbers, not
   guesses.

## 8. Conclusion

**Summarize the advantages and disadvantages of using Redis and
MongoDB for trip planning.** MongoDB: flexible querying, easy to
model a full GTFS feed with all its relationships, straightforward to
scale to disk-bound dataset sizes, but disk-backed reads are slower
than pure in-memory access. Redis: extremely low latency for the
exact access patterns you've built structures for, and a natural fit
for "next departure" style point queries, but has no query language
of its own (every new access pattern is new code and new duplicated
structures), and scaling means scaling RAM.

**Based on your benchmarking results, which database would you choose
for future projects involving GTFS data, and why?** See `output.txt`
for this run's actual numbers (produced by `npm run demo`, since this
sandbox can't reach a real database server - see below). In general,
for the point-lookup queries this benchmark focuses on
(`getNextDeparture`, `getStopsForRoute`), Redis's purpose-built sorted
sets are the faster path once the working set fits in memory, while
MongoDB remains the better choice as the system of record for the
full feed and for any query that isn't one of the ones you designed a
Redis structure for in advance. My recommendation, consistent with
section 6, is to use both: MongoDB as the source of truth, Redis as a
cache/index in front of it for the hot trip-planning queries.

## Verifying it works

This sandbox environment has no route to a real MongoDB or Redis
server (the same class of network restriction documented in this
course's Azure-MERN-Deployment checkpoint README - outbound access to
the services' own binary-download hosts is blocked). Rather than skip
verification, `demo/run-demo.js` drives the **real**
`src/mongoStore.js` and `src/redisStore.js` query logic, with only the
underlying Mongoose model and ioredis client swapped for small,
faithful in-memory fakes (`demo/fakeMongoModel.js`,
`demo/fakeRedisClient.js`, documented inline). It also asserts that
both stores return identical results for every query, so the two
implementations are verified functionally equivalent - not just
independently "not crashing" - before the timing benchmark runs.

```bash
npm install
npm run demo        # runs demo/run-demo.js, writes output.txt
```

`output.txt` (committed at the repo root) shows: the sample data being
ingested into both stores, every correctness assertion passing, and
the timing benchmark's report.

## Running it for real (with MongoDB Atlas + a real Redis instance)

```bash
npm install
cp .env.example .env   # fill in MONGODB_URI (Atlas) and REDIS_URL
npm run start:real     # scripts/run-real.js: same benchmark, real connections
```

`scripts/run-real.js` calls the exact same `runBenchmark()` used by
the demo - `src/mongoStore.js` and `src/redisStore.js` don't change at
all between the demo and a real run, only which model/client is
passed in.
