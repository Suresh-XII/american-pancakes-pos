"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listApplicationMenuEntries = listApplicationMenuEntries;
exports.isApplicationMenuSender = isApplicationMenuSender;
exports.openApplicationMenuSubmenu = openApplicationMenuSubmenu;
const window_readiness_1 = require("./window-readiness");
/**
 * Describes the top-level menu entries a frameless Windows/Linux title bar can
 * render. Electron never draws a menu bar for a frameless window, so the
 * renderer draws these labels and asks main to pop the real submenu; roles,
 * accelerators, and click handlers stay the ones `createMenu()` already built.
 */
function listApplicationMenuEntries(items) {
    const entries = [];
    items.forEach((item, index) => {
        if (item.type === 'separator' || !item.submenu)
            return;
        const label = typeof item.label === 'string' ? item.label.trim() : '';
        if (!label)
            return;
        entries.push({ key: String(index), label });
    });
    return entries;
}
/**
 * The submenu popup is a privileged native surface on the main window, so only
 * that window's own current renderer frame may request one. The localhost
 * origin check alone is not enough: other windows this process serves, such as
 * the KDS window, pass it while belonging to a different window.
 */
function isApplicationMenuSender(mainWindow, sender) {
    if (!mainWindow || mainWindow.isDestroyed())
        return false;
    if (sender.window !== mainWindow)
        return false;
    return (0, window_readiness_1.isCurrentRendererFrame)(sender.senderFrame, sender.currentFrame);
}
/**
 * Menu popup coordinates are relative to the window's content bounds, and
 * Electron reads a negative pair as "open at the cursor", so only the finite
 * non-negative coordinates the renderer measures from a button rect are valid.
 */
function isPopupCoordinate(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
/** Pops the submenu behind a title-bar entry label, an overflow menu, or the root hamburger menu. */
function openApplicationMenuSubmenu(menu, key, window, x, y) {
    if (!menu)
        return { error: 'Application menu unavailable' };
    if (!window || window.isDestroyed())
        return { error: 'Window unavailable' };
    if (typeof key !== 'string')
        return { error: 'Unknown menu entry' };
    if (!isPopupCoordinate(x) || !isPopupCoordinate(y))
        return { error: 'Invalid menu position' };
    const roundX = Math.round(x);
    const roundY = Math.round(y);
    try {
        if (key === 'hamburger' || key === 'all' || key === 'root') {
            menu.popup({ window, x: roundX, y: roundY });
            return { success: true };
        }
        if (key.startsWith('overflow:')) {
            const match = /^overflow:(\d+)$/.exec(key);
            if (!match)
                return { error: 'Unknown menu entry' };
            const startIndex = Number(match[1]);
            if (!Number.isSafeInteger(startIndex) || startIndex >= menu.items.length) {
                return { error: 'Unknown menu entry' };
            }
            const createOverflow = menu.createOverflowMenu;
            let overflowMenu;
            let MenuItemClass;
            if (typeof createOverflow === 'function') {
                overflowMenu = createOverflow();
            }
            else {
                let MenuClass;
                try {
                    const electron = require('electron');
                    if (electron) {
                        if (typeof electron.Menu === 'function')
                            MenuClass = electron.Menu;
                        if (typeof electron.MenuItem === 'function')
                            MenuItemClass = electron.MenuItem;
                    }
                }
                catch {
                    // Pure node environment fallback
                }
                overflowMenu = MenuClass ? new MenuClass() : new menu.constructor();
                if (!MenuItemClass && menu.items.length > 0) {
                    MenuItemClass = menu.items[0]?.constructor;
                }
            }
            for (let i = startIndex; i < menu.items.length; i++) {
                const item = menu.items[i];
                if (!item || item.type === 'separator' || !item.submenu)
                    continue;
                if (MenuItemClass) {
                    overflowMenu.append(new MenuItemClass({
                        label: item.label,
                        type: 'submenu',
                        submenu: item.submenu,
                    }));
                }
                else {
                    overflowMenu.append(item);
                }
            }
            if (overflowMenu.items.length === 0)
                return { error: 'Menu entry has no submenu' };
            overflowMenu.popup({ window, x: roundX, y: roundY });
            return { success: true };
        }
        if (!/^\d+$/.test(key))
            return { error: 'Unknown menu entry' };
        const item = menu.items[Number(key)];
        if (!item)
            return { error: 'Unknown menu entry' };
        if (!item.submenu)
            return { error: 'Menu entry has no submenu' };
        item.submenu.popup({ window, x: roundX, y: roundY });
        return { success: true };
    }
    catch (err) {
        return { error: err?.message || 'Menu popup failed' };
    }
}
//# sourceMappingURL=application-menu.js.map