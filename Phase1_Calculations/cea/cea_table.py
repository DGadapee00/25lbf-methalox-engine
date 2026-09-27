#!/usr/bin/env python3
"""
GOX/GCH4 equilibrium table for the stand simulator (Sim/, brief §4.8), from RocketCEA.

Writes Sim/data/cea_gox_gch4.json: over an O/F × P_c grid, the chamber equilibrium values the sim's
chamber model reads (Sim/src/physics/chamber.js). The sim never computes chemistry at runtime.

  cstar      ideal characteristic velocity c*, m/s          (CEA CSTAR)
  Tc         chamber temperature, K                        (CEA T, chamber)
  M          chamber molar mass, kg/mol                    (CEA M, (1/n))
  gamma      chamber isentropic exponent                   (CEA GAMMAs, chamber, equilibrium)
  CFvac      vacuum thrust coefficient at ε = 3            (Ivac · g0 / c*)
  PcOvPe     P_c / p_exit at ε = 3                         (CEA Pinf/P, exit)

Shifting equilibrium through the nozzle (CEA "rocket equilibrium", infinite-area combustor).
Reactants are RocketCEA's cards GOX = O2(G) and GCH4 = CH4(G), both at 298.15 K.

Grid. O/F 1.2–40 and P_c 10–1000 psia. The brief (§4.8) asks for O/F 1.5–4.5 × P_c 20–400 psia;
this is a superset, because the chamber model looks the table up at whatever mixture ignites. CH4 in
O2 is flammable from 5.1 to 61 vol% CH4 (Sim/data/flammability.json), which is O/F ≈ 37 down to
≈ 1.28, and an ignition spike can take P_c past 400 psia. Below O/F ≈ 1.2 CEA predicts solid carbon;
the table does not go there.

`checks` are off-grid points computed directly, so the sim can measure its own interpolation error
against CEA rather than against itself. `design_point` is PROJECT_PLAN §2.1 (P_c 250 psia, O/F 2.8,
ε 3) with the full CEA output written next to this script as design_point.txt.

This is a table for the simulator, not the Phase 1 gate's CEA run set (PROJECT_PLAN §3 Phase 1):
that sweep, its notebook and the §2 recompute are still to be done and reviewed.

Usage (needs RocketCEA, which needs a Fortran compiler to install):
  python3 Phase1_Calculations/cea/cea_table.py
"""
import datetime
import json
import math
import pathlib
import subprocess

import rocketcea
from rocketcea.cea_obj import CEA_Obj

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent.parent
OUT = ROOT / "Sim" / "data" / "cea_gox_gch4.json"
RAW = HERE / "design_point.txt"

PSI = 6894.757293168361  # Pa, 1 lbf/in² (NIST SP 811 B.8; exact from the 1959 pound and inch)
FT = 0.3048  # m, exact
G0 = 9.80665  # m/s², exact
RANKINE = 5.0 / 9.0  # K per °R, exact
EPS = 3.0  # PROJECT_PLAN §2.1 expansion ratio

MR = [round(1.2 + 0.1 * i, 1) for i in range(34)] + [4.75, 5, 5.5, 6, 7, 8, 9, 10, 12, 14, 17, 20, 25, 30, 35, 40]
PC_PSIA = [10, 14.696, 20, 30, 50, 75, 100, 125, 150, 175, 200, 225, 250, 275, 300, 350, 400, 500, 600, 800, 1000]
CHECKS = [(2.75, 262.5), (2.85, 237.5), (2.8, 263.9), (3.05, 187.5), (2.25, 112.5), (6.5, 62.5), (18.5, 16.0), (1.55, 450.0)]
DESIGN = (2.8, 250.0)


def point(c, mr, pc):
    ivac, cstar, tc = c.get_IvacCstrTc(Pc=pc, MR=mr, eps=EPS)  # s, ft/s, °R
    mw, gam = c.get_Chamber_MolWt_gamma(Pc=pc, MR=mr, eps=EPS)
    pe = c.get_PcOvPe(Pc=pc, MR=mr, eps=EPS)
    cs = float(cstar) * FT
    return {
        "cstar": round(cs, 4),
        "Tc": round(float(tc) * RANKINE, 3),
        "M": round(float(mw) / 1000.0, 8),
        "gamma": round(float(gam), 6),
        "CFvac": round(float(ivac) * G0 / cs, 6),
        "PcOvPe": round(float(pe), 5),
    }


def main():
    c = CEA_Obj(oxName="GOX", fuelName="GCH4")
    fields = ["cstar", "Tc", "M", "gamma", "CFvac", "PcOvPe"]
    table = {f: [] for f in fields}
    for mr in MR:
        rows = {f: [] for f in fields}
        for pc in PC_PSIA:
            p = point(c, mr, pc)
            for f in fields:
                if not math.isfinite(p[f]) or p[f] <= 0:
                    raise SystemExit(f"CEA returned {f}={p[f]} at O/F {mr}, Pc {pc} psia")
                rows[f].append(p[f])
        for f in fields:
            table[f].append(rows[f])
    checks = [{"OF": mr, "Pc_psia": pc, **point(c, mr, pc)} for mr, pc in CHECKS]
    mr, pc = DESIGN
    design = {"OF": mr, "Pc_psia": pc, "eps": EPS, **point(c, mr, pc)}
    design["cp_frozen"] = round(float(c.get_Chamber_Cp(Pc=pc, MR=mr, eps=EPS, frozen=1)) * 4186.8, 3)  # BTU/(lbm·°R) = cal/(g·K) → J/(kg·K)
    RAW.write_text(c.get_full_cea_output(Pc=pc, MR=mr, eps=EPS, short_output=0))
    try:
        commit = subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], text=True, cwd=ROOT, stderr=subprocess.DEVNULL).strip()
    except Exception:
        commit = "unknown"
    out = {
        "source": f"NASA CEA (McBride & Gordon, RP-1311) via RocketCEA {rocketcea.__version__}; shifting equilibrium, infinite-area combustor",
        "generator": "Phase1_Calculations/cea/cea_table.py",
        "generated": datetime.date.today().isoformat(),
        "commit": commit,
        "propellants": {"ox": "GOX = O2(G) at 298.15 K", "fuel": "GCH4 = CH4(G) at 298.15 K (RocketCEA cards)"},
        "units": {"cstar": "m/s", "Tc": "K", "M": "kg/mol", "gamma": "1", "CFvac": "1", "PcOvPe": "1", "Pc": "Pa", "cp_frozen": "J/(kg·K)"},
        "eps": EPS,
        "OF": MR,
        "Pc": [round(p * PSI, 3) for p in PC_PSIA],
        "Pc_psia": PC_PSIA,
        "layout": "table[field][i_OF][j_Pc]",
        "table": table,
        "checks": checks,
        "design_point": design,
        "note": "Interpolate bilinearly in (O/F, ln Pc). Outside the grid, clamp. Superset of the brief's O/F 1.5–4.5 × 20–400 psia; see the generator header.",
    }
    OUT.write_text(json.dumps(out, indent=1) + "\n")
    print(f"wrote {OUT.relative_to(ROOT)}: {len(MR)} O/F × {len(PC_PSIA)} Pc, {len(checks)} checks; raw design point {RAW.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
