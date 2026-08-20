export function levelForExp(exp: number): number {
  return Math.floor(1 + Math.sqrt(exp / 100));
}

export function maxHpForLevel(level: number): number {
  return 100 + (level - 1) * 10;
}

// Deliberate design choice: leveling up fully heals the character to its new
// max HP, rather than leaving current HP unchanged. Simplest, conventional
// MMO behavior -- revisit if a future gameplay pass wants otherwise.
export function hpAfterLevelUp(newLevel: number): number {
  return maxHpForLevel(newLevel);
}
