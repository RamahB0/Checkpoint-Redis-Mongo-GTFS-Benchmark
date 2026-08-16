// demo/fakeMongoModel.js
//
// A tiny in-memory stand-in for the Mongoose `StopTime` model used by
// src/mongoStore.js, implementing just the chainable subset actually
// called there: find(filter).sort(spec).lean(), findOne(filter).sort(spec).lean(),
// deleteMany({}), insertMany(docs).
//
// Why this exists: this sandbox has no route to a real MongoDB server
// (see the sibling Azure-MERN-Deployment checkpoint's README for the
// full explanation - outbound access to MongoDB's own binary-download
// host is blocked here). Rather than skip verification, this fake lets
// demo/run-demo.js drive the *real* src/mongoStore.js query logic
// end-to-end, with only the underlying Mongoose model swapped out.
// Production code (src/mongoStore.js's connectMongo) is unaffected and
// still uses real Mongoose against a real MongoDB connection string.

function matches(doc, filter) {
  return Object.entries(filter).every(([field, cond]) => {
    if (cond && typeof cond === 'object' && '$gte' in cond) {
      return doc[field] >= cond.$gte;
    }
    return doc[field] === cond;
  });
}

function sortDocs(docs, spec) {
  const entries = Object.entries(spec);
  return [...docs].sort((a, b) => {
    for (const [field, dir] of entries) {
      if (a[field] < b[field]) return -1 * dir;
      if (a[field] > b[field]) return 1 * dir;
    }
    return 0;
  });
}

// A thenable query builder: .sort()/.lean() configure it, and it only
// actually runs `resolve()` when awaited (mirroring Mongoose's lazy
// query execution closely enough for this fake's purposes).
class FakeQuery {
  constructor(resolve, { single = false } = {}) {
    this._resolve = resolve; // () => docs[]
    this._sortSpec = null;
    this._single = single;
  }

  sort(spec) {
    this._sortSpec = spec;
    return this;
  }

  // .lean() is a no-op here: the fake already returns plain objects.
  lean() {
    return this;
  }

  then(onFulfilled, onRejected) {
    return Promise.resolve()
      .then(() => {
        let docs = this._resolve();
        if (this._sortSpec) docs = sortDocs(docs, this._sortSpec);
        return this._single ? (docs.length ? docs[0] : null) : docs;
      })
      .then(onFulfilled, onRejected);
  }
}

function createFakeStopTimeModel() {
  let store = [];

  return {
    find(filter = {}) {
      return new FakeQuery(() => store.filter((doc) => matches(doc, filter)));
    },

    findOne(filter = {}) {
      return new FakeQuery(() => store.filter((doc) => matches(doc, filter)), {
        single: true,
      });
    },

    async deleteMany() {
      store = [];
      return { acknowledged: true };
    },

    async insertMany(docs) {
      store.push(...docs);
      return docs;
    },
  };
}

module.exports = { createFakeStopTimeModel };
