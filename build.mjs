
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
  // Runtime dependencies are installed from package.json. zod stays external so the server and the SDK
  // share one copy (bundling zod 4 also inflated the output to ~800 kB).
  external: ['@modelcontextprotocol/sdk', 'zod'],
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
      await esbuild.build(buildOptions);
      postBuild();
      console.log('Build finished.');
    }
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

build();
