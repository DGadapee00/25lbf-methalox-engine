# Deploying the simulator

The site is built and published by `.github/workflows/sim.yml` on every push to `main` that touches
`Sim/`. PRs run the same tests, build and smoke test, but do not deploy.

**Switch Pages on once:** repository Settings → Pages → Build and deployment → Source:
**GitHub Actions**. Until then the deploy job fails with "Pages is not enabled"; the test job is
unaffected.

The site will be at <https://dgadapee00.github.io/25lbf-methalox-engine/>. The build uses a
relative base path and hash routes (`#/lab/<id>`), so deep links work under that sub-path with no
server configuration. It is public and indexable on purpose: it is the portfolio piece (J-6).

## Knowing what is actually live

Every build stamps the commit it came from into `/version.json` and logs it to the browser
console. A build from a checkout with uncommitted changes is stamped `abc1234+local`.

```bash
cd Sim && npm run live
```

prints the live commit and the local one, lists the commits the site is missing, and exits
non-zero when it is behind. `SIM_SITE=<url>` points it elsewhere.
