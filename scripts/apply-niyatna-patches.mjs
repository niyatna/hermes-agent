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

// 2. Patch createWindow for Native GTK Frame, show: true on Linux, and System Tray
code = code.replace(
  /show:\s*false,/,
  'show: IS_LINUX ? true : false,'
)

// Ensure frame: true on Linux
code = code.replace(
  "titleBarStyle: 'hidden',",
  "...(IS_LINUX ? { frame: true, titleBarStyle: 'default' as const, titleBarOverlay: false } : { titleBarStyle: 'hidden' as const }),"
)

const targetTrayHook = `  const createdMainWindow = mainWindow`
const trayCode = `  // System Tray Setup
  if (!(global as any).appTray) {
    const iconPath = getAppIconPath()
    if (iconPath) {
      try {
        const { Tray, Menu, nativeImage } = require('electron')
        let trayIcon = nativeImage.createFromPath(iconPath)
        if (!trayIcon.isEmpty()) {
          trayIcon = trayIcon.resize({ width: 22, height: 22 })
        }
        const tray = new Tray(trayIcon)
        ;(global as any).appTray = tray
        const contextMenu = Menu.buildFromTemplate([
          {
            label: 'Show Hermes',
            click: () => {
              if (mainWindow) {
                if (mainWindow.isMinimized()) mainWindow.restore()
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
              if (mainWindow.isMinimized()) mainWindow.restore()
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

  // Ensure window is revealed and focused on Linux
  if (IS_LINUX) {
    mainWindow.once('ready-to-show', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show()
        mainWindow.focus()
      }
    })
    mainWindow.webContents.once('did-finish-load', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show()
        mainWindow.focus()
      }
    })
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
