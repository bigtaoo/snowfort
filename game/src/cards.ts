import type { AmmoId } from './arena';

export type CardKind = 'fort' | 'ammo' | 'rule';

export type CardId = 'iceWall' | 'roof' | 'spring' | 'decoy' | 'bigIce' | 'split' | 'cocoa' | 'firework' | 'frost' | 'wind' | 'slowReload' | 'triple';

/** A card; its name and text are in the string tables (i18n, `cards.<id>`). */
export interface Card {
  id: CardId;
  kind: CardKind;
  icon: string;
  ammo?: AmmoId;
}

export const CARD_POOL: Card[] = [
  { id: 'iceWall', kind: 'fort', icon: '🧊' },
  { id: 'roof', kind: 'fort', icon: '🛖' },
  { id: 'spring', kind: 'fort', icon: '🪀' },
  { id: 'decoy', kind: 'fort', icon: '⛄' },
  { id: 'bigIce', kind: 'ammo', icon: '🪨', ammo: 'bigIce' },
  { id: 'split', kind: 'ammo', icon: '✳️', ammo: 'split' },
  { id: 'cocoa', kind: 'ammo', icon: '☕', ammo: 'cocoa' },
  { id: 'firework', kind: 'ammo', icon: '🎆', ammo: 'firework' },
  { id: 'frost', kind: 'ammo', icon: '❄️', ammo: 'frost' },
  { id: 'wind', kind: 'rule', icon: '🌬️' },
  { id: 'slowReload', kind: 'rule', icon: '⚙️' },
  { id: 'triple', kind: 'rule', icon: '🎯' },
];

/** Three distinct cards, at least two kinds among them. */
export function dealHand(): Card[] {
  for (;;) {
    const pool = [...CARD_POOL];
    const hand: Card[] = [];
    while (hand.length < 3) hand.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    if (new Set(hand.map((c) => c.kind)).size >= 2) return hand;
  }
}
