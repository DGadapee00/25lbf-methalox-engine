import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';

/**
 * Which commit a build came from.
 *
 * The site is published by a GitHub Actions run after each merge to `main`, so for a while (or for
 * good, if a run fails) the live page can lag `main`. Stamping the build makes that visible instead
 * of a guess: /version.json on the live site says which commit it was built from.
 */
function buildInfo() {
  const git = (cmd, fallback) => {
    try {
      return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch {
      return fallback; // A tarball or a checkout without git still builds.
    }
  };
  const commit = git('git rev-parse --short HEAD', 'unknown');
  const dirty = git('git status --porcelain', '') !== '';
  return {
    commit: dirty ? `${commit}+local` : commit,
    subject: git('git log -1 --pretty=%s', ''),
    committed: git('git log -1 --pretty=%cI', ''),
    built: new Date().toISOString(),
  };
}

const info = buildInfo();

export default defineConfig({
  // Relative, so the build works under GitHub Pages' /25lbf-methalox-engine/ path and locally alike.
  base: './',
  define: {
    __BUILD__: JSON.stringify(info),
  },
  plugins: [
    {
      name: 'version-stamp',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify(info, null, 2) + '\n' });
      },
    },
  ],
  server: {
    port: 5175,
    open: true,
  },
  build: {
    target: 'esnext',
  },
});
