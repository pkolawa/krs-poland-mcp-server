
import esbuild from 'esbuild';
import { exec } from 'child_process';

const isWatch = process.argv.includes('--watch');

const buildOptions = {
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
};

function postBuild() {
  exec('chmod +x build/index.mjs', (err, stdout, stderr) => {
    if (err) {
      console.error(`chmod error: ${err}`);
      return;
    }
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
  });
}

async function build() {
  try {
    if (isWatch) {
      const context = await esbuild.context(buildOptions);
      await context.watch();
      console.log('Watching for changes...');
    } else {
      const result = await esbuild.build(buildOptions);
      postBuild();
      console.log('Build finished.');
    }
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

build();
