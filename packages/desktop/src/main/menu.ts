import { Menu, BrowserWindow, app, shell } from "electron";

export function buildMenu(win: BrowserWindow | null): void {
  const isMac = process.platform === "darwin";

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" as const },
              { type: "separator" as const },
              { role: "services" as const },
              { type: "separator" as const },
              { role: "hide" as const },
              { role: "hideOthers" as const },
              { role: "unhide" as const },
              { type: "separator" as const },
              { role: "quit" as const },
            ],
          },
        ]
      : []),
    {
      label: "File",
      submenu: [
        {
          label: "Open Project Folder",
          accelerator: "CmdOrCtrl+O",
          click: () => win?.webContents.send("menu:open-project"),
        },
        {
          label: "Open User Data Folder",
          accelerator: "CmdOrCtrl+Shift+U",
          click: () => shell.openPath(app.getPath("userData")),
        },
        { type: "separator" },
        isMac ? { role: "close" as const } : { role: "quit" as const },
      ],
    },
    { label: "Edit", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
    { label: "View", submenu: [{ role: "reload" }, { role: "forceReload" }, { role: "toggleDevTools" }, { type: "separator" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" }, { role: "togglefullscreen" }] },
    // Win/Linux 上 `zoom` role 与 TitleBar 的 maximize 按钮重复,这里去掉;
    // macOS 上没有自定义按钮,保留 zoom 作为系统标准入口。
    { label: "Window", submenu: [
      { role: "minimize" },
      ...(isMac ? [{ role: "zoom" as const }] : []),
      ...(isMac ? [{ type: "separator" as const }, { role: "front" as const }] : []),
    ] },
    {
      role: "help",
      submenu: [
        { label: "Documentation", click: () => shell.openExternal("https://github.com/Narcooo/inkos#readme") },
        { label: "Report an Issue", click: () => shell.openExternal("https://github.com/Narcooo/inkos/issues") },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
