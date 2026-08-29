import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const packageId = 'dsh-store-account-manager'
const root = dirname(fileURLToPath(import.meta.url))
const lib = resolve(root, 'lib')

await mkdir(lib, { recursive: true })

await build({
  entryPoints: [resolve(root, 'src/index.ts')],
  outfile: resolve(lib, 'index.js'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  sourcemap: 'external',
  packages: 'external',
})

const client = await build({
  entryPoints: [resolve(root, 'src/client/index.tsx')],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  external: [
    'react',
    'react/jsx-runtime',
    '@deepseek-ai/cordis',
    '@deepseek-ai/dsh-client-ui-slots',
    '@deepseek-ai/dsh-client-ui-settings/client',
    '@deepseek-ai/dsh-client-locale/client',
  ],
})

const output = client.outputFiles.find(file => file.path.endsWith('.js')) || client.outputFiles[0]
if (!output) throw new Error('client build did not produce JavaScript')

const wrapped = `window.__ModuleLoader__.load({\n  id: ${JSON.stringify(packageId)},\n  factory: (require) => {\n    var module = { exports: {} };\n    var exports = module.exports;\n${output.text}\n    return module.exports;\n  }\n});\n`

await writeFile(resolve(lib, 'client.js'), wrapped, 'utf8')
