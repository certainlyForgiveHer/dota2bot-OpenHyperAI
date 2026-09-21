#!/usr/bin/env node
// Analyses a Dota console log produced with Customize.Enable_Lane_Probe = true.
//
//   node tests/lane_probe/analyze_lane_log.js <console.log>
//   node tests/lane_probe/analyze_lane_log.js <baseline.log> <after.log>   # A/B compare
//
// It only reads the log. Nothing here is loaded by the game.
//
// Probe line schema (must stay in sync with bots/FunLib/lane_probe.lua):
//   [LANE] bot|sampleIndex|team|pos|gameTime|activeMode|activeDesire|queueDepth|
//          dmgHero|dmgTower|dmgCreep|enemyHeroes|allyHeroes|enemyCreeps800|enemyCreeps600|
//          creepTargetingMe|heroesTargetingMe|hp|mana|lvl|atkRange|distNearestEnemy|
//          hasLastHit|hasDeny|isCore|atkHero|tgtHero|deaths|desire|reason
//
// Keep COLUMNS below in sync with bots/FunLib/lane_probe.lua. The malformed counter
// in the report is what catches drift.

'use strict';

const fs = require('fs');

// Order is taken from the table.concat in bots/FunLib/lane_probe.lua and is checked
// mechanically by tests/lane_probe/check_probe_schema.js -- do not trust comments.
const COLUMNS = [
    'bot', 'sampleIndex', 'team', 'pos', 'gameTime', 'activeMode', 'activeDesire',
    'queueDepth', 'dmgHero', 'dmgTower', 'dmgCreep', 'enemyHeroes', 'allyHeroes',
    'enemyCreeps800', 'enemyCreeps600', 'creepTargetingMe', 'heroesTargetingMe',
    'hp', 'mana', 'lvl', 'atkRange', 'distNearestEnemy', 'hasLastHit', 'hasDeny',
    'isCore', 'atkHero', 'tgtHero', 'deaths', 'desire', 'reason',
];

// typescript/bots/ts_libs/dota/enums.ts
const BOT_MODE = {
    1: 'Laning', 2: 'Attack', 3: 'Roam', 4: 'Retreat', 5: 'SecretShop', 6: 'SideShop',
    7: 'Rune', 8: 'PushTop', 9: 'PushMid', 10: 'PushBot', 11: 'DefendTop', 12: 'DefendMid',
    13: 'DefendBot', 14: 'Assemble', 16: 'TeamRoam', 17: 'Farm', 18: 'DefendAlly',
    19: 'Evasive', 20: 'Roshan', 21: 'Item', 22: 'Ward',
};
const TEAM = { 2: 'Radiant', 3: 'Dire', 4: 'Neutral', 5: 'None' };

