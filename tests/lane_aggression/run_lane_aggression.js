// Offline checks for bots/FunLib/lane_aggression.lua.
//
// Runs the module inside a real Lua VM (fengari) with a stubbed Dota API, so the
// switch equivalence and the lane-front offset maths can be asserted without
// launching Dota. This is a development tool: nothing here is loaded by the game.
//
// Setup (once):
//   mkdir -p tests/.deps && cd tests/.deps && npm install fengari --no-audit --no-fund
// Run from the repository root:
//   node tests/lane_aggression/run_lane_aggression.js .
//
// The module under test is pure Lua reading only these APIs, so the stub surface is
// small on purpose. If lane_aggression.lua starts calling a new bot or J helper, add
// it to the bootstrap below and to the matching test.

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

const fengari = loadFengari();

const { lua, lauxlib, lualib, to_luastring, to_jsstring } = fengari;
const ROOT = process.argv[2] || '.';
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);

function run(src, name) {
    if (lauxlib.luaL_loadbuffer(L, to_luastring(src), null, to_luastring(name)) !== lua.LUA_OK)
        throw new Error('load error in ' + name + ': ' + to_jsstring(lua.lua_tostring(L, -1)));
    if (lua.lua_pcall(L, 0, 0, 0) !== lua.LUA_OK)
        throw new Error('runtime error in ' + name + ': ' + to_jsstring(lua.lua_tostring(L, -1)));
}
function call(src) {
    if (lauxlib.luaL_loadbuffer(L, to_luastring(src), null, to_luastring('@test')) !== lua.LUA_OK)
        throw new Error('test load error: ' + to_jsstring(lua.lua_tostring(L, -1)));
    if (lua.lua_pcall(L, 0, 1, 0) !== lua.LUA_OK)
        throw new Error('test runtime error: ' + to_jsstring(lua.lua_tostring(L, -1)));
    const out = to_jsstring(lua.lua_tostring(L, -1));
    lua.lua_pop(L, 1);
    return out;
}

run(`
function MakeBot(over)
    local b = {
        hp = 1, manaFrac = 1, alive = true, illusion = false, hero = true,
        disarmed = false, towerCount = 0, attackRange = 200, maxMana = 500,
        attacks = 0, moveToUnit = 0, moves = 0, target = nil,
    }
    for k, v in pairs(over or {}) do b[k] = v end
    function b:IsAlive() return self.alive end
    function b:IsIllusion() return self.illusion end
    function b:IsHero() return self.hero end
    function b:IsDisarmed() return self.disarmed end
    function b:GetNearbyTowers() local t = {} for i = 1, self.towerCount do t[i] = {} end return t end
    function b:GetAttackRange() return self.attackRange end
    function b:GetMaxMana() return self.maxMana end
    function b:GetMana() return self.manaFrac * self.maxMana end
    function b:SetTarget(t) self.target = t end
    function b:Action_AttackUnit() self.attacks = self.attacks + 1 end
    function b:Action_MoveToUnit() self.moveToUnit = self.moveToUnit + 1 end
    function b:Action_MoveToLocation() self.moves = self.moves + 1 end
    return b
end
function MakeHero(over)
    local h = { isHero = true, valid = true, canBeAttacked = true, alive = true, hp = 1 }
    for k, v in pairs(over or {}) do h[k] = v end
    function h:IsAlive() return self.alive end
    return h
end
state = { bot = MakeBot(), enemies = {}, core = false, inLaningPhase = true,
          dist = 150, time = 0, customize = { Lane_Aggression = { Enable = false } } }
out = {}
function put(k, v) out[#out + 1] = k .. '=' .. tostring(v) end
function setBot(over) state.bot = MakeBot(over) end
GetScriptDirectory = function() return '/stub' end
DotaTime = function() return state.time end
GetTeam = function() return 0 end
GetOpposingTeam = function() return 1 end
BOT_MODE_NONE = 0
DAMAGE_TYPE_PHYSICAL = 1
ITEM_SLOT_TYPE_MAIN = 0
GetBot = function() return state.bot end
GetUnitToUnitDistance = function() return state.dist end
GetUnitToLocationDistance = function() return 0 end
GetLaneFrontLocation = function(team, lane, off) return { team = team, off = off } end
Customize = state.customize
J = {
    IsCore = function() return state.core end,
    IsInLaningPhase = function() return state.inLaningPhase end,
    GetHP = function(u) return u.hp end,
    IsValidHero = function(u) return u ~= nil and u.isHero == true and u.valid ~= false end,
    IsSuspiciousIllusion = function(u) return u ~= nil and u.suspicious == true end,
    CanBeAttacked = function(u) return u ~= nil and u.canBeAttacked ~= false end,
}
function require(p)
    if p == '/stub/FunLib/jmz_func' then return J end
    if p == '/stub/Customize/general' then return Customize end
    error('unexpected require: ' .. tostring(p))
end
`, '@bootstrap');

const modSrc = fs.readFileSync(path.join(ROOT, 'bots/FunLib/lane_aggression.lua'), 'utf8');
run('A = (function()\n' + modSrc + '\nend)()\n', '@lane_aggression.lua');

