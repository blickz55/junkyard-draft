/** Warm industrial workshop palette. */
export const P = {
  bg: 0x1a1612,
  floor: 0x2a241d,
  floorLine: 0x352e25,
  floorAlt: 0x2f2820,
  panel: 0x24201a,
  panelLine: 0x3f382d,
  text: 0xf1e8d8,
  textDim: 0xa89d88,
  amber: 0xf0a830,
  amberDark: 0xb8782a,
  rust: 0xa8503a,
  steel: 0x8e9aa6,
  steelDark: 0x5a6670,
  green: 0x6fcf8a,
  red: 0xeb6757, // ≥ 4.5:1 on the panel for 13 px diagnostics (was e5574a at 4.47:1)
  blue: 0x5aa9e6,
  cursor: 0xd6f0ff, // keyboard cursor frame: light so it stays apart from the green hover tile under tritanopia
  gold: 0xf5c542,
  scrap: 0x8a6d4e,
  shards: 0xc9d3dc,
  plate: 0x7f9bb8, // darker steel blue: ΔE ≥ 20 from shards under every CVD simulation (was 9fb4c7)
  ingot: 0xf5c542,
  slag: 0x6b3a3a,
  ok: 0x6fcf8a,
  bad: 0xeb6757,
};
export const CSS = {
  text: '#f1e8d8', dim: '#a89d88', amber: '#f0a830', green: '#6fcf8a', red: '#eb6757', blue: '#5aa9e6', gold: '#f5c542', panel: '#24201a',
};
export const FONT = 'Inter, "Segoe UI", system-ui, sans-serif';
export const MONO = 'ui-monospace, Menlo, Consolas, monospace';
