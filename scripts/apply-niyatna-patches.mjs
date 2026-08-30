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

  const createdMainWindow = mainWindow`

if (code.includes(targetTrayHook) && !code.includes('// System Tray Setup')) {
  code = code.replace(targetTrayHook, trayCode)
  console.log('[niyatna-patch] ✓ Injected System Tray & Close-to-Tray logic')
}

fs.writeFileSync(mainTsPath, code, 'utf8')
console.log('[niyatna-patch] Patch successfully applied!')
