// Shared harness: runs bots/FunLib/lane_probe.lua in a real Lua VM with a stubbed
// Dota API and captures what it prints. Used by the logging test and by the schema
// check, so both compare against the probe's real runtime output rather than against
// a hand-maintained field list that can silently drift.
//
// Development-only tool; nothing here is loaded by the game.

'use strict';

const fs = require('fs');
const path = require('path');

function loadFengari() {
    const candidates = [
        'fengari',
        path.join(__dirname, '..', '.deps', 'node_modules', 'fengari'),
        process.env.FENGARI_PATH,
    ].filter(Boolean);
    const tried = [];
    for (const c of candidates) {
        try { return require(c); } catch (e) { tried.push(c); }
    }
    console.error('fengari not found. Tried: ' + tried.join(', '));
    console.error('Install it with:  mkdir -p tests/.deps && cd tests/.deps && npm install fengari --no-audit --no-fund');
    process.exit(2);
}

function openProbe(repoRoot) {
    const fengari = loadFengari();
    const { lua, lauxlib, lualib, to_luastring, to_jsstring } = fengari;

    const L = lauxlib.luaL_newstate();
    lualib.luaL_openlibs(L);

    function run(src, name) {
        if (lauxlib.luaL_loadbuffer(L, to_luastring(src), null, to_luastring(name)) !== lua.LUA_OK)
            throw new Error('load error in ' + name + ': ' + to_jsstring(lua.lua_tostring(L, -1)));
        if (lua.lua_pcall(L, 0, 0, 0) !== lua.LUA_OK)
            throw new Error('runtime error in ' + name + ': ' + to_jsstring(lua.lua_tostring(L, -1)));
    }
    function call(src) {
        if (lauxlib.luaL_loadbuffer(L, to_luastring(src), null, to_luastring('@eval')) !== lua.LUA_OK)
            throw new Error('eval load error: ' + to_jsstring(lua.lua_tostring(L, -1)));
        if (lua.lua_pcall(L, 0, 1, 0) !== lua.LUA_OK)
            throw new Error('eval runtime error: ' + to_jsstring(lua.lua_tostring(L, -1)));
        const out = to_jsstring(lua.lua_tostring(L, -1));
        lua.lua_pop(L, 1);
        return out;
    }

    run(`
PRINTED = {}
print = function(...)
    local parts = {}
    for i = 1, select('#', ...) do parts[#parts + 1] = tostring(select(i, ...)) end
    PRINTED[#PRINTED + 1] = table.concat(parts, ' ')
end

state = {
    time = 30, desired = 0.446, reason = 'lane_lv7',
    atkTarget = nil, target = nil, probeEnabled = true,
    enemies = {}, distance = 150, hp = 0.9, mana = 0.7,
}

function MakeUnit(over)
    local u = { isHero = true, valid = true, canBeAttacked = true, alive = true, hp = 1, team = 1 }
    for k, v in pairs(over or {}) do u[k] = v end
    function u:GetTeam() return self.team end
    function u:IsAlive() return self.alive end
    function u:GetAttackTarget() return nil end
    function u:GetTarget() return nil end
    function u:GetAttackRange() return 150 end
    function u:GetHealth() return 100 end
    function u:GetHealthRegen() return 0 end
    function u:GetActualIncomingDamage(d) return d end
    function u:CanBeSeen() return true end
    return u
end

bot = {
    unitName = 'npc_dota_hero_axe', playerId = 3, pos = 3, level = 5,
    maxHealth = 1000, health = 900, maxMana = 500, mana = 350,
    attackRange = 150, team = 2, alive = true, queued = 0,
}
function bot:GetUnitName() return self.unitName end
function bot:GetPlayerID() return self.playerId end
function bot:GetTeam() return self.team end
function bot:IsAlive() return self.alive end
function bot:IsIllusion() return false end
function bot:IsHero() return true end
function bot:GetAttackTarget() return state.atkTarget end
function bot:GetTarget() return state.target end
function bot:GetNearbyHeroes() return state.enemies end
function bot:GetNearbyLaneCreeps() return {} end
function bot:GetActiveMode() return 1 end
function bot:GetActiveModeDesire() return 0.446 end
function bot:NumQueuedActions() return self.queued end
function bot:WasRecentlyDamagedByAnyHero() return false end
function bot:WasRecentlyDamagedByTower() return false end
function bot:WasRecentlyDamagedByCreep() return false end
function bot:GetHealth() return self.health end
function bot:GetMaxHealth() return self.maxHealth end
function bot:GetMana() return self.mana end
function bot:GetMaxMana() return self.maxMana end
function bot:GetLevel() return self.level end
function bot:GetAttackRange() return self.attackRange end
function bot:GetAttackDamage() return 60 end
function bot:FindItemSlot() return -1 end
function bot:GetItemSlotType() return -1 end

GetScriptDirectory = function() return '/stub' end
DotaTime = function() return state.time end
GetBot = function() return bot end
GetTeam = function() return 2 end
GetUnitToUnitDistance = function() return state.distance end
ITEM_SLOT_TYPE_MAIN = 0
DAMAGE_TYPE_PHYSICAL = 1

Customize = { Enable_Lane_Probe = state.probeEnabled }

J = {
    IsValidHero = function(u) return u ~= nil and u.isHero == true and u.valid ~= false end,
    IsSuspiciousIllusion = function(u) return u ~= nil and u.suspicious == true end,
    IsValid = function(u) return u ~= nil end,
    IsCore = function() return true end,
    GetHP = function(u) return u.hp or 1 end,
    GetPosition = function() return bot.pos end,
    CanBeAttacked = function(u) return u ~= nil and u.canBeAttacked ~= false end,
    GetAttackProDelayTime = function() return 0.1 end,
    WillKillTarget = function() return false end,
}

function require(p)
    if p == '/stub/FunLib/jmz_func' then return J end
    if p == '/stub/Customize/general' then return Customize end
    error('unexpected require: ' .. tostring(p))
end
`, '@bootstrap');

    const probeSrc = fs.readFileSync(path.join(repoRoot, 'bots/FunLib/lane_probe.lua'), 'utf8');
    run('P = (function()\n' + probeSrc + '\nend)()\n', '@lane_probe.lua');

    return { call, PRINTED: 'PRINTED' };
}

// Emits one liveness line and one sample line, then returns the sample line.
function sampleLine(h) {
    h.call('P.Note(state.desired, state.reason) return 0');
    h.call('state.time = state.time + 1 P.Note(state.desired, state.reason) return 0');
    const n = Number(h.call('return #PRINTED'));
    for (let i = n; i >= 1; i--) {
        const line = h.call('return PRINTED[' + i + ']');
        if (line.indexOf('[LANE]') === 0 && line.indexOf('probe-active') < 0 && line.indexOf('heartbeat') < 0) {
            return line;
        }
    }
    return '';
}

// Splits a probe line into its cells, dropping the '[LANE]' prefix.
//
// The probe's table.concat puts the '[LANE]' prefix in the same array as the fields,
// so the line is '<cells joined by |>' with the prefix as cell 0 and NO separator
// between it and the first field: "[LANE]bot|team|...". Splitting on '|' therefore
// yields the prefix as element 0 followed by the fields. Do not strip a leading pipe
// here -- there is none, and stripping one silently shifts every column by one.
function cellsOf(line, prefix) {
    const p = prefix || '[LANE]';
    if (line.indexOf(p) !== 0) return [];
    const parts = line.split('|');
    if (parts[0] !== p) return [];
    return parts.slice(1).map(c => c.trim());
}

module.exports = { openProbe, sampleLine, cellsOf, loadFengari };
