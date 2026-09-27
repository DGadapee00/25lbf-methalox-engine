/**
 * Every lab and stand the app can open, in the order of Phase 5's build-up (brief §6.1).
 *
 * kind: 'lab' opens at #/lab/<id>; 'stand' at #/stand/<id>. `milestone` is where the rest of the
 * list lands, so the tab bar can say what is coming without pretending it is here.
 */
export const LABS = [
  { id: 'blowdown', kind: 'lab', title: 'Blowdown', milestone: 'M2' },
  { id: 'orifice', kind: 'lab', title: 'Orifice', milestone: 'M2' },
  { id: 'regulator', kind: 'lab', title: 'Regulator', milestone: 'M2' },
  { id: 'valve-timing', kind: 'lab', title: 'Valve timing', milestone: 'M3' },
  { id: 'injector', kind: 'lab', title: 'Injector', milestone: 'M3' },
  { id: 'gn2-coldflow', kind: 'stand', title: 'GN₂ cold-flow stand', milestone: 'M3' },
];

export const COMING = [
  { title: 'Full stand', milestone: 'M3' },
  { title: 'Chamber fill', milestone: 'M4' },
];

export const labById = (id) => LABS.find((l) => l.id === id) || null;
