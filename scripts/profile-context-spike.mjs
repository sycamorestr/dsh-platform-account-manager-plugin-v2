import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const executable = process.argv[2] || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const root = process.argv[3] || join(tmpdir(), `browser-profile-spike-${Date.now()}`)
const port = Number(process.argv[4] || 19451)
const headed = process.argv.includes('--headed')

await mkdir(root, { recursive: true })

const common = [
  `--user-data-dir=${root}`,
  '--remote-debugging-address=127.0.0.1',
  `--remote-debugging-port=${port}`,
  '--no-first-run',
  '--no-default-browser-check',
  ...(headed ? ['--start-minimized'] : ['--headless=new']),
]

function launch(profile, url) {
  const child = spawn(executable, [...common, `--profile-directory=${profile}`, url], {
    stdio: 'ignore',
    windowsHide: true,
  })
  child.on('error', error => {
    console.error(error)
    process.exitCode = 1
  })
  return child
}

async function waitForVersion() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (response.ok) return await response.json()
    } catch {
      // The temporary browser is still starting.
    }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error('temporary Edge CDP endpoint did not start')
}

function cdpRequest(endpoint, method, params) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(endpoint)
    const timeout = setTimeout(() => {
      socket.close()
      reject(new Error(`${method} timed out`))
    }, 5000)
    socket.addEventListener('open', () => socket.send(JSON.stringify({ id: 1, method, ...(params ? { params } : {}) })))
    socket.addEventListener('message', event => {
      const message = JSON.parse(String(event.data))
      if (message.id !== 1) return
      clearTimeout(timeout)
      socket.close()
      if (message.error) reject(new Error(message.error.message))
      else resolve(message.result)
    })
    socket.addEventListener('error', () => reject(new Error(`${method} failed`)))
  })
}

async function closeBrowser(endpoint) {
  try {
    await cdpRequest(endpoint, 'Browser.close')
  } catch {
    // Browser.close normally tears down the connection before responding.
  }
}

const first = launch('Profile 1', 'https://example.com/#dsh-profile-one')
let endpoint
try {
  const version = await waitForVersion()
  endpoint = version.webSocketDebuggerUrl
  const second = launch('Profile 2', 'https://example.org/#dsh-profile-two')
  await new Promise(resolve => setTimeout(resolve, 3000))
  const result = await cdpRequest(endpoint, 'Target.getTargets')
  const targets = result.targetInfos
    .filter(target => target.type === 'page')
    .map(target => ({
      targetId: target.targetId,
      url: target.url,
      browserContextId: target.browserContextId,
    }))
  const targetList = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  const profileTargets = targetList.filter(target => target.type === 'page'
    && (target.url.includes('dsh-profile-one') || target.url.includes('dsh-profile-two')))
  const cookieIsolation = []
  for (const [index, target] of profileTargets.entries()) {
    const value = `profile-${index + 1}`
    await cdpRequest(target.webSocketDebuggerUrl, 'Storage.setCookies', {
      cookies: [{ name: 'dsh_profile_spike', value, url: 'https://example.com/' }],
    })
    const stored = await cdpRequest(target.webSocketDebuggerUrl, 'Storage.getCookies')
    cookieIsolation.push({
      targetId: target.id,
      value: stored.cookies.find(cookie => cookie.name === 'dsh_profile_spike')?.value,
    })
  }
  console.log(JSON.stringify({
    root,
    browser: version.Browser,
    firstPid: first.pid,
    secondPid: second.pid,
    headed,
    targets,
    cookieIsolation,
  }, null, 2))
} finally {
  if (endpoint) await closeBrowser(endpoint)
  await new Promise(resolve => setTimeout(resolve, 500))
  if (!first.killed) first.kill()
}
