// ============================================================
// Correlation ID Foundation — Step 29 §13/§20
// ============================================================
'use strict';
const crypto = require('node:crypto');

function newCorrelationId() {
  return 'req-' + crypto.randomUUID();
}

module.exports = { newCorrelationId };
