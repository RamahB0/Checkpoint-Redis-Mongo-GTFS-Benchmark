// src/loadGtfs.js
//
// Loads the sample GTFS dataset (data/*.json) used throughout this
// checkpoint. A real GTFS feed ships as a zip of CSV files
// (stops.txt, routes.txt, trips.txt, stop_times.txt, ...); this repo
// uses a small hand-written JSON subset of the same fields so the
// benchmark is fast and self-contained, but the ingestion/query code
// in mongoStore.js and redisStore.js works the same way against a
// full feed - only loadGtfs() would need to swap to a CSV parser.

const path = require('path');

function loadGtfs() {
  const stops = require(path.join(__dirname, '..', 'data', 'stops.json'));
  const routes = require(path.join(__dirname, '..', 'data', 'routes.json'));
  const trips = require(path.join(__dirname, '..', 'data', 'trips.json'));
  const stopTimes = require(path.join(__dirname, '..', 'data', 'stop_times.json'));
  return { stops, routes, trips, stopTimes };
}

module.exports = { loadGtfs };
