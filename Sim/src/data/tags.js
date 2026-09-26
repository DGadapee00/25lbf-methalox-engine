/**
 * P&ID tag convention, S-2 (Dalton, 2026-09-26): <ISA letters>-<circuit>-<nn>.
 *
 *   letters   SV / XV  actuated valve       HV   hand valve        PCV  regulator
 *             PSV      relief               CKV  check valve
 *             PT       pressure transducer  TE   temperature element  LC  load cell
 *   circuits  OX oxidizer · FU fuel · N2 purge/pressurant · IG igniter · CH chamber
 *   nn        two digits, 01–99
 *
 * Orifices (injector circuits, throat) have no letter code in S-2 yet.
 */
export const TAG_RE = /^(SV|XV|HV|PCV|PSV|CKV|PT|TE|LC)-(OX|FU|N2|IG|CH)-(\d{2})$/;

/** Which letters each network element type may carry. */
export const LETTERS_FOR_TYPE = {
  valve: ['SV', 'XV', 'HV'],
  regulator: ['PCV'],
  relief: ['PSV'],
  check: ['CKV'],
};

/** Parse a tag into { letters, circuit, n }, or null if it does not follow S-2. */
export function parseTag(tag) {
  const m = TAG_RE.exec(String(tag));
  return m && m[3] !== '00' ? { letters: m[1], circuit: m[2], n: Number(m[3]) } : null;
}

/**
 * Tag problems in a network: every valve, regulator, relief and check must carry an S-2 tag (its
 * `tag`, or its `id` when no separate tag is given) whose letters fit its type. Returns a list of
 * messages; empty means clean.
 */
export function tagProblems(net) {
  const out = [];
  for (const e of net.edges) {
    const allowed = LETTERS_FOR_TYPE[e.type];
    if (!allowed) continue;
    const tag = e.tag ?? e.id;
    const t = parseTag(tag);
    if (!t) out.push(`${e.type} ${tag}: not an S-2 tag (<letters>-<circuit>-<nn>)`);
    else if (!allowed.includes(t.letters)) out.push(`${e.type} ${tag}: ${t.letters} is not a ${e.type} code (${allowed.join('/')})`);
  }
  return out;
}
