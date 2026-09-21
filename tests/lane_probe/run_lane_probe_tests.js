#!/usr/bin/env node
// Checks the lane-log analyzer itself: schema agreement, parsing, and that each
// synthetic scenario produces the diagnostics it must produce.
//
//   node tests/lane_probe/run_lane_probe_tests.js
//
// Uses no game data; fixtures are generated in memory by make_fixture_logs.js.

'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HERE = __dirname;
const analyzerPath = path.join(HERE, 'analyze_lane_log.js');
const generatorPath = path.join(HERE, 'make_fixture_logs.js');
const schemaCheckPath = path.join(HERE, 'check_probe_schema.js');
const analyzer = require(analyzerPath);

let failures = 0;
function check(name, condition, detail) {
    if (condition) {
        console.log('PASS  ' + name);
    } else {
        failures++;
        console.log('FAIL  ' + name + (detail ? '  -> ' + detail : ''));
    }
}

// ---------------------------------------------------------------- schema agreement
try {
    const repoRoot = path.join(HERE, '..', '..');
    const out = execFileSync(process.execPath, [schemaCheckPath, repoRoot], { encoding: 'utf8' });
    check('probe output schema matches analyzer COLUMNS', out.includes('COLUMNS agree'), out.trim());
} catch (e) {
    check('probe output schema matches analyzer COLUMNS', false, String(e.stdout || e.message).trim());
}

// ---------------------------------------------------------------------- fixtures
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lane-probe-'));
execFileSync(process.execPath, [generatorPath, tmp], { encoding: 'utf8' });

function load(name) {
    const parsed = analyzer.parseLog(fs.readFileSync(path.join(tmp, name + '.log'), 'utf8'));
    return parsed;
}

const passive = load('passive');
const aggressive = load('aggressive');
const vetoed = load('vetoed');

// ---------------------------------------------------------------- parsing basics
check('parses every sample line without malformed rows',
    passive.skipped.malformed === 0 && aggressive.skipped.malformed === 0 && vetoed.skipped.malformed === 0,
    'malformed: ' + [passive, aggressive, vetoed].map(p => p.skipped.malformed).join('/'));
check('counts the probe-active line separately',
    passive.skipped.active === 1, 'active=' + passive.skipped.active);
check('field alignment: first sample keeps the bot name in the first column',
    passive.samples[0].bot === 'npc_dota_hero_axe', 'bot=' + passive.samples[0].bot);
check('field alignment: position column is the numeric pos',
    passive.samples[0].pos === 3, 'pos=' + passive.samples[0].pos);
check('field alignment: attack range is not the distance column',
    passive.samples[0].atkRange === 150, 'atkRange=' + passive.samples[0].atkRange);
check('field alignment: distance parses as a number',
    passive.samples[0].dist === 700, 'dist=' + passive.samples[0].dist);
check('team and mode names resolve from the enums',
    passive.samples[0].team === 'Radiant' && passive.samples[0].modeName === 'Laning',
    passive.samples[0].team + '/' + passive.samples[0].modeName);

// ------------------------------------------------------------- diagnostics verdicts
function verdicts(parsed) {
    const map = {};
    analyzer.analyse(parsed.samples).forEach(rows => {
        analyzer.diagnostics(rows, 150).forEach(d => { map[d.id] = d.verdict; });
    });
    return map;
}
function diagValue(parsed, id) {
    let v = null;
    analyzer.analyse(parsed.samples).forEach(rows => {
        analyzer.diagnostics(rows, 150).forEach(d => { if (d.id === id) v = d.value; });
    });
    return v;
}

const vp = verdicts(passive);
const va = verdicts(aggressive);
const vv = verdicts(vetoed);

check('passive scenario: low laning share is flagged', vp.lane_mode_share !== 'ok', 'verdict=' + vp.lane_mode_share);
check('passive scenario: never in reach is flagged BAD', vp.engage_when_enemy_near === 'bad', 'verdict=' + vp.engage_when_enemy_near);
check('passive scenario: busy action queue is flagged', vp.queued_action_share !== 'ok', 'verdict=' + vp.queued_action_share);
check('aggressive scenario: nothing is flagged BAD', !Object.values(va).includes('bad'), JSON.stringify(va));
check('aggressive scenario: laning share is ok', va.lane_mode_share === 'ok', 'verdict=' + va.lane_mode_share);
check('aggressive scenario: engagement is ok', va.engage_when_enemy_near === 'ok', 'verdict=' + va.engage_when_enemy_near);
check('vetoed scenario: Laning-never-selected is reported BAD', vv.LANING_NEVER_SELECTED === 'bad', 'verdict=' + vv.LANING_NEVER_SELECTED);
check('vetoed scenario: the veto branch is named',
    String(diagValue(vetoed, 'LANING_NEVER_SELECTED')).includes('chased_off'),
    diagValue(vetoed, 'LANING_NEVER_SELECTED'));
// ------------------------------------------------- attacking-will evidence columns
check('passive scenario: hero-target rate is flagged BAD', vp.hero_target_rate === 'bad', 'verdict=' + vp.hero_target_rate);
check('aggressive scenario: hero-target rate is ok', va.hero_target_rate === 'ok', 'verdict=' + va.hero_target_rate);
check('aggressive scenario: hero-target rate reads 100%',
    String(diagValue(aggressive, 'hero_target_rate')) === '100.0%', diagValue(aggressive, 'hero_target_rate'));
check('passive scenario: hero-target rate reads 0%',
    String(diagValue(passive, 'hero_target_rate')) === '0.0%', diagValue(passive, 'hero_target_rate'));
check('death counter parses from the probe line',
    passive.samples[99].deaths === 0, 'deaths=' + passive.samples[99].deaths);
check('death counter is surfaced as an info diagnostic',
    vp.deaths_seen === 'info', 'verdict=' + vp.deaths_seen);

check('no diagnostic prints an undefined token',
    !JSON.stringify([vp, va, vv]).includes('undefined'), JSON.stringify([vp, va, vv]));

// ------------------------------------------------------------------- no-data paths
check('empty input is reported as no samples', analyzer.parseLog('').samples.length === 0);
check('a log with only probe-active has no samples',
    analyzer.parseLog('[LANE] probe-active|x|y|1|t|0.00').samples.length === 0);
const wrongCols = analyzer.parseLog('[LANE] bot|1|2|3');
check('a line with the wrong column count is counted as malformed',
    wrongCols.skipped.malformed === 1 && wrongCols.samples.length === 0,
    JSON.stringify(wrongCols.skipped));

fs.rmSync(tmp, { recursive: true, force: true });

console.log('');
console.log(failures === 0 ? 'ALL LANE PROBE ANALYZER CHECKS PASSED' : failures + ' CHECK(S) FAILED');
process.exit(failures ? 1 : 0);
