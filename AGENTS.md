# Dota 2 Bot Scripts - Agent Guide

This is the shared project instruction file for coding agents. It applies to the entire repository; more specific nested `AGENTS.md` files may refine instructions for their directories.

## Project Overview

This is the **dota2bot-OpenHyperAI** project -- Lua bot scripts for Dota 2 that run in custom lobbies. The existing project documentation records Patch 7.41/7.41a support and 127 heroes. Treat these as repository claims, not proof of compatibility with the latest live game patch; verify the relevant code and game data when updating behavior.

## Key Documentation

- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** -- Complete codebase architecture, file map, naming conventions, all systems explained
- **[docs/PATCH_UPDATE_GUIDE.md](docs/PATCH_UPDATE_GUIDE.md)** -- Step-by-step runbook for updating when a new Dota 2 patch drops

**Read these docs FIRST before making any changes.** Use them to locate relevant code before a targeted inspection. Documentation can lag behind implementation: check actual source files and resolve conflicting examples against version-matched game data before changing behavior.

## Common Tasks

### Check for New Patches

To check if there are patches we haven't updated for:
1. Fetch `https://www.dota2.com/datafeed/patchnoteslist?language=english`
2. Compare latest version against "Last updated for" in `docs/PATCH_UPDATE_GUIDE.md`
3. If newer patch exists, follow the update process below

### Patch Update (most common)

When user says "update for patch X.XX" or provides patch notes:

1. Read `docs/PATCH_UPDATE_GUIDE.md` for the step-by-step process
2. Fetch patch data: `https://www.dota2.com/datafeed/patchnotes?version=X.XX&language=english`
3. Fetch d2vpkr data (shops.txt, neutral_items.txt) for authoritative item/ability names
4. **Categorize changes**: STRUCTURAL (need code) vs NUMBER-ONLY (game API handles) vs TALENT SWAPS
5. **Always verify ability names on Liquipedia** -- patch note summaries can be wrong
6. Follow the checklist in order: items -> hero builds -> abilities -> neutrals -> actives -> map changes
7. **Always update TS sources** for any TS-generated Lua files changed (see ARCHITECTURE.md Section 13)

### Add a New Hero

1. Copy a similar existing hero from `bots/BotLib/` as template
2. Update `bots/FretBots/HeroNames.lua`, the role map source `typescript/bots/FunLib/aba_hero_roles_map.ts`, and `bots/FunLib/spell_list.lua`; update `typescript/bots/ts_libs/dota/heroes.ts` when adding a new hero enum value
3. See "New Heroes" section in `docs/PATCH_UPDATE_GUIDE.md`

### Fix a Hero's Item Build

1. Read `bots/BotLib/hero_[name].lua`
2. Edit the `sRoleItemsBuyList['pos_N']` arrays
3. Items use `item_[internal_name]` format -- check `FunLib/aba_item.lua` for valid names

### Fix a Hero's Ability Logic

1. Read `bots/BotLib/hero_[name].lua`
2. The `SkillsComplement()` function controls ability casting priority
3. Each ability has a `ConsiderX()` function returning desire + target
4. See "Skill / Ability System" in `docs/ARCHITECTURE.md`

## Important Rules

- **Use `GetItemComponents()` for item recipes** -- don't hardcode component arrays
- **Use `sAbilityList[N]` references** when possible -- resilient to ability renames
- **Always update BOTH neutral item files** (Buff/ AND FretBots/)
- **Verify on Liquipedia** before trusting patch note summaries about ability names
- **Test in-game** after changes -- some things can only be verified at runtime


## Source Ownership and Architecture

- `bots/` contains the Lua scripts loaded by Dota 2, targeting Lua 5.1. Game globals such as `GetBot()` and `GetScriptDirectory()` require the game runtime.
- `bots/BotLib/` holds hero builds and casting decisions; `bots/mode_*_generic.lua` implements behavior modes; `bots/FunLib/` holds shared logic. `bots/FretBots/` and `bots/Buff/` implement separate enhancement systems.
- Before editing any `bots/<path>.lua`, check for `typescript/bots/<path>.ts`. If an implementation exists, edit TypeScript first and regenerate Lua. Most hero scripts are handwritten Lua, but exceptions exist: `typescript/bots/BotLib/hero_wisp.ts` generates the Wisp script. Do not assume every hero file is handwritten.
- A `.d.ts` file is only a type declaration, not a Lua-generating implementation. In particular, edit `bots/FunLib/jmz_func.lua` directly and update `typescript/bots/FunLib/jmz_func.d.ts` when its TS-facing API changes.
- For TypeScript module imports, follow the existing `bots/`-rooted paths. The Lua build post-process rewrites these to `GetScriptDirectory()` paths; do not bypass this step.
- `bots/Customize/` provides user overrides; `game/Customize/` is the deployment location for permanent customization described in the README, and is not currently present in this checkout.

## Build and Verification

Run commands from the repository root; see `package.json` for the current scripts.

- `npm run build:lua` (also `npm run build`): compile TypeScript to Lua and run the import-path post-process. Use after changing Lua-generating TypeScript; inspect generated diffs for unrelated changes.
- `npm run build:node`: compile the TypeScript maintenance tools in `typescript/post-process/` to `dist/`. Use when changing those tools.
- `npm run dev`: watch and compile with TSTL; unlike `build:lua`, this script does not run the import-path post-process.
- There is currently no `npm test` script. Use relevant static/syntax checks where available, then test behavior changes in a Dota 2 custom lobby. Compilation alone does not establish gameplay correctness.
- `npm run release` updates the version, builds, and formats broadly; `npm run prettier` writes across `bots/` and `typescript/`. Use these only when their broader effects are part of the task.
- For documentation-only edits, verify links, referenced paths, and `git diff --check`; a game run is unnecessary.
- Report exactly which checks ran and their results. If an in-game test cannot be performed, state that gameplay validation remains outstanding.
- Preserve pre-existing user changes and keep edits scoped to the requested task.

## Version Control and Commit Attribution

This checkout can inherit an unrelated global git identity (for example an employer address). Set this repository's GitHub identity locally before committing:

```bash
git config --local user.name certainlyForgiveHer
git config --local user.email 28551039+certainlyForgiveHer@users.noreply.github.com
```

Every commit produced by an AI coding agent must end with a bracketed agent-name trailer on the final line:

```
<subject>

<body>

[dsh]
```

Use the short name of the agent that made the commit -- `[dsh]` for DeepSeek Harness. Human-authored commits carry no trailer. Keep it as a plain bracketed line rather than a `Co-Authored-By:` trailer, so attribution stays independent of any single tool's format.
