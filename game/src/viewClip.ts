/**
 * A portal page can size the game frame taller (or start it higher) than what is on screen, cutting
 * the build trays in half. From inside the frame, an IntersectionObserver still sees the part of the
 * frame the top window shows, so the HUD shrinks to that part; the camera follows the trays up.
 */
export function keepHudOnScreen(frame: Element, hud: HTMLElement): void {
  if (window.top === window || typeof IntersectionObserver === 'undefined') return;
  const io = new IntersectionObserver(([e]) => {
    const seen = e.intersectionRect, all = e.boundingClientRect;
    // nothing shown (tab hidden, scrolled away): keep the last layout
    if (!e.isIntersecting || seen.height <= 0) return;
    // never squeeze the HUD into less than a fifth of the frame
    const cap = all.height * 0.4;
    hud.style.top = `${Math.round(Math.min(cap, Math.max(0, seen.top - all.top)))}px`;
    hud.style.bottom = `${Math.round(Math.min(cap, Math.max(0, all.bottom - seen.bottom)))}px`;
  }, { threshold: Array.from({ length: 101 }, (_, i) => i / 100) });
  io.observe(frame);
}
