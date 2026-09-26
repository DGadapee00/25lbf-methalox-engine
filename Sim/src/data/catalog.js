/**
 * Every lab and stand the app can open, in the order of Phase 5's build-up (brief §6.1).
 *
 * kind: 'lab' opens at #/lab/<id>; 'stand' at #/stand/<id>. `milestone` is where the rest of the
 * list lands, so the tab bar can say what is coming without pretending it is here.
 */
export const LABS = [
  { id: 'scaffold', kind: 'lab', title: 'Scaffold check', milestone: 'M0' },
];

export const COMING = [
  { title: 'Blowdown', milestone: 'M2' },
  { title: 'Orifice', milestone: 'M2' },
  { title: 'Regulator', milestone: 'M2' },
  { title: 'Valve timing', milestone: 'M2' },
  { title: 'Injector', milestone: 'M2' },
  { title: 'Chamber fill', milestone: 'M4' },
  { title: 'Full stand', milestone: 'M3' },
];

export const labById = (id) => LABS.find((l) => l.id === id) || null;
