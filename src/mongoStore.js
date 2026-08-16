// src/mongoStore.js
//
// MongoDB-backed store for GTFS trip-planning data, used for the
// "Application-Based Benchmarking on Redis and MongoDB for Trip
// Planning using GTFS Data" checkpoint. Implements the same interface
// as src/redisStore.js so benchmark.js can run identical queries
// against both databases and compare timings.
//
// Data model (see README.md "Data Ingestion and Storage" for the
// reasoning): one document per stop_time, embedding the stop and
// trip/route info needed for trip-planning queries, so the common
// "next departures from a stop" query never needs a join/populate.

const mongoose = require('mongoose');

const stopTimeSchema = new mongoose.Schema(
  {
    trip_id: { type: String, required: true, index: true },
    route_id: { type: String, required: true, index: true },
    stop_id: { type: String, required: true, index: true },
    stop_sequence: { type: Number, required: true },
    departure_time: { type: Number, required: true }, // seconds after midnight
    stop_name: String,
    trip_headsign: String,
  },
  { versionKey: false }
);

// The query "next departure from a stop, after time X" is the hot path
// for a trip planner, so it gets a compound index matching that access
// pattern exactly.
stopTimeSchema.index({ stop_id: 1, departure_time: 1 });

function buildModel(connection) {
  return connection.model('StopTime', stopTimeSchema);
}

async function connectMongo(uri) {
  const connection = await mongoose.createConnection(uri).asPromise();
  return createMongoStore(buildModel(connection), connection);
}

// Factory that takes an already-resolved Mongoose model, so the same
// store logic can be exercised against a real MongoDB connection
// (production / connectMongo above) or swapped out entirely in the
// demo (see demo/fakeMongoModel.js) when no MongoDB server is reachable.
function createMongoStore(StopTime, connection = null) {
  return {
    async ingestGtfs({ stops, trips, stopTimes }) {
      const stopsById = new Map(stops.map((s) => [s.stop_id, s]));
      const tripsById = new Map(trips.map((t) => [t.trip_id, t]));

      const docs = stopTimes.map((st) => ({
        trip_id: st.trip_id,
        route_id: tripsById.get(st.trip_id).route_id,
        stop_id: st.stop_id,
        stop_sequence: st.stop_sequence,
        departure_time: st.departure_time,
        stop_name: stopsById.get(st.stop_id).stop_name,
        trip_headsign: tripsById.get(st.trip_id).trip_headsign,
      }));

      await StopTime.deleteMany({});
      await StopTime.insertMany(docs);
      return docs.length;
    },

    async getStopsForRoute(routeId) {
      const rows = await StopTime.find({ route_id: routeId })
        .sort({ trip_id: 1, stop_sequence: 1 })
        .lean();
      // De-duplicate stops across trips of the same route, preserving
      // the first trip's ordering (routes repeat the same stop pattern
      // across trips in this simplified dataset).
      const seen = new Set();
      const stops = [];
      for (const row of rows) {
        if (!seen.has(row.stop_id)) {
          seen.add(row.stop_id);
          stops.push({ stop_id: row.stop_id, stop_name: row.stop_name });
        }
      }
      return stops;
    },

    async getNextDeparture(stopId, afterTime) {
      const row = await StopTime.findOne({
        stop_id: stopId,
        departure_time: { $gte: afterTime },
      })
        .sort({ departure_time: 1 })
        .lean();
      return row
        ? {
            trip_id: row.trip_id,
            route_id: row.route_id,
            departure_time: row.departure_time,
            trip_headsign: row.trip_headsign,
          }
        : null;
    },

    async getTripDetails(tripId) {
      const rows = await StopTime.find({ trip_id: tripId })
        .sort({ stop_sequence: 1 })
        .lean();
      return rows.map((r) => ({
        stop_id: r.stop_id,
        stop_name: r.stop_name,
        departure_time: r.departure_time,
      }));
    },

    async close() {
      if (connection) await connection.close();
    },
  };
}

module.exports = { connectMongo, createMongoStore, stopTimeSchema };
