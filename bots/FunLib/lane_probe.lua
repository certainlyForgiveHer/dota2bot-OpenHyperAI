--[[
lane_probe.lua -- read-only laning probe (no behaviour change)

Purpose: answer WHY bots play passively in lane, before changing anything.
It only reads state and prints one line per sample to the console.

Enable:  Customize.Enable_Lane_Probe = true   (bots/Customize/general.lua)
Disable: false / nil  -> the module does nothing at all.

Sample line format (pipe separated), columns in order:
  [LANE] bot|sampleIndex|team|pos|gameTime|activeMode|activeDesire|queueDepth|
         dmgHero|dmgTower|dmgCreep|enemyHeroes|allyHeroes|enemyCreeps800|enemyCreeps600|
         creepTargetingMe|heroesTargetingMe|hp|mana|lvl|atkRange|distNearestEnemy|
         hasLastHit|hasDeny|isCore|atkHero|tgtHero|deaths|desire|reason

atkHero/tgtHero: 1 when the bot's attack target (tgtHero: general target) is an enemy
                 hero. This is the direct evidence of attacking will; desire alone
                 cannot show whether the bot actually engaged.
deaths: cumulative deaths counted by this bot's probe instance.

This list must stay in sync with the table.concat below and with COLUMNS in
 tests/lane_probe/analyze_lane_log.js. A mismatch shows up there as "malformed".

reason tells which branch of mode_laning_generic.GetDesire() decided the outcome.
]]--

local J = require( GetScriptDirectory()..'/FunLib/jmz_func' )
local Customize = require( GetScriptDirectory()..'/Customize/general' )

local M = {}

local SAMPLE_INTERVAL = 0.5   -- seconds between samples per bot
local LOG_INTERVAL    = 5.0   -- seconds between heartbeat logs when no lane data

local bot     = GetBot()
local botName = bot:GetUnitName()

local lastSampleTime = -999
local lastLogTime    = -999
local sampleIndex    = 0
local announced      = false
local deathCount     = 0
local wasAlive       = true
-- stagger bots so 5 heroes do not sample on the exact same frame
local phaseOffset    = (bot:GetPlayerID() or 0) * 0.1

local function b(v)
	if v then return 1 end
	return 0
end

-- Is this unit an enemy hero worth counting as a trade target?
local function IsEnemyHero(unit)
	local liveBot = GetBot()
	if unit == nil then return false end
	if unit == liveBot then return false end
	if not J.IsValidHero(unit) then return false end
	if J.IsSuspiciousIllusion(unit) then return false end
	return unit:GetTeam() ~= liveBot:GetTeam()
end

-- Is the bot currently pointing its attack (or its general target) at an enemy hero?
-- This is the direct evidence of "attacking will" that desire alone cannot show.
local function TargetIsEnemyHero(getter)
	local unit = getter(bot)
	return b(IsEnemyHero(unit))
end

local function fmt(v)
	if v == nil then return 'nil' end
	return string.format('%.2f', v)
end