function num(v) {
    if (v === undefined || v === 'nil' || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

function parseLog(text) {
    const samples = [];
    const skipped = { active: 0, heartbeat: 0, malformed: 0 };
    let total = 0;

    for (const rawLine of text.split(/\r?\n/)) {
        if (!rawLine.includes('[LANE]')) continue;
        total++;
        if (rawLine.includes('[LANE] probe-active')) { skipped.active++; continue; }
        if (rawLine.includes('[LANE] heartbeat')) { skipped.heartbeat++; continue; }

        const start = rawLine.indexOf('[LANE]');
        const payload = rawLine.slice(start + '[LANE]'.length).trim();
        const parts = payload.split('|');
        if (parts.length !== COLUMNS.length) { skipped.malformed++; continue; }

        const row = {};
        COLUMNS.forEach((c, i) => { row[c] = parts[i]; });
        const s = {
            bot: row.bot,
            team: TEAM[num(row.team)] || row.team,
            pos: num(row.pos),
            t: num(row.gameTime),
            mode: num(row.activeMode),
            modeName: BOT_MODE[num(row.activeMode)] || ('mode' + row.activeMode),
            modeDesire: num(row.activeDesire),
            queue: num(row.queueDepth),
            dmgHero: num(row.dmgHero) === 1,
            dmgTower: num(row.dmgTower) === 1,
            dmgCreep: num(row.dmgCreep) === 1,
            enemies: num(row.enemyHeroes),
            allies: num(row.allyHeroes),
            creeps800: num(row.enemyCreeps800),
            creeps600: num(row.enemyCreeps600),
            creepAggro: num(row.creepTargetingMe),
            heroAggro: num(row.heroesTargetingMe),
            hp: num(row.hp),
            mana: num(row.mana),
            lvl: num(row.lvl),
            atkRange: num(row.atkRange),
            dist: num(row.distNearestEnemy),
            hasLastHit: num(row.hasLastHit) === 1,
            hasDeny: num(row.hasDeny) === 1,
            isCore: num(row.isCore) === 1,
            atkHero: num(row.atkHero) === 1,
            tgtHero: num(row.tgtHero) === 1,
            deaths: num(row.deaths),
            desire: num(row.desire),
            reason: row.reason,
        };
        if (s.t === null || s.dist === null || s.atkRange === null) { skipped.malformed++; continue; }
        samples.push(s);
    }
    return { samples, skipped, total };
}

function median(xs) {
    if (!xs.length) return null;
    const a = xs.slice().sort((x, y) => x - y);
    const m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
function mean(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; }
function pct(n, d) { return d > 0 ? (100 * n) / d : null; }
function f1(v) { return v === null || v === undefined ? 'n/a' : v.toFixed(1); }
function f2(v) { return v === null || v === undefined ? 'n/a' : v.toFixed(2); }

// ---------------------------------------------------------------- diagnostics
// Each signature is a concrete, checkable reason "bots look passive".
function diagnostics(s, meanAtkRange) {
    const out = [];
    const n = s.length;
    if (!n) return out;

    const laneSamples = s.filter(x => x.mode === 1);
    const laneShare = pct(laneSamples.length, n);
    out.push({
        id: 'lane_mode_share',
        value: f1(laneShare) + '%',
        verdict: laneShare >= 60 ? 'ok' : (laneShare >= 30 ? 'warn' : 'bad'),
        note: 'share of samples whose active mode is Laning; low means mode arbitration, not in-lane logic',
    });

    // engaged = the bot is actually within reach of an enemy hero
    const inReach = x => x.dist !== null && x.dist >= 0 && x.dist <= x.atkRange + 150;
    const opportunities = s.filter(x => x.mode === 1 && x.enemies > 0 && x.hp >= 0.30);
    const engaged = opportunities.filter(inReach);
    const engageRate = pct(engaged.length, opportunities.length);
    out.push({
        id: 'engage_when_enemy_near',
        value: f1(engageRate) + '%',
        verdict: engageRate === null ? 'na' : (engageRate >= 25 ? 'ok' : (engageRate >= 10 ? 'warn' : 'bad')),
        note: 'share of lane samples with an enemy in reach; low means the bot never closes distance (positioning)',
    });

    const queued = s.filter(x => x.queue > 0 && x.mode !== 4 && x.mode !== 19);
    const queueShare = pct(queued.length, n);
    out.push({
        id: 'queued_action_share',
        value: f1(queueShare) + '%',
        verdict: queueShare === null ? 'na' : (queueShare <= 30 ? 'ok' : (queueShare <= 60 ? 'warn' : 'bad')),
        note: 'queue non-empty blocks the ability layer via J.CanNotUseAbility; high means abilities rarely get a chance',
    });

    const creepPressure = s.filter(x => x.creepAggro > 0 && x.mode === 1);
    const creepPressureShare = pct(creepPressure.length, laneSamples.length);
    out.push({
        id: 'creep_aggro_while_laning',
        value: f1(creepPressureShare) + '%',
        verdict: creepPressureShare === null ? 'na' : (creepPressureShare <= 40 ? 'ok' : 'warn'),
        note: 'creep aggro on the bot while laning pushes it out of trades',
    });

    const chaseOff = s.filter(x => x.reason === 'chased_off').length;
    const ancient = s.filter(x => x.reason === 'ancient').length;
    out.push({
        id: 'desire_vetoed',
        value: 'chased_off ' + f1(pct(chaseOff, n)) + '% / ancient ' + f1(pct(ancient, n)) + '%',
        verdict: pct(chaseOff, n) > 15 ? 'warn' : 'ok',
        note: 'GetDesire() returning 0 keeps the bot out of Laning entirely',
    });

    if (laneShare !== null && laneShare < 10) {
        const top = branchHistogram(s).slice(0, 3).map(([k, v]) => k + '=' + v).join(' ');
        out.push({
            id: 'LANING_NEVER_SELECTED',
            value: 'laning ' + f1(laneShare) + '%  branches: ' + top,
            verdict: 'bad',
            note: 'Laning almost never wins mode arbitration. Fixing in-lane aggression cannot help here; ' +
                  'the desire branches above are returning 0 or losing to another mode.',
        });
    }

    // The direct evidence: is the bot actually pointing at an enemy hero?
    const withEnemy = s.filter(x => x.enemies > 0);
    const heroTargetRate = pct(withEnemy.filter(x => x.atkHero || x.tgtHero).length, withEnemy.length);
    out.push({
        id: 'hero_target_rate',
        value: f1(heroTargetRate) + '%',
        verdict: heroTargetRate === null ? 'na' : (heroTargetRate >= 25 ? 'ok' : (heroTargetRate >= 8 ? 'warn' : 'bad')),
        note: 'share of samples with an enemy nearby where the bot targets an enemy hero; ' +
              'this is attacking will, measured directly rather than inferred from desire',
    });

    const laneDeaths = s[s.length - 1].deaths;
    out.push({
        id: 'deaths_seen',
        value: laneDeaths === null ? 'n/a' : String(laneDeaths),
        verdict: 'info',
        note: 'cumulative deaths counted by this bot\'s probe instance; compare against the ' +
              'after log to price the aggression',
    });

    const lastHit = pct(s.filter(x => x.hasLastHit).length, n);
    out.push({
        id: 'lasthit_availability',
        value: f1(lastHit) + '%',
        verdict: 'info',
        note: 'baseline for the G4 check: this must not drop once aggression is enabled',
    });

    return out;
}

function branchHistogram(s) {
    const h = {};
    s.forEach(x => { h[x.reason] = (h[x.reason] || 0) + 1; });
    return Object.entries(h).sort((a, b) => b[1] - a[1]);
}

function modeHistogram(s) {
    const h = {};
    s.forEach(x => { h[x.modeName] = (h[x.modeName] || 0) + 1; });
    return Object.entries(h).sort((a, b) => b[1] - a[1]);
}

function phaseStats(s) {
    const phases = [['0-2min', 0, 120], ['2-5min', 120, 300], ['5-10min', 300, 600], ['>10min', 600, Infinity]];
    return phases.map(([name, lo, hi]) => {
        const g = s.filter(x => x.t >= lo && x.t < hi);
        const laneSamples = g.filter(x => x.mode === 1);
        const opps = laneSamples.filter(x => x.enemies > 0 && x.hp >= 0.30);
        const engaged = opps.filter(x => x.dist >= 0 && x.dist <= x.atkRange + 150);
        return {
            name,
            n: g.length,
            laneShare: pct(laneSamples.length, g.length),
            engageRate: pct(engaged.length, opps.length),
            medianDist: median(opps.map(x => x.dist)),
        };
    });
}

function analyse(samples) {
    const byBot = new Map();
    samples.forEach(s => {
        const k = s.bot + ' (' + s.team + ' pos' + s.pos + ')';
        if (!byBot.has(k)) byBot.set(k, []);
        byBot.get(k).push(s);
    });
    return byBot;
}

// ------------------------------------------------------------------- printing
function printReport(path, parsed) {
    const { samples, skipped, total } = parsed;
    console.log('='.repeat(78));
    console.log('LANE PROBE REPORT: ' + path);
    console.log('='.repeat(78));
    console.log('lines with [LANE]: ' + total + '   usable samples: ' + samples.length +
        '   probe-active: ' + skipped.active + '   heartbeat: ' + skipped.heartbeat +
        '   malformed: ' + skipped.malformed);
    if (!samples.length) {
        console.log('');
        console.log('NO USABLE SAMPLES.');
        if (skipped.malformed > 0) {
            console.log('All probe lines were malformed -> the line schema changed;');
            console.log('re-check COLUMNS against bots/FunLib/lane_probe.lua.');
        } else if (total === 0) {
            console.log('No [LANE] lines at all -> the probe hook did not run.');
            console.log('Check Customize.Enable_Lane_Probe and that bots/mode_laning_generic.lua is deployed.');
        } else {
            console.log('Only probe-active lines were found -> GetDesire() was called but sampling never');
            console.log('passed its throttle; check that DotaTime() advances.');
        }
        return null;
    }

    const byBot = analyse(samples);
    const overallMeanAtk = mean(samples.map(x => x.atkRange));

    for (const [bot, rows] of byBot) {
        console.log('');
        console.log('-'.repeat(78));
        console.log(bot + '   samples=' + rows.length +
            '   gameTime ' + f1(Math.min(...rows.map(r => r.t))) + 's .. ' + f1(Math.max(...rows.map(r => r.t))) + 's');
        console.log('-'.repeat(78));

        console.log('  phases:');
        phaseStats(rows).forEach(p => {
            console.log('    ' + p.name.padEnd(8) + ' n=' + String(p.n).padStart(5) +
                '  laning=' + f1(p.laneShare).padStart(5) + '%' +
                '  engage=' + f1(p.engageRate).padStart(5) + '%' +
                '  medianDist=' + f1(p.medianDist));
        });

        console.log('  modes:    ' + modeHistogram(rows).slice(0, 6).map(([k, v]) => k + '=' + v).join('  '));
        console.log('  branches: ' + branchHistogram(rows).slice(0, 6).map(([k, v]) => k + '=' + v).join('  '));

        const diags = diagnostics(rows, overallMeanAtk);
        console.log('  diagnostics:');
        diags.forEach(d => {
            const tag = { ok: '[ ok ]', warn: '[warn]', bad: '[BAD ]', info: '[info]', na: '[ -- ]' }[d.verdict]
                || '[ ?? ]';
            console.log('    ' + tag + ' ' + d.id.padEnd(26) + d.value);
            console.log('           ' + d.note);
        });
    }
    return byBot;
}

// ---------------------------------------------------------------- A/B compare
const COMPARE_FIELDS = [
    ['median dist to nearest enemy', s => median(s.filter(x => x.mode === 1 && x.enemies > 0).map(x => x.dist))],
    ['laning mode share %', s => pct(s.filter(x => x.mode === 1).length, s.length)],
    ['engage rate % (enemy in reach)', s => {
        const o = s.filter(x => x.mode === 1 && x.enemies > 0 && x.hp >= 0.30);
        return pct(o.filter(x => x.dist >= 0 && x.dist <= x.atkRange + 150).length, o.length);
    }],
    ['last-hit availability %', s => pct(s.filter(x => x.hasLastHit).length, s.length)],
    ['deny availability %', s => pct(s.filter(x => x.hasDeny).length, s.length)],
    ['median queue depth', s => median(s.map(x => x.queue))],
    ['creep aggro while laning %', s => {
        const l = s.filter(x => x.mode === 1);
        return pct(l.filter(x => x.creepAggro > 0).length, l.length);
    }],
    ['hero-target rate % (attacking will)', s => {
        const w = s.filter(x => x.enemies > 0);
        return pct(w.filter(x => x.atkHero || x.tgtHero).length, w.length);
    }],
    ['deaths seen', s => s.length ? s[s.length - 1].deaths : null],
];

function printCompare(basePath, base, afterPath, after) {
    console.log('');
    console.log('='.repeat(78));
    console.log('A/B COMPARE');
    console.log('  baseline: ' + basePath + '  (' + base.samples.length + ' samples)');
    console.log('  after   : ' + afterPath + '  (' + after.samples.length + ' samples)');
    console.log('='.repeat(78));
    console.log('  ' + 'metric'.padEnd(34) + 'baseline'.padStart(12) + 'after'.padStart(12) + '  direction');
    console.log('  ' + '-'.repeat(74));

    for (const [name, fn] of COMPARE_FIELDS) {
        const b = fn(base.samples);
        const a = fn(after.samples);
        let dir = '';
        if (b !== null && a !== null) {
            const d = a - b;
            if (Math.abs(d) < 1e-9) dir = 'same';
            else dir = (d > 0 ? '+' : '') + f2(d);
        }
        console.log('  ' + name.padEnd(34) + f2(b).padStart(12) + f2(a).padStart(12) + '  ' + dir);
    }
    console.log('');
    console.log('  Read the G4 table in docs/LANE_AGGRESSION_ZH.md before judging:');
    console.log('    - median dist and laning mode share should both move the aggressive way');
    console.log('    - last-hit and deny availability must NOT drop');
    console.log('    - a rise in dmgHero samples is expected but must be reported with deaths');
}

// ---------------------------------------------------------------------- main
function main() {
    const args = process.argv.slice(2);
    if (!args.length) {
        console.error('usage: node analyze_lane_log.js <console.log> [after.log]');
        process.exit(2);
    }
    const parsed = args.map(p => {
        if (!fs.existsSync(p)) {
            console.error('file not found: ' + p);
            process.exit(2);
        }
        return parseLog(fs.readFileSync(p, 'utf8'));
    });

    printReport(args[0], parsed[0]);
    if (args.length > 1) {
        printReport(args[1], parsed[1]);
        printCompare(args[0], parsed[0], args[1], parsed[1]);
    }
    process.exit(0);
}

if (require.main === module) main();

module.exports = { parseLog, analyse, diagnostics, phaseStats, printReport, printCompare, COLUMNS, BOT_MODE };
