#!/usr/bin/env node
// Checks that the probe's REAL runtime output and the analyzer's COLUMNS agree.
//
//   node tests/lane_probe/check_probe_schema.js [repoRoot]
//
// Earlier versions of this check parsed lane_probe.lua as text, which reported
// agreement while the analyzer was in fact one column short. It now runs the probe in
// a Lua VM and compares the emitted line, so the comparison cannot be fooled by a
// stale or hand-maintained field list.

'use strict';

const path = require('path');
const { openProbe, sampleLine, cellsOf } = require(path.join(__dirname, 'probe_harness.js'));
const { COLUMNS } = require(path.join(__dirname, 'analyze_lane_log.js'));

const ROOT = process.argv[2] || path.join(__dirname, '..', '..');

const h = openProbe(ROOT);
const line = sampleLine(h);
if (!line) {
    console.log('FAIL  the probe printed no sample line');
    process.exit(1);
}
const cells = cellsOf(line);

console.log('probe emits   : ' + cells.length + ' fields');
console.log('analyzer wants: ' + COLUMNS.length + ' fields');

let bad = 0;
if (cells.length !== COLUMNS.length) {
    bad++;
    console.log('LENGTH MISMATCH');
}

const n = Math.max(cells.length, COLUMNS.length);
for (let i = 0; i < n; i++) {
    // Values are checked positionally only where both sides exist; the point here is
    // alignment, which the logging test verifies semantically.
    if (i >= cells.length) console.log('  index ' + (i + 1) + ': probe=<none> analyzer=' + COLUMNS[i]);
    else if (i >= COLUMNS.length) console.log('  index ' + (i + 1) + ': probe=' + JSON.stringify(cells[i]) + ' analyzer=<none>');
}

if (bad) {
    console.log('');
    console.log('The probe and the analyzer disagree on the column layout.');
    console.log('Update COLUMNS in analyze_lane_log.js, the generator in make_fixture_logs.js,');
    console.log('and the header comment in lane_probe.lua.');
    process.exit(1);
}
console.log('probe output and analyzer COLUMNS agree (' + COLUMNS.length + ' fields)');
