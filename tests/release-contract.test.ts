import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

describe.each([['LF', '\n'], ['CRLF', '\r\n']])('release metadata with %s checkout', (_name, newline) => {
  test.each([true, false])('accepts only matching release notes (matching=%s)', matching => {
    const parent = resolve(tmpdir());
    const root = mkdtempSync(join(parent, 'fyraplayer-release-contract-'));
    try {
      mkdirSync(join(root, 'checks'));
      mkdirSync(join(root, 'docs'));
      copyFileSync(resolve('checks/release-contract.mjs'), join(root, 'checks/release-contract.mjs'));
      const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));
      writeFileSync(join(root, 'package.json'), JSON.stringify(pkg));
      const documents: Record<string, string> = {
        'CHANGELOG.md': '## ' + pkg.version,
        'RELEASE_NOTES.md': '# FyraPlayer ' + (matching ? pkg.version : '0.0.0'),
        'README.md': pkg.version,
        'docs/README.md': pkg.version,
        'docs/api.md': pkg.version,
      };
      for (const [name, content] of Object.entries(documents)) {
        writeFileSync(join(root, name), content + newline);
      }
      const result = spawnSync(process.execPath, [join(root, 'checks/release-contract.mjs')], {
        encoding: 'utf8', windowsHide: true,
      });
      if (result.error) throw result.error;
      expect(result.status).toBe(matching ? 0 : 1);
      expect(matching ? result.stdout : result.stderr).toContain(
        matching ? 'Release metadata: ' + pkg.version : 'Release notes/version mismatch',
      );
    } finally {
      if (!resolve(root).startsWith(parent + sep)) throw new Error('Unsafe temporary path');
      rmSync(root, { recursive: true, force: true });
    }
  });
});
