import type { Bot } from "mineflayer";
import type { Item } from "prismarine-item";
import type { ArmorSummary, EquipmentSummary, FoodItemSummary, InventorySummary, ToolSummary } from "./types";

type FoodData = {
  foodPoints?: number;
  saturation?: number;
};

const KNOWN_FOOD_NAMES = new Set<string>([
  "bread",
  "apple",
  "cooked_beef",
  "cooked_porkchop",
  "cooked_chicken",
  "cooked_mutton",
  "cooked_rabbit",
  "baked_potato",
  "carrot",
  "potato",
  "golden_apple",
  "cooked_cod",
  "cooked_salmon"
]);

const TOOL_KEYWORDS = ["pickaxe", "axe", "shovel", "hoe", "shears", "fishing_rod", "flint_and_steel"];
const WEAPON_KEYWORDS = ["sword", "bow", "crossbow", "trident"];
const ARMOR_KEYWORDS = ["helmet", "chestplate", "leggings", "boots"];

const IMPORTANT_MATERIALS = [
  "coal",
  "iron_ingot",
  "copper_ingot",
  "gold_ingot",
  "diamond",
  "emerald",
  "redstone",
  "lapis_lazuli",
  "cobblestone",
  "dirt",
  "oak_log",
  "spruce_log",
  "birch_log",
  "planks"
];

const TOOL_MATERIAL_RANK: Record<string, number> = {
  wooden: 1,
  golden: 2,
  stone: 3,
  iron: 4,
  diamond: 5,
  netherite: 6
};

function getFoodsByName(bot: Bot): Record<string, FoodData> {
  const registry = bot.registry as unknown as {
    foodsByName?: Record<string, FoodData>;
  };
  return registry.foodsByName ?? {};
}

function isFoodByRegistry(bot: Bot, itemName: string): boolean {
  const foodsByName = getFoodsByName(bot);
  return Boolean(foodsByName[itemName]);
}

function addCount(map: Map<string, number>, name: string, count: number): void {
  map.set(name, (map.get(name) ?? 0) + count);
}

function getInventoryItems(bot: Bot): Item[] {
  return bot.inventory?.items?.() ?? [];
}

function extractMaterialRank(itemName: string): number {
  const lower = itemName.toLowerCase();
  for (const [material, rank] of Object.entries(TOOL_MATERIAL_RANK)) {
    if (lower.startsWith(`${material}_`)) {
      return rank;
    }
  }
  return 0;
}

function findBestTool(items: Item[], suffix: string): Item | null {
  const matches = items.filter((item) => item.name.endsWith(suffix));
  if (matches.length === 0) return null;

  matches.sort((a, b) => {
    const rankDiff = extractMaterialRank(b.name) - extractMaterialRank(a.name);
    if (rankDiff !== 0) return rankDiff;
    return b.count - a.count;
  });

  return matches[0] ?? null;
}

function findBestArmorPiece(items: Item[], suffix: string): Item | null {
  const matches = items.filter((item) => item.name.endsWith(suffix));
  if (matches.length === 0) return null;

  matches.sort((a, b) => extractMaterialRank(b.name) - extractMaterialRank(a.name));
  return matches[0] ?? null;
}

function matchesAnyKeyword(name: string, keywords: string[]): boolean {
  return keywords.some((keyword) => name.includes(keyword));
}

function isImportantMaterial(name: string): boolean {
  if (IMPORTANT_MATERIALS.includes(name)) return true;
  if (name.endsWith("_log")) return true;
  if (name.endsWith("_planks")) return true;
  return false;
}

function getFoodQuality(bot: Bot, item: Item): number {
  const foodsByName = getFoodsByName(bot);
  const foodMeta = foodsByName[item.name];
  if (foodMeta) {
    const points = Number.isFinite(foodMeta.foodPoints) ? Number(foodMeta.foodPoints) : 0;
    const saturation = Number.isFinite(foodMeta.saturation) ? Number(foodMeta.saturation) : 0;
    return points * 3 + saturation;
  }

  if (item.name.includes("golden_apple")) return 100;
  if (item.name.startsWith("cooked_")) return 30;
  return 10;
}

export function isFoodItem(bot: Bot, item: Item | null | undefined): item is Item {
  if (!item || !item.name) return false;
  const name = item.name.toLowerCase();
  if (KNOWN_FOOD_NAMES.has(name)) return true;
  if (isFoodByRegistry(bot, name)) return true;
  return false;
}

export function getHeldItem(bot: Bot): string | null {
  return bot.heldItem?.name ?? null;
}

