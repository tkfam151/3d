'use strict';
// Tiny JSON-file datastore. Every write is atomic (write temp file, then rename)
// so a crash mid-write never corrupts the database.
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

const EMPTY = () => ({ admins: [], tokens: [], orders: [], slots: [], emails: [], counter: 1000 });

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

let state;
try {
  state = Object.assign(EMPTY(), JSON.parse(fs.readFileSync(DB_FILE, 'utf8')));
} catch (err) {
  if (err.code !== 'ENOENT') throw err;
  state = EMPTY();
}

function save() {
  const tmp = DB_FILE + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

module.exports = {
  DATA_DIR,
  UPLOAD_DIR,
  get data() { return state; },
  save,
  /** Run a mutation and persist it. */
  tx(fn) {
    const out = fn(state);
    save();
    return out;
  },
  nextOrderNumber() {
    state.counter += 1;
    return state.counter;
  },
};
