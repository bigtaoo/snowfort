# Snow Fort Showdown — working rules

Same-device two-player snow fort artillery game (Three.js + Rapier), for the Playgama
"Player Two Found" challenge (deadline 2026-11-04 18:00 PT). Design: `design/README.md` (Chinese).

## Rules

- Talk to the user in Chinese; code, comments and commit messages in English; design docs in Chinese.
- Landscape only. Desktop keyboard/mouse first, touch must work too.
- Gameplay physics stays in one plane (Rapier 3D with Z translation and X/Y rotation locked);
  only the victory replay unlocks it.
- Reuse before inventing: 3D look and build tooling from `D:\dnf` (`client/src/three/`),
  Playgama Bridge plumbing from `D:\standing\client\src\platform\playgama\`.
- No secrets in the repo (Tripo/Mistral keys live outside it).
- Committing directly to `main` is fine.

## Layout

- `design/` — game design.
- `game/` — the game (Vite + TypeScript + Three.js + Rapier).
- `lookdev/` — standalone 3D look samples (scene, materials, models) before they move into `game/`.
- `art/` — source art and model prompts.
