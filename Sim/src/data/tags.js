/**
 * P&ID tag convention, S-2 (Dalton, 2026-09-26): <ISA letters>-<circuit>-<nn>.
 *
 *   letters   SV / XV  actuated valve       HV   hand valve        PCV  regulator
 *             PSV      relief               CKV  check valve
 *             PT       pressure transducer  TE   temperature element  LC  load cell
 *   circuits  OX oxidizer · FU fuel · N2 purge/pressurant · IG igniter · CH chamber
 *   nn        two digits, 01–99
 *
 * Orifices (extended 2026-09-26):
 *   RO   restriction orifice on the stand (a purge-line orifice, say)
 *   FE   flow element: a metering venturi or sonic orifice (D-6)
 *   engine parts are not stand components and keep their own tags, from an allowed list:
 *   ENGINE_PARTS below (injector circuits, throat).
 */
export const TAG_RE = /^(SV|XV|HV|PCV|PSV|CKV|PT|TE|LC|RO|FE)-(OX|FU|N2|IG|CH)-(\d{2})$/;

/** Engine-part tags an orifice edge may carry instead of an ISA stand tag. */
export const ENGINE_PARTS = ['INJ-OX-01', 'INJ-FU-01', 'THROAT-01'];

/**
 * Igniter tags (M4, provisional). The igniter is an engine part in the S-2 igniter circuit (IG).
 * D-4 (spark plug or augmented spark torch) is open, so the sim knows one igniter and treats it
 * as a switch. Until S-2 lists an igniter tag, this is the one the sim uses; flagged for Dalton.
 */
export const IGNITER_TAGS = ['IGN-IG-01'];

/** Which letters each network element type may carry. */
export const LETTERS_FOR_TYPE = {
  valve: ['SV', 'XV', 'HV'],
  regulator: ['PCV'],
  relief: ['PSV'],
  check: ['CKV'],
  orifice: ['RO', 'FE'],
};

/** Parse a tag into { letters, circuit, n }, or null if it does not follow S-2. */
export function parseTag(tag) {
  const m = TAG_RE.exec(String(tag));
  return m && m[3] !== '00' ? { letters: m[1], circuit: m[2], n: Number(m[3]) } : null;
}

/**
 * Tag problems in a network: every valve, regulator, relief, check and orifice must carry an S-2
 * tag (its `tag`, or its `id` when no separate tag is given) whose letters fit its type; an
 * orifice may instead carry an engine-part tag from ENGINE_PARTS. Returns a list of messages;
 * empty means clean.
 */
export function tagProblems(net) {
  const out = [];
  for (const e of net.edges) {
    const allowed = LETTERS_FOR_TYPE[e.type];
    if (!allowed) continue;
    const tag = e.tag ?? e.id;
    if (e.type === 'orifice' && ENGINE_PARTS.includes(tag)) continue;
    const t = parseTag(tag);
    if (!t) out.push(`${e.type} ${tag}: not an S-2 tag (<letters>-<circuit>-<nn>)${e.type === 'orifice' ? ` or an engine part (${ENGINE_PARTS.join(', ')})` : ''}`);
    else if (!allowed.includes(t.letters)) out.push(`${e.type} ${tag}: ${t.letters} is not a ${e.type} code (${allowed.join('/')})`);
  }
  for (const g of net.igniters || []) if (!IGNITER_TAGS.includes(g.id)) out.push(`igniter ${g.id}: not an igniter tag (${IGNITER_TAGS.join(', ')})`);
  return out;
}
