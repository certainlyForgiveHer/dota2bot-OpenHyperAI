--[[
lane_aggression.lua -- laning phase pressure and trading

Two responsibilities, both driven by Customize.Lane_Aggression:

  ThinkTrade()      returns true when it has committed an attack on an enemy hero.
                    Called from the laning mode's Think(), after last-hit and deny.
  MovementOffset()  returns the lane-front offset to hold, so while an enemy hero is
                    nearby the bot stands ahead of the lane front instead of retreating
                    to the far edge of the enemy's attack range.

With Customize.Lane_Aggression.Enable = false this module never returns a trade and
MovementOffset() returns the caller's original offset unchanged, so behaviour is
identical to before.

This module only issues attack and move actions that the laning mode already issues
itself; it adds no new action types and touches no ability or item logic.
]]--

local J = require( GetScriptDirectory()..'/FunLib/jmz_func' )
local Customize = require( GetScriptDirectory()..'/Customize/general' )

local M = {}

-- Defaults reproduce the pre-existing behaviour when a field is missing.
local DEFAULT = {
	Enable            = false,
	Tower_Dive        = false,
	All_Roles_Trade   = true,
	Forward_Distance  = 120,
	Trade_Range_Bonus = 150,
	Min_Hp_To_Trade   = 0.30,
	Min_Mana_To_Trade = 0.20,
	Trade_Refresh     = 0.2,
}

local function Opt(name)
	local cfg = Customize.Lane_Aggression
	if cfg ~= nil and cfg[name] ~= nil then return cfg[name] end
	return DEFAULT[name]
end

local bot = GetBot()

-- re-read the handle: ARDM / !pos hero swaps can replace the unit in place
local function Bot()
	local live = GetBot()
	if live ~= nil then bot = live end
	return bot
end

function M.Enabled()
	return Opt('Enable') and true or false
end

-- per-frame refresh throttle, so the target search does not run every frame
local lastThinkTime = -999
local cachedTarget = nil
local lastEnemyList = nil

-- auto-attacks do not consume mana, so they need no mana floor
local function HasManaForTrade()
	local bot = Bot()
	if Opt('Min_Mana_To_Trade') <= 0 then return true end
	if bot:GetMaxMana() <= 0 then return true end
	if J.IsCore(bot) then return true end
	return (bot:GetMana() / bot:GetMaxMana()) >= Opt('Min_Mana_To_Trade')
end

-- Shared tower gate: without Tower_Dive we neither trade nor hold ground while an
-- enemy tower can reach us.
local function TowerSafe()
	if Opt('Tower_Dive') then return true end
	local tEnemyTowers = Bot():GetNearbyTowers(900, true)
	return tEnemyTowers == nil or #tEnemyTowers == 0
end

local function IsTradeAllowed()
	local bot = Bot()
	if not Opt('Enable') then return false end
	if not bot:IsAlive() then return false end
	if bot:IsIllusion() or not bot:IsHero() then return false end
	if bot:IsDisarmed() then return false end
	if J.GetHP(bot) < Opt('Min_Hp_To_Trade') then return false end
	if not HasManaForTrade() then return false end
	if not Opt('All_Roles_Trade') and J.IsCore(bot) then return false end
	if not TowerSafe() then return false end
	return true
end

local function FindTradeTarget(tEnemyHeroes, nFurthestEnemyAttackRange)
	local bot = Bot()
	if tEnemyHeroes == nil then return nil end

	local attackRange = bot:GetAttackRange()
	local preferred = attackRange + Opt('Trade_Range_Bonus')
	-- hitting a target further than this means walking through the enemy's range first
	local hardLimit = preferred + math.max(150, (nFurthestEnemyAttackRange or 0) * 0.75)

	local outOfRange = nil
	for _, enemy in pairs(tEnemyHeroes) do
		if J.IsValidHero(enemy) and not J.IsSuspiciousIllusion(enemy) and J.CanBeAttacked(enemy) then
			local d = GetUnitToUnitDistance(bot, enemy)
			if d <= preferred then
				return enemy
			end
			if d <= hardLimit and outOfRange == nil then
				outOfRange = enemy
			end
		end
	end

	return outOfRange
end

--[[ Returns true when an attack on an enemy hero has been issued.
     tEnemyHeroes: heroes near the bot, as gathered by the laning mode.
     nFurthestEnemyAttackRange: the value the laning mode already computed. ]]
function M.ThinkTrade(tEnemyHeroes, nFurthestEnemyAttackRange)
	local bot = Bot()
	if not IsTradeAllowed() then
		cachedTarget = nil
		return false
	end

	local now = DotaTime()
	-- re-pick when there is no target yet, when the refresh window has passed, or when
	-- the caller handed us a different hero list
	if cachedTarget == nil
	or tEnemyHeroes ~= lastEnemyList
	or now - lastThinkTime >= Opt('Trade_Refresh') then
		lastThinkTime = now
		lastEnemyList = tEnemyHeroes
		cachedTarget = FindTradeTarget(tEnemyHeroes, nFurthestEnemyAttackRange)
	end

	local target = cachedTarget
	if not J.IsValidHero(target) or not target:IsAlive() or not J.CanBeAttacked(target) then
		cachedTarget = nil
		return false
	end

	local d = GetUnitToUnitDistance(bot, target)
	local attackRange = bot:GetAttackRange()
	if d > attackRange then
		bot:Action_MoveToUnit(target)
	else
		bot:SetTarget(target)
		bot:Action_AttackUnit(target, true)
	end

	return true
end

-- How strongly to press forward right now. 0 keeps the caller's safe position.
local function Forwardness(tEnemyHeroes)
	local bot = Bot()
	if not Opt('Enable') then return 0 end
	if tEnemyHeroes == nil or #tEnemyHeroes == 0 then return 0 end
	if not J.IsInLaningPhase() then return 0 end
	if J.GetHP(bot) < Opt('Min_Hp_To_Trade') then return 0 end
	return 1
end

--[[ Returns the lane-front offset to hold this frame.
     nSafeOffset: the offset the laning mode would use on its own (negative = pulled
                  back behind the lane front, i.e. away from the enemy).

     While an enemy hero is nearby and it is safe to press, the offset is replaced by
     +Forward_Distance, which places the bot ahead of the lane front instead of behind
     it. Forward_Distance is the single knob for how far up the lane the bot stands.

     Why not compare the two offsets: they are measured from different lane fronts
     (the safe one from the caller's front, the forward one from the enemy-side front),
     so their magnitudes are not comparable. The choice is a plain either/or. ]]
function M.MovementOffset(nSafeOffset, tEnemyHeroes)
	local bot = Bot()
	if Forwardness(tEnemyHeroes) <= 0 then return nSafeOffset end
	if not TowerSafe() then return nSafeOffset end
	return Opt('Forward_Distance')
end

return M