export function getFoodItems(bot: Bot): FoodItemSummary[] {
  const slots = getInventoryItems(bot);
  const counts = new Map<string, number>();

  for (const item of slots) {
    if (!isFoodItem(bot, item)) continue;
    addCount(counts, item.name, item.count);
  }

  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export function getTools(bot: Bot): string[] {
  const unique = new Set<string>();
  for (const item of getInventoryItems(bot)) {
    if (matchesAnyKeyword(item.name, TOOL_KEYWORDS)) {
      unique.add(item.name);
    }
  }
  return Array.from(unique).sort();
}

export function getBestPickaxe(bot: Bot): Item | null {
  return findBestTool(getInventoryItems(bot), "_pickaxe");
}

export function getBestShovel(bot: Bot): Item | null {
  return findBestTool(getInventoryItems(bot), "_shovel");
}

export function getBestAxe(bot: Bot): Item | null {
  return findBestTool(getInventoryItems(bot), "_axe");
}

export function getBestWeapon(bot: Bot): Item | null {
  const items = getInventoryItems(bot);

  const bestSword = findBestTool(items, "_sword");
  if (bestSword) return bestSword;

  const trident = items.find((item) => item.name === "trident");
  if (trident) return trident;

  const bow = items.find((item) => item.name === "bow" || item.name === "crossbow");
  return bow ?? null;
}

export function getArmorSummary(bot: Bot): ArmorSummary {
  const items = getInventoryItems(bot);
  return {
    head: findBestArmorPiece(items, "_helmet")?.name ?? null,
    torso: findBestArmorPiece(items, "_chestplate")?.name ?? null,
    legs: findBestArmorPiece(items, "_leggings")?.name ?? null,
    feet: findBestArmorPiece(items, "_boots")?.name ?? null
  };
}

export function getToolSummary(bot: Bot): ToolSummary {
  return {
    pickaxe: getBestPickaxe(bot)?.name ?? null,
    shovel: getBestShovel(bot)?.name ?? null,
    axe: getBestAxe(bot)?.name ?? null,
    weapon: getBestWeapon(bot)?.name ?? null
  };
}

export function getEquipmentSummary(bot: Bot): EquipmentSummary {
  return {
    heldItem: getHeldItem(bot),
    tools: getToolSummary(bot),
    armor: getArmorSummary(bot)
  };
}

export function getInventorySummary(bot: Bot): InventorySummary {
  const allSlots = bot.inventory?.slots ?? [];
  const totalSlots = allSlots.length;
  const usedSlots = allSlots.filter((slot): slot is Item => slot !== null).length;
  const emptySlots = Math.max(totalSlots - usedSlots, 0);
  const heldItem = getHeldItem(bot);

  let foodCount = 0;
  let toolCount = 0;
  let weaponCount = 0;
  let armorCount = 0;
  const importantMaterialsMap = new Map<string, number>();

  for (const item of getInventoryItems(bot)) {
    const name = item.name.toLowerCase();
    const count = item.count;

    if (isFoodItem(bot, item)) {
      foodCount += count;
    }
    if (matchesAnyKeyword(name, TOOL_KEYWORDS)) {
      toolCount += count;
    }
    if (matchesAnyKeyword(name, WEAPON_KEYWORDS)) {
      weaponCount += count;
    }
    if (matchesAnyKeyword(name, ARMOR_KEYWORDS)) {
      armorCount += count;
    }
    if (isImportantMaterial(name)) {
      addCount(importantMaterialsMap, name, count);
    }
  }

  const importantMaterials = Array.from(importantMaterialsMap.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8)
    .reduce<Record<string, number>>((acc, [name, count]) => {
      acc[name] = count;
      return acc;
    }, {});

  return {
    totalSlots,
    usedSlots,
    emptySlots,
    heldItem,
    foodCount,
    toolCount,
    weaponCount,
    armorCount,
    importantMaterials,
    foodItems: getFoodItems(bot)
  };
}

export function pickBestFoodItem(bot: Bot, preferredName?: string): Item | null {
  const inventoryItems = getInventoryItems(bot);
  const foods = inventoryItems.filter((item): item is Item => isFoodItem(bot, item));
  if (foods.length === 0) return null;

  if (preferredName) {
    const normalized = preferredName.trim().toLowerCase();
    const direct = foods.find((item) => item.name.toLowerCase() === normalized);
    if (direct) return direct;
  }

  foods.sort((a, b) => {
    const qualityDiff = getFoodQuality(bot, b) - getFoodQuality(bot, a);
    if (qualityDiff !== 0) return qualityDiff;
    return b.count - a.count;
  });

  return foods[0] ?? null;
}

export function hasFoodAvailable(bot: Bot): boolean {
  return getFoodItems(bot).length > 0;
}