const PHASES = [
`state.customize.Lane_Aggression.Enable = false
setBot({ hp = 1 })
state.enemies = { MakeHero({}) }
put('off_enabled', A.Enabled())
put('off_trade', A.ThinkTrade(state.enemies, 400))
put('off_offset', A.MovementOffset(-250, state.enemies, 1))
return table.concat(out, ',')`,

`state.customize.Lane_Aggression.Enable = true
put('on_enabled', A.Enabled())
put('on_offset', A.MovementOffset(-250, state.enemies, 1))
state.enemies = {}
put('no_enemy_offset', A.MovementOffset(-250, state.enemies, 1))
return table.concat(out, ',')`,

`state.enemies = { MakeHero({}) }
put('small_safe_offset', A.MovementOffset(-50, state.enemies, 1))
state.bot = MakeBot({ hp = 1, towerCount = 1 })
put('push_blocked_by_tower', A.MovementOffset(-250, state.enemies, 1))
state.bot = MakeBot({ hp = 1 })
state.inLaningPhase = false
put('post_laning', A.MovementOffset(-250, state.enemies, 1))
state.inLaningPhase = true
setBot({ hp = 0.1 })
put('low_hp', A.MovementOffset(-250, state.enemies, 1))
return table.concat(out, ',')`,

`setBot({ hp = 1, attackRange = 200 })
state.enemies = { MakeHero({}) }
state.dist = 150
put('trade_in_range', A.ThinkTrade(state.enemies, 400))
put('trade_attacks', state.bot.attacks)
setBot({ hp = 1, attackRange = 200 })
state.dist = 300
put('trade_move', A.ThinkTrade(state.enemies, 400))
put('trade_moves', state.bot.moveToUnit)
put('trade_attacks_far', state.bot.attacks)
return table.concat(out, ',')`,

`setBot({ hp = 1, attackRange = 200, towerCount = 1 })
state.dist = 150
put('tower_block', A.ThinkTrade(state.enemies, 400))
state.customize.Lane_Aggression.Tower_Dive = true
put('tower_dive', A.ThinkTrade(state.enemies, 400))
put('tower_dive_attacks', state.bot.attacks)
state.customize.Lane_Aggression.Tower_Dive = false
setBot({ hp = 1, attackRange = 200 })   -- back to open ground for the role test
state.core = true
state.customize.Lane_Aggression.All_Roles_Trade = false
put('core_block', A.ThinkTrade(state.enemies, 400))
state.customize.Lane_Aggression.All_Roles_Trade = true
state.time = state.time + 1  -- let the target refresh window pass
put('core_allowed', A.ThinkTrade(state.enemies, 400))
state.core = false
setBot({ hp = 1, attackRange = 200, illusion = true })
put('illusion', A.ThinkTrade(state.enemies, 400))
return table.concat(out, ',')`,

`state.customize.Lane_Aggression = nil
state.bot = MakeBot({ hp = 1 })
state.enemies = { MakeHero({}) }
put('nil_cfg_enabled', A.Enabled())
put('nil_cfg_trade', A.ThinkTrade(state.enemies, 400))
put('nil_cfg_offset', A.MovementOffset(-250, state.enemies, 1))
return table.concat(out, ',')`,
];

const got = {};
PHASES.forEach(function (chunk) {
    call(chunk).split(',').forEach(function (kv) {
        const i = kv.indexOf('=');
        got[kv.slice(0, i)] = kv.slice(i + 1);
    });
});

let failures = 0;
function check(name, expected, actual) {
    const ok = String(expected) === String(actual);
    if (!ok) failures++;
    console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok ? '' : '  expected=' + expected + ' actual=' + actual));
}
check('switch off -> Enabled() false', 'false', got.off_enabled);
check('switch off -> ThinkTrade returns false', 'false', got.off_trade);
check('switch off -> MovementOffset unchanged', '-250', got.off_offset);
check('switch on -> Enabled() true', 'true', got.on_enabled);
check('switch on + enemy -> pushes Forward_Distance past the front', '120', got.on_offset);
check('switch on, no enemy -> unchanged', '-250', got.no_enemy_offset);
check('switch on + enemy -> offset replaced regardless of safe value', '120', got.small_safe_offset);
check('enemy tower reachable, Tower_Dive off -> no push', '-250', got.push_blocked_by_tower);
check('after laning phase -> unchanged', '-250', got.post_laning);
check('low HP -> unchanged', '-250', got.low_hp);
check('trade in range -> returns true', 'true', got.trade_in_range);
check('trade in range -> exactly one attack issued', '1', got.trade_attacks);
check('trade out of reach -> returns true (moves closer)', 'true', got.trade_move);
check('trade out of reach -> move issued', '1', got.trade_moves);
check('trade out of reach -> no attack yet', '0', got.trade_attacks_far);
check('enemy tower present, Tower_Dive off -> blocked', 'false', got.tower_block);
check('enemy tower present, Tower_Dive on -> allowed', 'true', got.tower_dive);
check('Tower_Dive on -> attack issued', '1', got.tower_dive_attacks);
check('core blocked when All_Roles_Trade off', 'false', got.core_block);
check('core allowed when All_Roles_Trade on', 'true', got.core_allowed);
check('illusion never trades', 'false', got.illusion);
check('missing config -> defaults to off', 'false', got.nil_cfg_enabled);
check('missing config -> no trade', 'false', got.nil_cfg_trade);
check('missing config -> offset unchanged', '-250', got.nil_cfg_offset);
console.log('');
console.log(failures === 0 ? 'ALL ' + Object.keys(got).length + ' CHECKS PASSED' : failures + ' CHECK(S) FAILED');
process.exit(failures ? 1 : 0);
