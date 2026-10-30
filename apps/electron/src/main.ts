import { app, BrowserWindow, net, protocol, session, shell, type WebContents } from 'electron';
import { dirname, relative, resolve, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import process from 'node:process';
import { isApprovedDevelopmentUrl, isSafeExternalUrl, isTrustedAppNavigation, isTrustedAppOrigin } from './security.js';

const appScheme = 'landexpert';
protocol.registerSchemesAsPrivileged([{
  scheme: appScheme,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
}]);

const mainDirectory = dirname(fileURLToPath(import.meta.url));
const rendererRoot = resolve(mainDirectory, '../electron-renderer');
const packagedUrl = `${appScheme}://app/index.html`;
const devUrlSetting = process.env.LAND_EXPERT_ELECTRON_DEV_URL;
if (devUrlSetting && !isApprovedDevelopmentUrl(devUrlSetting)) {
  throw new Error('Electron development URL must be the approved local Vite origin.');
}
const devUrl = devUrlSetting ? new URL(devUrlSetting).href : null;
const trustedUrl = devUrl ?? packagedUrl;
let mainWindow: BrowserWindow | null = null;

function servePackagedRenderer(): void {
  protocol.handle(appScheme, async request => {
    try {
      const url = new URL(request.url);
      if (url.host !== 'app' || request.method !== 'GET') return new Response('Not found', { status: 404 });
      const pathname = decodeURIComponent(url.pathname);
      const candidate = resolve(rendererRoot, `.${pathname}`);
      const pathFromRoot = relative(rendererRoot, candidate);
      if (!pathname.startsWith('/') || pathFromRoot.startsWith('..') || isAbsolute(pathFromRoot)) {
        return new Response('Forbidden', { status: 403 });
      }
      return await net.fetch(pathToFileURL(candidate).href);
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

function configurePermissions(): void {
  const permitted = (contents: WebContents | null, permission: string, requestingUrl: string, isMainFrame: boolean) =>
    Boolean(contents && contents === mainWindow?.webContents)
      && isMainFrame
      && (permission === 'geolocation' || permission === 'geolocation-approximate')
      && isTrustedAppNavigation(requestingUrl, trustedUrl);
  session.defaultSession.setPermissionCheckHandler((contents, permission, requestingOrigin, details) =>
    permitted(contents, permission, details.requestingUrl ?? requestingOrigin, details.isMainFrame)
      && isTrustedAppOrigin(requestingOrigin, trustedUrl));
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    const requestingUrl = 'requestingUrl' in details ? details.requestingUrl : '';
    const isMainFrame = 'isMainFrame' in details && details.isMainFrame;
    callback(permitted(contents, permission, requestingUrl, isMainFrame));
  });
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 320,
    minHeight: 480,
    show: false,
    title: 'Land Expert',
    backgroundColor: '#f5f7f4',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });
  mainWindow = window;
  window.once('ready-to-show', () => window.show());
  window.on('closed', () => { if (mainWindow === window) mainWindow = null; });
  window.webContents.on('will-navigate', (event, navigationUrl) => {
    if (!isTrustedAppNavigation(navigationUrl, trustedUrl)) event.preventDefault();
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url).catch(() => undefined);
    return { action: 'deny' };
  });
  if (devUrl) void window.loadURL(devUrl);
  else void window.loadURL(packagedUrl);
}

app.whenReady().then(() => {
  if (!devUrl) servePackagedRenderer();
  configurePermissions();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}).catch(error => {
  console.error('Land Expert desktop shell failed to start.', error);
  app.quit();
});

app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', event => event.preventDefault());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
