// server/lib/db.js
// Minimal synchronous JSON-file "database". No native bindings, no server
// process required — good enough for a prototype / small deployment.
// Swap this module out for a real database later without touching routes,
// as long as the same method names are kept.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DB_PATH = path.join(__dirname, '..', 'data', 'db.json');

const EMPTY = {
  users: [],
  semesters: [],
  courses: [],
  folders: [],
  certificates: [],
};

function load() {
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify(EMPTY, null, 2));
  }
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
}

function save(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function id() {
  return crypto.randomUUID();
}

// --- generic helpers ---
function all(collection) {
  return load()[collection];
}

function find(collection, predicate) {
  return load()[collection].find(predicate);
}

function filter(collection, predicate) {
  return load()[collection].filter(predicate);
}

function insert(collection, record) {
  const data = load();
  const withId = { id: id(), createdAt: new Date().toISOString(), ...record };
  data[collection].push(withId);
  save(data);
  return withId;
}

function update(collection, recordId, patch) {
  const data = load();
  const idx = data[collection].findIndex((r) => r.id === recordId);
  if (idx === -1) return null;
  data[collection][idx] = { ...data[collection][idx], ...patch };
  save(data);
  return data[collection][idx];
}

function remove(collection, recordId) {
  const data = load();
  data[collection] = data[collection].filter((r) => r.id !== recordId);
  save(data);
}

function removeWhere(collection, predicate) {
  const data = load();
  data[collection] = data[collection].filter((r) => !predicate(r));
  save(data);
}

module.exports = { load, save, id, all, find, filter, insert, update, remove, removeWhere };
