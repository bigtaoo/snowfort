// Every tunable number of the game lives here. Units: metres, seconds, kilograms.
// The play plane is z = 0; x runs left to right, y up.

export const PHYSICS = {
  dt: 1 / 60,
  maxSubSteps: 4,
  gravity: -15,
  /** Damage only counts the part of a contact impulse above a material's armour (per physics step). */
  /** Knock-on hits (block on block, block on ground) do this fraction of a direct shot's damage. */
  knockOnDamage: 0.3,
  /** Linear and angular damping on blocks, so a hit topples a wall instead of scattering it. */
  blockDamping: 0.5,
  /** No single hit takes more than this share of a king's health, so even a boulder needs a second hit. */
  kingMaxHitShare: 0.6,
  /** Damage a king takes within this many seconds of a hit's first contact belongs to that hit. */
  kingHitWindow: 0.8,
  debrisLife: 2.2,
  debrisSize: 0.35,
  debrisPerBreak: 4,
};

export const ARENA = {
  /** Top of both fort plateaus. */
  groundY: 0,
  /** Plateaus end at |x| = edgeX; between them is the ravine. */
  edgeX: 1.5,
  outerX: 24,
  ravineY: -7,
  depth: 8,
  /** Each player builds in |x| from zoneNear to zoneFar on their own side. The strip between the cliff
   * and zoneNear is where the bouncy fence card stands. */
  zoneNear: 1.85,
  /** Short of the catapult, so a ball never leaves from inside its own fort. */
  zoneFar: 8.7,
  buildCeiling: 9,
  /** A body below this y is off its plateau (fell into the ravine). */
  fallY: -1.5,
  /** A king pushed further out than this (off the side of the screen, past his own catapult) is out of his yard and loses the round. */
  yardEnd: 12.6,
  /** Visible framing: the camera fits this box. */
  viewHalfWidth: 12.8,
  viewBottom: -1.2,
  viewTop: 10.4,
};

export type MaterialId = 'snow' | 'ice' | 'wood';
export type PieceId = 'snow' | 'ice' | 'plankH' | 'plankV' | 'king';

export interface MaterialSpec {
  density: number;
  friction: number;
  restitution: number;
  /** Impulse per step a block shrugs off. */
  armor: number;
  hp: number;
  color: number;
  opacity: number;
}

export const MATERIALS: Record<MaterialId | 'king', MaterialSpec> = {
  // soft and light: soaks up small knocks, crumbles under steady hits
  snow: { density: 1.6, friction: 0.9, restitution: 0.02, armor: 2.0, hp: 22, color: 0xf2f6ff, opacity: 1 },
  // strong and brittle: ignores small knocks, shatters on a solid hit; slippery
  ice: { density: 2.6, friction: 0.25, restitution: 0.05, armor: 6, hp: 12, color: 0x9fdcff, opacity: 0.82 },
  // tough, long, light
  wood: { density: 1.2, friction: 0.7, restitution: 0.05, armor: 2.5, hp: 50, color: 0xa86b3c, opacity: 1 },
  king: { density: 1.0, friction: 0.8, restitution: 0.02, armor: 2.0, hp: 30, color: 0xffffff, opacity: 1 },
};

export interface PieceSpec {
  material: MaterialId | 'king';
  /** Half extents (x, y); depth is always BLOCK_HALF_DEPTH. */
  hx: number;
  hy: number;
  label: string;
}

export const BLOCK_HALF_DEPTH = 0.5;

export const PIECES: Record<PieceId, PieceSpec> = {
  snow: { material: 'snow', hx: 0.5, hy: 0.5, label: 'Snow' },
  ice: { material: 'ice', hx: 0.5, hy: 0.5, label: 'Ice' },
  plankH: { material: 'wood', hx: 1.5, hy: 0.15, label: 'Plank —' },
  plankV: { material: 'wood', hx: 0.15, hy: 1.5, label: 'Plank |' },
  king: { material: 'king', hx: 0.45, hy: 0.8, label: 'King' },
};

/** Budget pools: planks are shared between both orientations. */
export type BudgetKey = 'snow' | 'ice' | 'plank' | 'king';
export type Budget = Record<BudgetKey, number>;
export const budgetKeyOf = (p: PieceId): BudgetKey => (p === 'plankH' || p === 'plankV' ? 'plank' : p);