-- Quelling-blade-adjusted attack damage (mirrors the laning mode's own calculation)
local function AdjustedAttackDamage()
	local dmg = bot:GetAttackDamage()
	if bot:GetItemSlotType(bot:FindItemSlot("item_quelling_blade")) == ITEM_SLOT_TYPE_MAIN then
		if bot:GetAttackRange() > 310 or bot:GetUnitName() == "npc_dota_hero_templar_assassin" then
			dmg = dmg + 4
		else
			dmg = dmg + 8
		end
	end
	return dmg
end

-- Is a last hit available right now? Same rule the laning mode uses.
local function FindLastHitCreep(creepList)
	if creepList == nil then return nil end
	local dmg = AdjustedAttackDamage()
	for _, creep in pairs(creepList) do
		if J.IsValid(creep) and J.CanBeAttacked(creep) then
			local nDelay = J.GetAttackProDelayTime(bot, creep)
			if J.WillKillTarget(creep, dmg, DAMAGE_TYPE_PHYSICAL, nDelay) then
				return creep
			end
		end
	end
	return nil
end

-- Nearest enemy hero distance (uses the game API, same source as hero logic)
local function NearestEnemyDistance()
	local h = bot:GetNearbyHeroes(1600, true, BOT_MODE_NONE)
	if h == nil or #h == 0 then return -1 end
	local best = -1
	for _, e in pairs(h) do
		if J.IsValidHero(e) and not J.IsSuspiciousIllusion(e) then
			local d = GetUnitToUnitDistance(bot, e)
			if best < 0 or d < best then best = d end
		end
	end
	return best
end

-- Called from mode_laning_generic.GetDesire().
-- desire: the value about to be returned. reason: which branch produced it.
function M.Note(desire, reason)
	local now = DotaTime()

	-- one confirmation line per hero, so a silent probe is easy to diagnose
	if not announced then
		announced = true
		print('[LANE] probe-active|'..botName..'|playerId|'..tostring(bot:GetPlayerID())..'|t|'..fmt(now))
	end

	-- re-read the handle: ARDM / !pos hero swaps can replace the unit in place
	local liveBot = GetBot()
	if liveBot ~= nil then
		bot = liveBot
		botName = bot:GetUnitName()
	end

	-- count deaths from the alive -> dead transition (sampled per frame, before the
	-- throttle below, so a death between two samples is not missed)
	local aliveNow = bot:IsAlive()
	if wasAlive and not aliveNow then deathCount = deathCount + 1 end
	wasAlive = aliveNow

	-- per-bot throttle with a small stagger so all five heroes do not sample at once
	if now - lastSampleTime < SAMPLE_INTERVAL + phaseOffset then return end
	lastSampleTime = now

	sampleIndex = sampleIndex + 1

	local enemyHeroes = bot:GetNearbyHeroes(1600, true, BOT_MODE_NONE)
	local allyHeroes  = bot:GetNearbyHeroes(1600, false, BOT_MODE_NONE)
	local enemyCreeps800 = bot:GetNearbyLaneCreeps(800, true)
	local enemyCreeps600 = bot:GetNearbyLaneCreeps(600, true)

	local nEnemyHeroes = 0
	if enemyHeroes ~= nil then
		for _, e in pairs(enemyHeroes) do
			if J.IsValidHero(e) and not J.IsSuspiciousIllusion(e) then nEnemyHeroes = nEnemyHeroes + 1 end
		end
	end
	local nAllyHeroes = 0
	if allyHeroes ~= nil then
		for _, a in pairs(allyHeroes) do
			if J.IsValidHero(a) then nAllyHeroes = nAllyHeroes + 1 end
		end
	end

	local nEnemyCreeps800 = 0
	if enemyCreeps800 ~= nil then nEnemyCreeps800 = #enemyCreeps800 end
	local nEnemyCreeps600 = 0
	if enemyCreeps600 ~= nil then nEnemyCreeps600 = #enemyCreeps600 end

	-- creep aggro on us + how many heroes are targeting us
	local creepTargetingMe = 0
	if enemyCreeps800 ~= nil then
		for _, c in pairs(enemyCreeps800) do
			if J.IsValid(c) and c:GetAttackTarget() == bot then creepTargetingMe = creepTargetingMe + 1 end
		end
	end
	local targetingMe = 0
	if enemyHeroes ~= nil then
		for _, e in pairs(enemyHeroes) do
			if J.IsValidHero(e) and e:GetAttackTarget() == bot then targetingMe = targetingMe + 1 end
		end
	end

	-- last-hit / deny availability (same rules the laning mode uses)
	local hasLastHit = 0
	local hitCreep = FindLastHitCreep(enemyCreeps800)
	if J.IsValid(hitCreep) then
		hasLastHit = 1
	end

	local hasDeny = 0
	local allyCreeps = bot:GetNearbyLaneCreeps(800, false)
	if allyCreeps ~= nil then
		for _, c in pairs(allyCreeps) do
			if J.IsValid(c) and J.GetHP(c) < 0.49 and c:GetHealth() <= bot:GetAttackDamage() then
				hasDeny = 1
				break
			end
		end
	end

	local hp   = bot:GetMaxHealth() > 0 and (bot:GetHealth() / bot:GetMaxHealth()) or 0
	local mana = bot:GetMaxMana() > 0 and (bot:GetMana() / bot:GetMaxMana()) or 0

	-- Built by explicit concatenation rather than table.concat: the prefix and the
-- fields are different things, and keeping them in one array made the emitted
-- column count depend on how the prefix was joined (a dropped first element
-- shifts every column by one).
	local line = '[LANE]'
		.. '|' .. botName
		.. '|' .. tostring(sampleIndex)
		.. '|' .. tostring(GetTeam())
		.. '|' .. tostring(J.GetPosition(bot))
		.. '|' .. fmt(DotaTime())
		.. '|' .. tostring(bot:GetActiveMode())
		.. '|' .. fmt(bot:GetActiveModeDesire())
		.. '|' .. tostring(bot:NumQueuedActions())
		.. '|' .. tostring(b(bot:WasRecentlyDamagedByAnyHero(2.0)))
		.. '|' .. tostring(b(bot:WasRecentlyDamagedByTower(2.0)))
		.. '|' .. tostring(b(bot:WasRecentlyDamagedByCreep(2.0)))
		.. '|' .. tostring(nEnemyHeroes)
		.. '|' .. tostring(nAllyHeroes)
		.. '|' .. tostring(nEnemyCreeps800)
		.. '|' .. tostring(nEnemyCreeps600)
		.. '|' .. tostring(creepTargetingMe)
		.. '|' .. tostring(targetingMe)
		.. '|' .. fmt(hp)
		.. '|' .. fmt(mana)
		.. '|' .. tostring(bot:GetLevel())
		.. '|' .. tostring(bot:GetAttackRange())
		.. '|' .. fmt(NearestEnemyDistance())
		.. '|' .. tostring(hasLastHit)
		.. '|' .. tostring(hasDeny)
		.. '|' .. tostring(b(J.IsCore(bot)))
		.. '|' .. tostring(TargetIsEnemyHero(function(u) return u:GetAttackTarget() end))
		.. '|' .. tostring(TargetIsEnemyHero(function(u) return u:GetTarget() end))
		.. '|' .. tostring(deathCount)
		.. '|' .. fmt(desire)
		.. '|' .. tostring(reason)

	print(line)
	lastLogTime = DotaTime()
end

-- Optional periodic tag, usable from any per-frame entry point as a liveness check.
function M.Heartbeat(tag)
	local now = DotaTime()
	if now - lastLogTime < LOG_INTERVAL then return end
	lastLogTime = now
	print('[LANE] heartbeat|'..botName..'|'..tostring(tag)..'|'..fmt(now))
end

function M.Enabled()
	if Customize == nil then return false end
	return Customize.Enable_Lane_Probe and true or false
end

return M
