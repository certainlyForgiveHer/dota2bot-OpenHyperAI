#!/usr/bin/env node
// Generates synthetic probe logs so the analyzer can be tested without a game.
//
//   node tests/lane_probe/make_fixture_logs.js <outDir>
//
// Scenarios: passive (looks like the current, non-aggressive baseline),
//            aggressive (what enabling lane aggression should look like),
//            vetoed (GetDesire() keeps returning 0 so Laning is never chosen).
//
// The line layout mirrors table.concat in bots/FunLib/lane_probe.lua: the "[LANE]"
// prefix is concatenated directly to the first field, with no separator after it.

'use strict';

const fs = require('fs');
const path = require('path');

const outDir = process.argv[2];
if (!outDir) {
    console.error('usage: node make_fixture_logs.js <outDir>');
    process.exit(2);
}
fs.mkdirSync(outDir, { recursive: true });

const COLUMN_ORDER = [
    'bot', 'sampleIndex', 'team', 'pos', 'gameTime', 'activeMode', 'activeDesire',
    'queueDepth', 'dmgHero', 'dmgTower', 'dmgCreep', 'enemyHeroes', 'allyHeroes',
    'enemyCreeps800', 'enemyCreeps600', 'creepTargetingMe', 'heroesTargetingMe',
    'hp', 'mana', 'lvl', 'atkRange', 'distNearestEnemy', 'hasLastHit', 'hasDeny',
    'isCore', 'atkHero', 'tgtHero', 'deaths', 'desire', 'reason',
];
const FLOAT_FIELDS = new Set(['gameTime', 'activeDesire', 'hp', 'mana', 'distNearestEnemy', 'desire']);

function renderLine(row) {
    const cells = COLUMN_ORDER.map(c => {
        const v = row[c];
        if (v === null || v === undefined) return 'nil';
        return FLOAT_FIELDS.has(c) ? Number(v).toFixed(2) : String(v);
    });
    return '[LANE]' + cells.join('|');
}

function makeSamples(scenario) {
    const lines = ['[LANE] probe-active|npc_dota_hero_axe|playerId|3|t|-75.00'];
    let idx = 0;
    for (let t = 0; t < 600; t += 1) {
        idx++;
        const base = {
            bot: 'npc_dota_hero_axe', sampleIndex: idx, team: 2, pos: 3, gameTime: t,
            dmgHero: 0, dmgTower: 0, dmgCreep: 0, allyHeroes: 1,
            enemyCreeps800: 4, enemyCreeps600: 2, heroesTargetingMe: 0,
            hp: 0.85, mana: 0.7, lvl: Math.min(10, 1 + Math.floor(t / 60)),
            atkRange: 150, isCore: 1, atkHero: 0, tgtHero: 0, deaths: 0,
        };
        if (scenario === 'passive') {
            // holds far back, Laning mode keeps losing arbitration, queue is busy
            const inLane = (t % 10) < 3;
            lines.push(renderLine(Object.assign({}, base, {
                activeMode: inLane ? 1 : 17, activeDesire: inLane ? 0.446 : 0.5, queueDepth: 1,
                enemyHeroes: 1, distNearestEnemy: 700 + (t % 90),
                hasLastHit: t % 7 === 0 ? 1 : 0, hasDeny: 0,
                creepTargetingMe: 1, atkHero: 0, tgtHero: 0, deaths: 0,
                desire: inLane ? 0.446 : 0.01, reason: 'lane_lv7',
            })));
        } else if (scenario === 'aggressive') {
            // holds close, stays in Laning, trades constantly
            lines.push(renderLine(Object.assign({}, base, {
                activeMode: 1, activeDesire: 0.446, queueDepth: 0,
                enemyHeroes: 1, distNearestEnemy: 120 + (t % 40),
                hasLastHit: t % 7 === 0 ? 1 : 0, hasDeny: t % 11 === 0 ? 1 : 0,
                creepTargetingMe: 1, heroesTargetingMe: 1, dmgHero: t % 6 === 0 ? 1 : 0,
                atkHero: 1, tgtHero: 1, deaths: 0,
                desire: 0.446, reason: 'lane_lv7',
            })));
        } else if (scenario === 'vetoed') {
            // GetDesire() always returns 0 -> Laning is never selected
            lines.push(renderLine(Object.assign({}, base, {
                activeMode: 17, activeDesire: 0.5, queueDepth: 0,
                enemyHeroes: 1, distNearestEnemy: 800,
                hasLastHit: 0, hasDeny: 0, creepTargetingMe: 0,
                atkHero: 0, tgtHero: 0, deaths: 0,
                desire: 0, reason: 'chased_off',
            })));
        } else {
            throw new Error('unknown scenario: ' + scenario);
        }
    }
    return lines.join('\n') + '\n';
}

for (const scenario of ['passive', 'aggressive', 'vetoed']) {
    const target = path.join(outDir, scenario + '.log');
    fs.writeFileSync(target, makeSamples(scenario));
    console.log('wrote ' + target);
}
