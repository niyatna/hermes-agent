import fs from 'node:fs'
import path from 'node:path'

const repoRoot = process.cwd()
const mainTsPath = path.join(repoRoot, 'apps/desktop/electron/main.ts')

if (!fs.existsSync(mainTsPath)) {
  console.error(`[niyatna-patch] main.ts not found at: ${mainTsPath}`)
  process.exit(1)
}

let code = fs.readFileSync(mainTsPath, 'utf8')

console.log('[niyatna-patch] Applying Niyatna Native GTK Window Controls patch...')

// 1. Patch getTitleBarOverlayOptions to return false on Linux
if (code.includes('function getTitleBarOverlayOptions() {') && !code.includes('if (process.platform === \'linux\') {\n    return false\n  }')) {
  code = code.replace(
    'function getTitleBarOverlayOptions() {',
    'function getTitleBarOverlayOptions() {\n  if (process.platform === \'linux\') {\n    return false\n  }'
  )
  console.log('[niyatna-patch] ✓ Patched getTitleBarOverlayOptions for Linux native frame')
}

// 2. Patch createWindow specifically
const createWinIdx = code.indexOf('function createWindow() {')
if (createWinIdx !== -1) {
  const before = code.slice(0, createWinIdx)
  let after = code.slice(createWinIdx)

  // Replace show: false inside createWindow
  after = after.replace('show: false,', 'show: process.platform === \'linux\' ? true : false,')
  console.log('[niyatna-patch] ✓ Forced show: true on Linux in createWindow')

  // Replace titleBar options inside createWindow
  const targetWinOpts = `    titleBarStyle: 'hidden',
    titleBarOverlay: getTitleBarOverlayOptions(),
    trafficLightPosition: IS_MAC ? WINDOW_BUTTON_POSITION : undefined,`

  const replaceWinOpts = `    ...(process.platform === 'linux'
      ? { frame: true, titleBarStyle: 'default' as const, titleBarOverlay: false }
      : {
          titleBarStyle: 'hidden' as const,
          titleBarOverlay: getTitleBarOverlayOptions(),
          trafficLightPosition: IS_MAC ? WINDOW_BUTTON_POSITION : undefined
        }),`

  if (after.includes(targetWinOpts)) {
    after = after.replace(targetWinOpts, replaceWinOpts)
    console.log('[niyatna-patch] ✓ Replaced window frame options with native GTK frame on Linux')
  }

  code = before + after
}

// 3. Patch second-instance to always restore and show window if hidden in tray
const targetSecondInstance = `    ensureMainWindow(mainWindow, {
      isReady: app.isReady(),
      createWindow,
      focusWindow,
      // deep-link delivery focuses a live window after its renderer is ready.
      focusExisting: !url
    })`

const replaceSecondInstance = `    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
    ensureMainWindow(mainWindow, {
      isReady: app.isReady(),
      createWindow,
      focusWindow,
      focusExisting: !url
    })`

if (code.includes(targetSecondInstance)) {
  code = code.replace(targetSecondInstance, replaceSecondInstance)
  console.log('[niyatna-patch] ✓ Patched second-instance to unhide from tray on dock click')
}

// 4. Cap electron-builder's heap for a 16GB CI runner
// run-electron-builder.mjs appends its own --max-old-space-size=16384 AFTER the
// inherited NODE_OPTIONS, so the last flag wins and the packaging pass dies in
// mark-compact on ubuntu-latest. Rewrite the constant instead.
const builderRunnerPath = path.join(repoRoot, 'apps/desktop/scripts/run-electron-builder.mjs')
if (fs.existsSync(builderRunnerPath)) {
  const runner = fs.readFileSync(builderRunnerPath, 'utf8')
  const capped = runner.replace(
    /const HEAP_FLAG = '--max-old-space-size=\d+'/,
    "const HEAP_FLAG = '--max-old-space-size=10240'"
  )
  if (capped !== runner) {
    fs.writeFileSync(builderRunnerPath, capped, 'utf8')
    console.log('[niyatna-patch] ✓ Capped electron-builder heap at 6144MB')
  }
}

fs.writeFileSync(mainTsPath, code, 'utf8')
console.log('[niyatna-patch] Patch successfully applied!')
