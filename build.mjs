
import esbuild from 'esbuild';
import { exec } from 'child_process';

const isWatch = process.argv.includes('--watch');

esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node16',
  outfile: 'build/index.mjs',
  format: 'esm',
  external: ['@modelcontextprotocol/sdk'],
  banner: {
    js: '#!/usr/bin/env node',
  },
  watch: isWatch ? {
    onRebuild(error, result) {
      if (error) console.error('watch build failed:', error);
      else console.log('watch build succeeded:', result);
    },
  } : undefined,
}).then(() => {
  exec('chmod +x build/index.mjs', (err, stdout, stderr) => {
    if (err) {
      console.error(err);
      return;
    }
    console.log(stdout);
    console.error(stderr);
  });
  console.log(isWatch ? 'Watching for changes...' : 'Build finished.');
}).catch(() => process.exit(1));
