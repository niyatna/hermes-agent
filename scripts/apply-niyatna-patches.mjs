import fs from 'node:fs'
import path from 'node:path'

const repoRoot = process.cwd()
const mainTsPath = path.join(repoRoot, 'apps/desktop/electron/main.ts')

if (!fs.existsSync(mainTsPath)) {
  console.error(`[niyatna-patch] main.ts not found at: ${mainTsPath}`)
  process.exit(1)
}

let code = fs.readFileSync(mainTsPath, 'utf8')

console.log('[niyatna-patch] Applying Niyatna System Tray & Native GTK Window Controls patch...')

// 1. Patch getTitleBarOverlayOptions to return false on Linux
if (code.includes('function getTitleBarOverlayOptions() {') && !code.includes('if (IS_LINUX) {\n    return false\n  }')) {
  code = code.replace(
    'function getTitleBarOverlayOptions() {',
    'function getTitleBarOverlayOptions() {\n  if (IS_LINUX) {\n    return false\n  }'
  )
  console.log('[niyatna-patch] ✓ Patched getTitleBarOverlayOptions for Linux native frame')
}

// 2. Patch createWindow for Native GTK Frame & System Tray
const targetCreateWin = `    titleBarStyle: 'hidden',
    titleBarOverlay: getTitleBarOverlayOptions(),
    trafficLightPosition: IS_MAC ? WINDOW_BUTTON_POSITION : undefined,`

const replacementCreateWin = `    ...(IS_LINUX
      ? { frame: true, titleBarStyle: 'default' as const, titleBarOverlay: false }
      : {
          titleBarStyle: 'hidden' as const,
          titleBarOverlay: getTitleBarOverlayOptions(),
          trafficLightPosition: IS_MAC ? WINDOW_BUTTON_POSITION : undefined
        }),`

if (code.includes(targetCreateWin)) {
  code = code.replace(targetCreateWin, replacementCreateWin)
  console.log('[niyatna-patch] ✓ Patched BrowserWindow frame options for Linux')
}

const targetTrayHook = `  const createdMainWindow = mainWindow`
const trayCode = `  // System Tray Setup
  if (!(global as any).appTray) {
    const iconPath = getAppIconPath()
    if (iconPath) {
      try {
        const { Tray, Menu } = require('electron')
        const tray = new Tray(iconPath)
        ;(global as any).appTray = tray
        const contextMenu = Menu.buildFromTemplate([
          {
            label: 'Show Hermes',
            click: () => {
              if (mainWindow) {
                mainWindow.show()
                mainWindow.focus()
              }
            }
          },
          {
            label: 'Quit',
            click: () => {
              ;(app as any).isQuiting = true
              app.quit()
            }
          }
        ])
        tray.setToolTip('Hermes Desktop')
        tray.setContextMenu(contextMenu)
        tray.on('click', () => {
          if (mainWindow) {
            if (mainWindow.isVisible()) {
              mainWindow.hide()
            } else {
              mainWindow.show()
              mainWindow.focus()
            }
          }
        })
      } catch (e) {
        console.error('Failed to create system tray:', e)
      }
    }
  }

  // Minimize to tray on close
  mainWindow.on('close', (event) => {
    if (!(app as any).isQuiting) {
      event.preventDefault()
      mainWindow.hide()
      return false
    }
  })

  // Ensure window is revealed on Linux
  if (IS_LINUX) {
    mainWindow.once('ready-to-show', () => {
      mainWindow?.show()
      mainWindow?.focus()
    })
    mainWindow.webContents.once('did-finish-load', () => {
      mainWindow?.show()
      mainWindow?.focus()
    })
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
        mainWindow.show()
        mainWindow.focus()
      }
    }, 1500)
  }

  const createdMainWindow = mainWindow`

if (code.includes(targetTrayHook) && !code.includes('// System Tray Setup')) {
  code = code.replace(targetTrayHook, trayCode)
  console.log('[niyatna-patch] ✓ Injected System Tray & Close-to-Tray logic')
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

fs.writeFileSync(mainTsPath, code, 'utf8')
console.log('[niyatna-patch] Patch successfully applied!')