export const BUILD = {
  budget: { snow: 12, ice: 5, plank: 4, king: 1 } as Budget,
  /** Desktop: players build one after the other. */
  turnSeconds: 30,
  /** Touch: both build at once. */
  simultaneousSeconds: 40,
  repairBudget: { snow: 5, ice: 2, plank: 1, king: 0 } as Budget,
  repairTurnSeconds: 15,
  repairSimultaneousSeconds: 18,
  /** Pieces dropped this high above the pointer drop onto whatever is below. */
  liftStep: 0.05,
};

export const CATAPULT = {
  /** Catapult sits at |x| = x, behind the fort; pivot at height pivotY. */
  x: 10.8,
  pivotY: 1.6,
  barrelLength: 1.6,
  minAngleDeg: 12,
  maxAngleDeg: 72,
  /** Seconds for one full sweep up and back down. */
  sweepPeriod: 2.6,
  minSpeed: 9,
  maxSpeed: 25,
  /** Seconds for power to go 0 -> 1 -> 0 while held. */
  chargePeriod: 1.8,
  reloadSeconds: 2.5,
  /** Alternate-turn mode: hand over this long after the shot lands... */
  turnAfterLanding: 0.5,
  /** ...or this long after it was fired, whichever comes first. */
  turnSettleSeconds: 3.2,
  /** Alternate-turn mode: every hit does this much more damage, so a round takes fewer shots. */
  turnDamageMul: 1.4,
};

export const PROJECTILE = {
  radius: 0.35,
  density: 4,
  friction: 0.6,
  restitution: 0.15,
  /** A snowball vanishes this long after it first touches something. */
  lingerAfterHit: 0.9,
  maxLife: 8,
};

export const AMMO = {
  bigIce: { radius: 0.55, densityMul: 2.2, lingerAfterHit: 3 },
  split: { count: 3, spreadSpeed: 4 },
  cocoa: { meltRadius: 2.6, snowDamage: 8 },
  firework: { speedMul: 1.45, gravityScale: 0.18, radius: 0.25, densityMul: 1.6 },
  /** Lands on the rival's hill: their catapult freezes this long. */
  frost: { freezeSeconds: 3 },
  /** Ammo cards give this many special shots next round. */
  shotsPerCard: 3,
};

export const ROUND = {
  winsNeeded: 3,
  /** After this many seconds the blizzard starts and shots grow heavier. */
  blizzardAfter: 90,
  blizzardMassPerSecond: 0.08,
  blizzardMaxMass: 4,
  /** Nothing takes damage for this long after a round starts (card pieces settle). */
  damageGraceSeconds: 1.2,
  endBannerSeconds: 2.6,
  cardPickSeconds: 12,
};

export const CARDS = {
  windForce: 4,
  /** Bouncy fence: a heavy springy upright plank at the front edge. */
  springRestitution: 1.25,
  springDensity: 14,
  springHpMul: 5,
  slowReloadMul: 1.3,
  tripleSpreadDeg: 6,
};

export const REPLAY = {
  /** The replay restarts from a snapshot at least this long before the deciding hit. */
  leadSeconds: 1.3,
  snapshotEvery: 0.25,
  snapshotKeep: 16,
  timeScale: 0.3,
  simSeconds: 4.2,
  orbitRadius: 17,
  orbitHeight: 6,
  /** Small random nudges so the collapse leaves the plane. */
  zJitter: 0.06,
  spinJitter: 0.6,
  hitZImpulse: 0.35,
};

export const CPU = {
  levels: {
    easy: { angleNoiseDeg: 5, speedNoise: 1.6, thinkSeconds: 1.2, decoyFooled: 0.6 },
    normal: { angleNoiseDeg: 2.5, speedNoise: 0.8, thinkSeconds: 0.7, decoyFooled: 0.4 },
    hard: { angleNoiseDeg: 1.2, speedNoise: 0.35, thinkSeconds: 0.35, decoyFooled: 0.2 },
  },
  /** Angles the CPU likes to throw at (it waits for the sweep to pass one). */
  preferredAnglesDeg: [55, 40, 30, 62],
  buildDropInterval: 0.12,
};

export const COLORS = {
  p1: 0xe2453c,
  p2: 0x2f7de1,
  sky: 0xbcd8f0,
  ground: 0xf4f8ff,
  ravine: 0x8aa6c4,
  ghostOk: 0x7cff8a,
  ghostBad: 0xff6b6b,
};
