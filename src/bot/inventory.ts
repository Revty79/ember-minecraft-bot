import type { Bot } from "mineflayer";
import type { Item } from "prismarine-item";
import type { FoodItemSummary, InventorySummary } from "./types";

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

export function isFoodItem(bot: Bot, item: Item | null | undefined): item is Item {
  if (!item || !item.name) return false;
  const name = item.name.toLowerCase();
  if (KNOWN_FOOD_NAMES.has(name)) return true;
  if (isFoodByRegistry(bot, name)) return true;
  return false;
}

function addCount(map: Map<string, number>, name: string, count: number): void {
  map.set(name, (map.get(name) ?? 0) + count);
}

export function getFoodItems(bot: Bot): FoodItemSummary[] {
  const slots = bot.inventory?.items?.() ?? [];
  const counts = new Map<string, number>();

  for (const item of slots) {
    if (!isFoodItem(bot, item)) continue;
    addCount(counts, item.name, item.count);
  }

  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
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

export function getInventorySummary(bot: Bot): InventorySummary {
  const allSlots = bot.inventory?.slots ?? [];
  const totalSlots = allSlots.length;
  const usedSlots = allSlots.filter((slot): slot is Item => slot !== null).length;
  const emptySlots = Math.max(totalSlots - usedSlots, 0);
  const heldItem = bot.heldItem?.name ?? null;

  let foodCount = 0;
  let toolCount = 0;
  let weaponCount = 0;
  let armorCount = 0;
  const importantMaterialsMap = new Map<string, number>();

  for (const item of bot.inventory?.items?.() ?? []) {
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

export function pickBestFoodItem(bot: Bot, preferredName?: string): Item | null {
  const inventoryItems = bot.inventory?.items?.() ?? [];
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
