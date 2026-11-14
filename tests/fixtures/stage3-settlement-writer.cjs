// Invoked in a separate Electron-as-Node process by the independent-writer test.
const Module = require('module');
const path = require('node:path');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return { app: { isPackaged: true, getPath: () => path.dirname(process.argv[2]), getVersion: () => 'test' } };
  return originalLoad.apply(this, arguments);
};
require('ts-node/register/transpile-only');
const Database = require('better-sqlite3');
const { completeExactBalanceSettlement } = require('../../main/routes/bills');
const [dbPath, billId] = process.argv.slice(2);
const db = new Database(dbPath, { timeout: 50 });
try {
  completeExactBalanceSettlement(db, billId, 100, 'INR');
  process.exitCode = 0;
} catch (error) {
  // SQLITE_BUSY is the expected result while the other independent writer owns
  // BEGIN IMMEDIATE. No mutation may survive this failed writer.
  if (String(error && error.code) === 'SQLITE_BUSY') process.exitCode = 12;
  else { console.error(error); process.exitCode = 1; }
} finally { db.close(); }
