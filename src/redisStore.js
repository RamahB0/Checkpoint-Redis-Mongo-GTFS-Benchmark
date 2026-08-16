// src/redisStore.js
//
// Redis-backed store for GTFS trip-planning data, mirroring the same
// interface as src/mongoStore.js (ingestGtfs, getStopsForRoute,
// getNextDeparture, getTripDetails) so benchmark.js can run identical
// queries against both databases.
//
// Data model (see README.md "Data Ingestion and Storage"): Redis has
// no query language, so each access pattern gets its own purpose-built
// structure instead of one flexible collection:
//   stop:{stopId}                 hash   -> { name }
//   trip:{tripId}                 hash   -> { route_id, trip_headsign }
//   route:{routeId}:stops         set    -> stop_ids served by the route
//   stop:{stopId}:departures      zset   -> trip_id scored by departure_time
//                                            (powers "next departure" in O(log N))
//   trip:{tripId}:stops           zset   -> stop_id scored by stop_sequence
//   st:{tripId}:{stopId}          hash   -> { departure_time }

function keys(id) {
  return {
    stop: (stopId) => `stop:${stopId}`,
    trip: (tripId) => `trip:${tripId}`,
    routeStops: (routeId) => `route:${routeId}:stops`,
    stopDepartures: (stopId) => `stop:${stopId}:departures`,
    tripStops: (tripId) => `trip:${tripId}:stops`,
    stopTime: (tripId, stopId) => `st:${tripId}:${stopId}`,
  };
}
const k = keys();

async function connectRedis(url) {
  // Lazily required so environments without the `ioredis` package
  // installed can still use the fake store for the demo.
  const Redis = require('ioredis');
  const client = new Redis(url);
  return createRedisStore(client);
}

// Factory over a client exposing the (small) subset of the ioredis API
// this module uses. In production that's a real ioredis instance; in
// this sandbox's demo it's an in-memory fake with the same method
// signatures (see demo/fakeRedisClient.js), because there is no route
// to a real Redis server here.
function createRedisStore(client) {
  return {
    async ingestGtfs({ stops, trips, stopTimes }) {
      const pipeline = client.multi ? client.multi() : client;
      const ops = [];

      for (const s of stops) {
        ops.push(pipeline.hset(k.stop(s.stop_id), { name: s.stop_name }));
      }
      for (const t of trips) {
        ops.push(
          pipeline.hset(k.trip(t.trip_id), {
            route_id: t.route_id,
            trip_headsign: t.trip_headsign,
          })
        );
      }
      for (const st of stopTimes) {
        const trip = trips.find((t) => t.trip_id === st.trip_id);
        ops.push(pipeline.sadd(k.routeStops(trip.route_id), st.stop_id));
        ops.push(
          pipeline.zadd(k.stopDepartures(st.stop_id), st.departure_time, st.trip_id)
        );
        ops.push(pipeline.zadd(k.tripStops(st.trip_id), st.stop_sequence, st.stop_id));
        ops.push(
          pipeline.hset(k.stopTime(st.trip_id, st.stop_id), {
            departure_time: st.departure_time,
          })
        );
      }

      if (pipeline.exec) {
        await pipeline.exec();
      } else {
        await Promise.all(ops);
      }
      return stopTimes.length;
    },

    async getStopsForRoute(routeId) {
      const stopIds = await client.smembers(k.routeStops(routeId));
      const stops = [];
      for (const stopId of stopIds) {
        const hash = await client.hgetall(k.stop(stopId));
        stops.push({ stop_id: stopId, stop_name: hash.name });
      }
      return stops;
    },

    async getNextDeparture(stopId, afterTime) {
      // ZRANGEBYSCORE with LIMIT 0 1 finds the single next departure
      // in O(log N + 1) without scanning every departure at this stop.
      const results = await client.zrangebyscore(
        k.stopDepartures(stopId),
        afterTime,
        '+inf',
        'LIMIT',
        0,
        1,
        'WITHSCORES'
      );
      if (!results || results.length === 0) return null;
      const [tripId, departureTime] = results;
      const trip = await client.hgetall(k.trip(tripId));
      return {
        trip_id: tripId,
        route_id: trip.route_id,
        departure_time: Number(departureTime),
        trip_headsign: trip.trip_headsign,
      };
    },

    async getTripDetails(tripId) {
      const stopIds = await client.zrange(k.tripStops(tripId), 0, -1);
      const details = [];
      for (const stopId of stopIds) {
        const [stopHash, stHash] = await Promise.all([
          client.hgetall(k.stop(stopId)),
          client.hgetall(k.stopTime(tripId, stopId)),
        ]);
        details.push({
          stop_id: stopId,
          stop_name: stopHash.name,
          departure_time: Number(stHash.departure_time),
        });
      }
      return details;
    },

    async close() {
      if (client.quit) await client.quit();
    },
  };
}

module.exports = { connectRedis, createRedisStore };
