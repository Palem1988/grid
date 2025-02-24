const path = require('path')
const { menubar } = require('menubar')
const { Menu, shell } = require('electron')
const { registerGlobalPluginHost } = require('./ethereum_clients/PluginHost')
const { registerGlobalAppManager } = require('./grid_apps/AppManager')
const { registerGlobalUserConfig } = require('./Config')
const {
  registerPackageProtocol,
  AppManager
} = require('@philipplgh/electron-app-manager')
const { getMenuTemplate } = require('./Menu')
const { getCachePath } = require('./utils/main/util')
registerPackageProtocol(getCachePath('apps'))
registerGlobalUserConfig()

// Auto-launch may start process with --hidden
const startMinimized = (process.argv || []).indexOf('--hidden') !== -1

// used to check for "full" updates including electron binaries.
// will restart the app after download to apply updates if user clicks "ok"
const shellManager = new AppManager({
  repository: 'https://github.com/ethereum/grid',
  auto: true,
  electron: true
})

// Do not autohide nano on blur for Windows
// As we cannot guarantee the icon will be on the visible area
// of user's notification area in Windows, we set it to a "sticky mode" by default
// Windows users can still close Nano with <Esc> or <Control+W>.
let alwaysOnTop = !process.platform === 'darwin'

const preloadPath = path.join(__dirname, 'preload.js')

const makePath = p =>
  (process.platform !== 'win32' ? 'file://' : '') + path.normalize(p)

const iconPath = () =>
  path.resolve(
    process.platform === 'win32'
      ? `${__dirname}/build/TrayIcon.ico`
      : `${__dirname}/build/IconTemplate.png`
  )

const mb = menubar({
  browserWindow: {
    alwaysOnTop: alwaysOnTop,
    transparent: true,
    backgroundColor: '#00FFFFFF',
    frame: false,
    resizable: false,
    fullscreenable: false,
    width: 320,
    height: 420,
    webPreferences: {
      preload: preloadPath
    },
    title: 'Grid Nano'
  },
  icon: iconPath(),
  index: makePath(`${__dirname}/ui/nano.html`),
  showDockIcon: true
})

const init = function(mb) {
  const app = mb.app
  // make sure every webview has nodeIntegration turned off and has only access to the API defined by
  // preload-webview.js
  app.on('web-contents-created', (event, contents) => {
    // https://electronjs.org/docs/tutorial/security#11-verify-webview-options-before-creation
    contents.on('will-attach-webview', (event, webPreferences, params) => {
      // Strip away preload scripts if unused or verify their location is legitimate
      delete webPreferences.preload
      delete webPreferences.preloadURL

      // console.log('will attach webview')
      webPreferences.preload = path.join(__dirname, 'preload-webview')

      // Disable Node.js integration
      webPreferences.nodeIntegration = false
    })
  })

  const template = getMenuTemplate()
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))

  const pluginHost = registerGlobalPluginHost()

  app.on('quit', () => {
    const plugins = pluginHost.getAllPlugins()
    plugins.forEach(p => {
      if (!p.plugin.process || p.plugin.process.state === 'STOPPED') {
        console.log('Plugin already stopped:', p.name)
      } else {
        console.log('Forcefully shutting down plugin:', p.name)
        p.plugin.process.proc.kill('SIGINT')
      }
    })
  })

  mb.on('ready', () => {
    const appManager = registerGlobalAppManager()

    // Unsure of linux distros behavior with menubar
    // so for now we will always show on launch
    // if (!startMinimized) {
    //   mb.showWindow()
    // }
    mb.showWindow()
  })

  // right-click menu for tray
  mb.on('after-create-window', function() {
    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Keep window open',
        type: 'checkbox',
        checked: alwaysOnTop,
        click: () => {
          alwaysOnTop = !alwaysOnTop
          // Toggles alwaysOnTop property of nano window
          mb.window.setAlwaysOnTop(alwaysOnTop)
        }
      },
      { type: 'separator' },
      {
        label: 'Feedback',
        click: () => {
          shell.openExternal('https://forms.gle/bjkphVS8ca1JzwL46')
          mb.hideWindow()
        }
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          mb.app.quit()
        }
      }
    ])
    mb.tray.on('right-click', () => {
      mb.tray.popUpContextMenu(contextMenu)
    })

    // Syncs tray icon highlight state on mac
    mb.window.on('hide', () => mb.hideWindow())
  })
}

/**
 * requestSingleInstanceLock makes your application a Single Instance Application - instead of
 * allowing multiple instances of your app to run, this will ensure that only a
 * single instance of your app is running, and other instances signal this instance
 * and exit.
 * https://github.com/electron/electron/blob/f6a29707b64bc2f7364f89096d187246bfc53765/docs/api/app.md#apprequestsingleinstancelock
 */
const gotTheLock = mb.app.requestSingleInstanceLock()
// If user tries to open another instance of Grid, the new one will quit
if (!gotTheLock) {
  mb.app.quit()
} else {
  // When another Grid instance is trying to run, we tell the original instance to show Nano window.
  mb.app.on('second-instance', (event, commandLine, workingDirectory) => {
    if (mb.window) {
      mb.showWindow()
    }
  })
  init(mb)
}
