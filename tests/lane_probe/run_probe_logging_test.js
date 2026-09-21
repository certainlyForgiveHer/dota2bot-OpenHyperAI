#!/usr/bin/env node
// Executes bots/FunLib/lane_probe.lua inside a real Lua VM (fengari) with a stubbed
// Dota API, captures what it prints, and checks the emitted line.
//
//   node tests/lane_probe/run_probe_logging_test.js [repoRoot]
//
// Why this exists: the analyzer tests and the schema check both validate the parsing
// side. This is the only check that runs the probe itself, so a mistake inside Note()
// (wrong column order, a dropped cell, no output, a broken guard) is caught without
// launching Dota.

'use strict';

const path = require('path');
const { openProbe, cellsOf } = require(path.join(__dirname, 'probe_harness.js'));
const { COLUMNS } = require(path.join(__dirname, 'analyze_lane_log.js'));

const ROOT = process.argv[2] || path.join(__dirname, '..', '..');
const PREFIX = '[LANE]';
const h = openProbe(ROOT);

// The first Note() call emits both the liveness line and a sample line, so tests must
// locate sample lines by shape rather than by a fixed buffer index.
function lastSampleLine() {
    const n = Number(h.call('return #PRINTED'));
    for (let i = n; i >= 1; i--) {
        const line = h.call('return PRINTED[' + i + ']');
        const cells = cellsOf(line);
        if (cells.length === COLUMNS.length) return line;
    }
    return '';
}

let failures = 0;
function check(name, condition, detail) {
    if (condition) console.log('PASS  ' + name);
    else { failures++; console.log('FAIL  ' + name + (detail ? '  -> ' + detail : '')); }
}

// --------------------------------------------------------------- liveness line
const firstLine = h.call('P.Note(state.desired, state.reason) return PRINTED[1] or ""');
check('probe prints a liveness line first',
    firstLine.indexOf(PREFIX + ' probe-active') === 0, JSON.stringify(firstLine).slice(0, 90));

// ------------------------------------------------------------------ sample line
h.call('state.time = state.time + 1 state.enemies = { MakeUnit({ team = 3 }) } P.Note(state.desired, state.reason) return 0');
const sampleLine = lastSampleLine();
const cells = cellsOf(sampleLine);

check('sample line starts with the probe prefix followed by the field separator',
    sampleLine.indexOf(PREFIX + '|') === 0,
    JSON.stringify(sampleLine).slice(0, 60));
check('sample line has exactly the analyzer column count',
    cells.length === COLUMNS.length, cells.length + ' vs ' + COLUMNS.length);

if (cells.length === COLUMNS.length) {
    const row = {};
    COLUMNS.forEach((c, i) => { row[c] = cells[i]; });
    check('bot name column', row.bot === 'npc_dota_hero_axe', row.bot);
    check('pos column', row.pos === '3', row.pos);
    check('attack range column', row.atkRange === '150', row.atkRange);
    check('distance column', row.distNearestEnemy === '150.00', row.distNearestEnemy);
    check('desire column carries the value passed in', row.desire === '0.45', row.desire);
    check('reason column carries the reason passed in', row.reason === 'lane_lv7', row.reason);
    check('atkHero is 0 when the bot targets nothing', row.atkHero === '0', row.atkHero);
    check('tgtHero is 0 when the bot targets nothing', row.tgtHero === '0', row.tgtHero);
    check('heroesTargetingMe parses in the right slot', row.heroesTargetingMe === '0', row.heroesTargetingMe);
    check('deaths starts at 0', row.deaths === '0', row.deaths);
}

// ----------------------------------------------- attacking-will columns respond
h.call('state.time = state.time + 1 state.atkTarget = MakeUnit({ team = 3 }) P.Note(state.desired, state.reason) return 0');
const cells2 = cellsOf(lastSampleLine());
check('atkHero becomes 1 when the attack target is an enemy hero',
    cells2[COLUMNS.indexOf('atkHero')] === '1',
    'atkHero=' + cells2[COLUMNS.indexOf('atkHero')] + ' line=' + JSON.stringify(sampleLine).slice(0, 70));

h.call('state.time = state.time + 1 state.atkTarget = MakeUnit({ team = 2 }) state.target = MakeUnit({ team = 3 }) P.Note(state.desired, state.reason) return 0');
const cells3 = cellsOf(lastSampleLine());
check('an allied attack target does not count as attacking will',
    cells3[COLUMNS.indexOf('atkHero')] === '0', cells3[COLUMNS.indexOf('atkHero')]);
check('tgtHero still counts an enemy general target',
    cells3[COLUMNS.indexOf('tgtHero')] === '1', cells3[COLUMNS.indexOf('tgtHero')]);

// ------------------------------------------------------------ death accounting
h.call(`
state.time = state.time + 1
state.atkTarget = nil
state.target = nil
bot.alive = false
P.Note(state.desired, state.reason)
state.time = state.time + 1
bot.alive = true
P.Note(state.desired, state.reason)
state.time = state.time + 1
bot.alive = false
P.Note(state.desired, state.reason)
return 0
`);
const deathCells = cellsOf(lastSampleLine());
check('death counter increments once per alive -> dead transition',
    deathCells[COLUMNS.indexOf('deaths')] === '2', deathCells[COLUMNS.indexOf('deaths')]);

// ------------------------------------------------------------ sampling cadence
const cadence = h.call(`
local before = #PRINTED
state.time = state.time + 0.1
P.Note(state.desired, state.reason)
return tostring(#PRINTED - before)
`);
check('samples are throttled: a call 0.1s later prints nothing new',
    cadence === '0', 'printed ' + cadence + ' line(s)');

// ------------------------------------------------------------- switch read path
check('Enabled() reports true when the switch is on',
    h.call('Customize.Enable_Lane_Probe = true return tostring(P.Enabled())') === 'true');
check('Enabled() reports false when the switch is off',
    h.call('Customize.Enable_Lane_Probe = false return tostring(P.Enabled())') === 'false');
check('a missing Customize table is treated as off',
    h.call('Customize = {} return tostring(P.Enabled())') === 'false');

console.log('');
console.log(failures === 0 ? 'ALL PROBE LOGGING CHECKS PASSED' : failures + ' CHECK(S) FAILED');
process.exit(failures ? 1 : 0);
