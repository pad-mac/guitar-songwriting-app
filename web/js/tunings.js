// Tunings as MIDI numbers, lowest string first (E2 = 40).

export const PRESETS = [
  { id: 'standard', name: 'Standard', notes: [40, 45, 50, 55, 59, 64] },
  { id: 'drop-d', name: 'Drop D', notes: [38, 45, 50, 55, 59, 64] },
  { id: 'half-down', name: 'Half step down', notes: [39, 44, 49, 54, 58, 63] },
  { id: 'whole-down', name: 'Whole step down', notes: [38, 43, 48, 53, 57, 62] },
  { id: 'drop-c', name: 'Drop C', notes: [36, 43, 48, 53, 57, 62] },
  { id: 'dadgad', name: 'DADGAD', notes: [38, 45, 50, 55, 57, 62] },
  { id: 'open-d', name: 'Open D', notes: [38, 45, 50, 54, 57, 62] },
  { id: 'open-dm', name: 'Open D minor', notes: [38, 45, 50, 53, 57, 62] },
  { id: 'open-g', name: 'Open G', notes: [38, 43, 50, 55, 59, 62] },
  { id: 'open-e', name: 'Open E', notes: [40, 47, 52, 56, 59, 64] },
  { id: 'open-a', name: 'Open A', notes: [40, 45, 52, 57, 61, 64] },
  { id: 'open-c', name: 'Open C', notes: [36, 43, 48, 55, 60, 64] },
  { id: 'c6', name: 'C6', notes: [36, 45, 48, 55, 60, 64] },
];

export const MIN_NOTE = 24;  // C1
export const MAX_NOTE = 79;  // G5
