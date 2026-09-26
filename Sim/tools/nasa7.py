#!/usr/bin/env python3
"""
Extract NASA 7-coefficient thermo polynomials for the stand's species from GRI-Mech 3.0 and write
Sim/data/thermo_nasa7.json (brief §4.8).

Source: GRI-Mech 3.0 thermodynamic data, thermo30.dat
  G. P. Smith, D. M. Golden, M. Frenklach, et al., GRI-Mech 3.0,
  http://combustion.berkeley.edu/gri-mech/version30/text30.html

Usage:
  python3 tools/nasa7.py                      # fetch the canonical thermo30.dat
  python3 tools/nasa7.py --url <mirror>       # a mirror carrying the same THERMO block
  python3 tools/nasa7.py --file thermo30.dat  # a local copy

The output records which URL (or file) and its SHA-256 were used, so a run against a mirror is
distinguishable from one against the canonical file. The coefficients should be identical; if you
rerun against the canonical file and `git diff` shows any coefficient change, the mirror differs.

Format (CHEMKIN / NASA-7, per species, four 80-column lines):
  line 1: name (cols 1-18), elements (cols 25-44, 4 × [2-char symbol + 3-digit count]; a 5th
          slot at cols 74-78 is not used by these species), phase, T_low, T_high, T_common
  lines 2-4: 14 coefficients in E15.8 fields: a1..a7 for the high range, then a1..a7 for the low
  cp/R = a1 + a2 T + a3 T² + a4 T³ + a5 T⁴,  h/(RT) = a1 + a2 T/2 + … + a5 T⁴/5 + a6/T,
  s/R = a1 ln T + a2 T + a3 T²/2 + a4 T³/3 + a5 T⁴/4 + a7
Molar masses are computed from the element counts and the IUPAC standard atomic weights below
(abridged conventional values, IUPAC 2013 / CIAAW), not typed per species.

No dependencies beyond the Python standard library.
"""
import argparse
import datetime
import hashlib
import json
import pathlib
import subprocess
import sys
import urllib.request

CANONICAL = "http://combustion.berkeley.edu/gri-mech/version30/files30/thermo30.dat"
SPECIES = ["O2", "CH4", "N2", "H2O", "CO2", "CO", "H2"]  # propellants, purge, and major products (M4)

# IUPAC abridged / conventional standard atomic weights, g/mol (CIAAW, 2013 table).
ATOMIC_WEIGHT = {"H": 1.008, "C": 12.011, "N": 14.007, "O": 15.999, "AR": 39.95}


def read_source(args):
    if args.file:
        raw = pathlib.Path(args.file).read_bytes()
        return raw, str(pathlib.Path(args.file).resolve().name)
    url = args.url or CANONICAL
    with urllib.request.urlopen(url, timeout=60) as r:
        return r.read(), url


def thermo_lines(text):
    """The lines of the THERMO block (from THERMO to END), however the file is wrapped."""
    lines = text.splitlines()
    start = next(i for i, l in enumerate(lines) if l.strip().upper().startswith("THERMO"))
    out = []
    for l in lines[start + 2 :]:  # skip 'THERMO' and the default temperature-range line
        if l.strip().upper().startswith("END"):
            break
        out.append(l)
    return out


def parse(lines):
    """name -> record, reading 4-line entries identified by the '1'..'4' in column 80."""
    recs = {}
    i = 0
    while i < len(lines):
        l1 = lines[i].ljust(80)
        if l1[79] != "1":
            i += 1
            continue
        l2, l3, l4 = (lines[i + k].ljust(80) for k in (1, 2, 3))
        name = l1[0:18].split()[0]
        elems = {}
        for k in range(4):
            field = l1[24 + 5 * k : 29 + 5 * k]
            sym, cnt = field[:2].strip().upper(), field[2:].strip()
            if sym and cnt and sym != "0" and float(cnt) != 0:
                elems[sym] = elems.get(sym, 0) + int(float(cnt))
        t_low, t_high, t_mid = float(l1[45:55]), float(l1[55:65]), float(l1[65:73] or 1000)
        nums = []
        for l in (l2, l3, l4):
            for k in range(5):
                f = l[15 * k : 15 * k + 15].strip()
                if f:
                    nums.append(float(f.replace("D", "E")))
        coeffs = nums[:14]
        recs[name] = {
            "elements": elems,
            "T_low": t_low,
            "T_mid": t_mid,
            "T_high": t_high,
            "high": coeffs[0:7],
            "low": coeffs[7:14],
        }
        i += 4
    return recs


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    ap.add_argument("--url")
    ap.add_argument("--file")
    ap.add_argument("--out", default=str(pathlib.Path(__file__).resolve().parent.parent / "data" / "thermo_nasa7.json"))
    args = ap.parse_args()

    raw, where = read_source(args)
    recs = parse(thermo_lines(raw.decode("latin-1")))
    missing = [s for s in SPECIES if s not in recs]
    if missing:
        sys.exit(f"species not found in the THERMO block: {missing}")

    species = {}
    for s in SPECIES:
        r = recs[s]
        W = sum(ATOMIC_WEIGHT[e] * n for e, n in r["elements"].items()) / 1000.0  # kg/mol
        species[s] = {"W": round(W, 9), **r}

    try:
        commit = subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], text=True, stderr=subprocess.DEVNULL).strip()
    except Exception:
        commit = "unknown"

    out = {
        "source": "GRI-Mech 3.0 thermodynamic data (thermo30.dat), Smith et al., "
        "http://combustion.berkeley.edu/gri-mech/version30/text30.html",
        "source_file": where,
        "source_sha256": hashlib.sha256(raw).hexdigest(),
        "canonical_url": CANONICAL,
        "generator": "Sim/tools/nasa7.py",
        "generated": datetime.date.today().isoformat(),
        "commit": commit,
        "atomic_weights": {"values_g_per_mol": ATOMIC_WEIGHT, "source": "IUPAC/CIAAW abridged standard atomic weights (2013)"},
        "form": "NASA-7: cp/R = a1 + a2 T + a3 T^2 + a4 T^3 + a5 T^4; h/RT = a1 + a2 T/2 + a3 T^2/3 + a4 T^3/4 + a5 T^4/5 + a6/T; "
        "'low' applies T_low <= T < T_mid, 'high' T_mid <= T <= T_high. W in kg/mol.",
        "species": species,
    }
    pathlib.Path(args.out).write_text(json.dumps(out, indent=2) + "\n")
    print(f"wrote {args.out}: {', '.join(SPECIES)} from {where}")


if __name__ == "__main__":
    main()
