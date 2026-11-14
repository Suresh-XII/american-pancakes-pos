import type { BrowserWindow, Menu, MenuItem, WebFrameMain } from 'electron';
/** A top-level application-menu entry the Windows/Linux title bar renders. */
export interface ApplicationMenuEntry {
    /** Position of the entry in `Menu.items`; echoed back to open its submenu. */
    key: string;
    label: string;
}
/** The slice of a top-level `MenuItem` a title-bar entry needs. */
export type ApplicationMenuItem = Pick<MenuItem, 'label' | 'type'> & Partial<Pick<MenuItem, 'submenu'>>;
/**
 * Describes the top-level menu entries a frameless Windows/Linux title bar can
 * render. Electron never draws a menu bar for a frameless window, so the
 * renderer draws these labels and asks main to pop the real submenu; roles,
 * accelerators, and click handlers stay the ones `createMenu()` already built.
 */
export declare function listApplicationMenuEntries(items: readonly ApplicationMenuItem[]): ApplicationMenuEntry[];
/**
 * The identity of the window and frame an application-menu request came from,
 * already resolved by the main process.
 */
export interface ApplicationMenuSender {
    /** Window the request came from, or null when it belongs to none. */
    window: BrowserWindow | null;
    /** The sending webContents' current main frame. */
    currentFrame: WebFrameMain | null;
    /** The frame the invoking message was actually delivered to. */
    senderFrame: WebFrameMain | null | undefined;
}
/**
 * The submenu popup is a privileged native surface on the main window, so only
 * that window's own current renderer frame may request one. The localhost
 * origin check alone is not enough: other windows this process serves, such as
 * the KDS window, pass it while belonging to a different window.
 */
export declare function isApplicationMenuSender(mainWindow: BrowserWindow | null, sender: ApplicationMenuSender): boolean;
/** Pops the submenu behind a title-bar entry label, an overflow menu, or the root hamburger menu. */
export declare function openApplicationMenuSubmenu(menu: Menu | null, key: unknown, window: BrowserWindow | null, x: unknown, y: unknown): {
    success: true;
} | {
    error: string;
};
//# sourceMappingURL=application-menu.d.ts.map