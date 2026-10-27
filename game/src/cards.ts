import type { AmmoId } from './arena';

export type CardKind = 'fort' | 'ammo' | 'rule';

export interface Card {
  id: string;
  kind: CardKind;
  name: string;
  text: string;
  icon: string;
  ammo?: AmmoId;
}

export const CARD_POOL: Card[] = [
  { id: 'iceWall', kind: 'fort', name: 'Ice Wall', text: 'A wall of 3 ice blocks appears at your front edge.', icon: '🧊' },
  { id: 'roof', kind: 'fort', name: "King's Roof", text: 'A wooden roof drops onto your king.', icon: '🛖' },
  { id: 'spring', kind: 'fort', name: 'Bouncy Fence', text: 'A springy board at your front edge bounces shots back.', icon: '🪀' },
  { id: 'decoy', kind: 'fort', name: 'Decoy King', text: 'A fake king joins your fort. Hits on it do nothing.', icon: '⛄' },
  { id: 'bigIce', kind: 'ammo', name: 'Ice Boulder', text: '3 heavy ice boulders that smash through walls.', icon: '🪨', ammo: 'bigIce' },
  { id: 'split', kind: 'ammo', name: 'Split Shot', text: '3 snowballs that split in three at the top of the arc.', icon: '✳️', ammo: 'split' },
  { id: 'cocoa', kind: 'ammo', name: 'Hot Cocoa', text: '3 cocoa bombs that melt nearby ice and soften snow.', icon: '☕', ammo: 'cocoa' },
  { id: 'firework', kind: 'ammo', name: 'Firework', text: '3 fast rockets that fly almost straight.', icon: '🎆', ammo: 'firework' },
  { id: 'frost', kind: 'ammo', name: 'Frost Shot', text: '3 icy snowballs. One landing on your rival’s hill freezes their catapult for 3 s.', icon: '❄️', ammo: 'frost' },
  { id: 'wind', kind: 'rule', name: 'Headwind', text: 'Next round, wind blows against your rival’s shots.', icon: '🌬️' },
  { id: 'slowReload', kind: 'rule', name: 'Frozen Gears', text: 'Next round, your rival reloads 30% slower.', icon: '⚙️' },
  { id: 'triple', kind: 'rule', name: 'Opening Volley', text: 'Your first shot next round fires three balls.', icon: '🎯' },
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
