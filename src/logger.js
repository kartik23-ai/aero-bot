"use strict";

function log(level, message, meta = {}) {
  const record = {
    level,
    message,
    meta,
    at: new Date().toISOString()
  };
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

module.exports = {
  info: (message, meta) => log("info", message, meta),
  warn: (message, meta) => log("warn", message, meta),
  error: (message, meta) => log("error", message, meta)
};
