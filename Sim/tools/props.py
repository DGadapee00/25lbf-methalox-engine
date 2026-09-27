#!/usr/bin/env python3
"""
Joule–Thomson coefficients for the regulator's throttling drop (brief §4.3, §4.8), from CoolProp.
Writes Sim/data/props.json.

  mu_JT(p, T) = (∂T/∂p)_h   K/Pa, per gas, on a (T, p) grid

A regulator throttles at constant enthalpy. An ideal gas keeps its temperature doing that; a real
gas at 2000 psia cools. The sim integrates dT/dp = mu_JT(p, T) from the supply pressure down to the
outlet pressure (physics/jt.js), which moves choked flow (ṁ ∝ 1/√T0) and so O/F.

`checks` are isenthalpic outlet temperatures computed directly by CoolProp (an (h, p) flash, not the
tabulated coefficient), so the sim's integral is tested against an independent path.

Grid: T 200–360 K (above methane's 190.6 K critical temperature, so no grid point is two-phase)
and p 0.1–20 MPa (bottles fill to 2000–2400 psi, 13.8–16.5 MPa). Z(p, T) for bottle inventory
(brief §4.2, v1.1) is not generated yet.

Usage (needs CoolProp: pip install CoolProp):
  python3 Sim/tools/props.py
"""
import datetime
import json
import pathlib
import subprocess

import CoolProp
from CoolProp.CoolProp import PropsSI

ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
OUT = ROOT / "Sim" / "data" / "props.json"
PSI = 6894.757293168361

GASES = {"O2": "Oxygen", "CH4": "Methane", "N2": "Nitrogen"}
T = [200 + 10 * i for i in range(17)]
P = [0.1e6, 0.2e6, 0.5e6, 1e6, 1.5e6, 2e6, 3e6, 4e6, 5e6, 6e6, 7e6, 8e6, 10e6, 12e6, 14e6, 16e6, 18e6, 20e6]
CHECKS = [(2000, 293.15, 480), (2400, 293.15, 480), (1200, 293.15, 480), (2000, 273.15, 480), (2000, 313.15, 480), (2000, 293.15, 100), (600, 293.15, 250)]


def main():
    mu = {}
    for key, fluid in GASES.items():
        mu[key] = [[PropsSI("d(T)/d(P)|H", "T", t, "P", p, fluid) for p in P] for t in T]
    checks = []
    for key, fluid in GASES.items():
        for pin, tin, pout in CHECKS:
            h = PropsSI("H", "T", tin, "P", pin * PSI, fluid)
            tout = PropsSI("T", "H", h, "P", pout * PSI, fluid)
            checks.append({"gas": key, "p_in": pin * PSI, "T_in": tin, "p_out": pout * PSI, "T_out": tout})
    try:
        commit = subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], text=True, cwd=ROOT, stderr=subprocess.DEVNULL).strip()
    except Exception:
        commit = "unknown"
    out = {
        "source": f"CoolProp {CoolProp.__version__} (Bell et al., Ind. Eng. Chem. Res. 53 (2014) 2498), reference equations of state for Oxygen, Methane, Nitrogen",
        "generator": "Sim/tools/props.py",
        "generated": datetime.date.today().isoformat(),
        "commit": commit,
        "units": {"T": "K", "p": "Pa", "mu_JT": "K/Pa"},
        "T": T,
        "p": P,
        "layout": "mu_JT[gas][i_T][j_p]",
        "mu_JT": mu,
        "checks": checks,
        "note": "Interpolate bilinearly in (T, ln p); clamp outside the grid. Checks are CoolProp (h, p) flashes, independent of the tabulated coefficient.",
    }
    OUT.write_text(json.dumps(out, indent=1) + "\n")
    print(f"wrote {OUT.relative_to(ROOT)}: {', '.join(GASES)} on {len(T)} T × {len(P)} p, {len(checks)} checks")


if __name__ == "__main__":
    main()
