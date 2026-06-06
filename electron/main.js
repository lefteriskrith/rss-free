import { app as electronApp, BrowserWindow, dialog, shell } from "electron";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { app as expressApp } from "../server.js";

const ROOT_DIR = fileURLToPath(new URL("..", import.meta.url));
const ICON_PATH = join(ROOT_DIR, "build", "icon.ico");
const DESKTOP_PORT = Number(process.env.RSS_YO_DESKTOP_PORT || 51733);
let server;
let mainWindow;

async function startServer() {
  if (server) return server;

  return new Promise((resolve, reject) => {
    server = expressApp.listen(DESKTOP_PORT, "127.0.0.1", () => resolve(server));
    server.on("error", reject);
  });
}

async function createWindow() {
  try {
    await startServer();
  } catch (error) {
    dialog.showErrorBox(
      "RSS Yo could not start",
      `The local desktop server could not start on port ${DESKTOP_PORT}.\n\n${error.message}`
    );
    electronApp.quit();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 620,
    title: "RSS Yo",
    icon: ICON_PATH,
    backgroundColor: "#000000",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  await mainWindow.loadURL(`http://127.0.0.1:${DESKTOP_PORT}`);
}

electronApp.whenReady().then(createWindow);

electronApp.on("window-all-closed", () => {
  if (process.platform !== "darwin") electronApp.quit();
});

electronApp.on("before-quit", () => {
  if (server) server.close();
});

electronApp.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
