"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.rememberRestoreFileSelection = rememberRestoreFileSelection;
exports.clearRestoreFileSelection = clearRestoreFileSelection;
exports.peekRestoreFileSelection = peekRestoreFileSelection;
exports.consumeRestoreFileSelection = consumeRestoreFileSelection;
const crypto = __importStar(require("node:crypto"));
/**
 * A restore source is a filesystem path chosen by the operator in a native
 * dialog that only the main process can show. The dialog result is held here and
 * handed to the HTTP restore route as a single-use token, so a renderer that
 * asks to restore an arbitrary path it invented is refused: the only path the
 * route will accept is one the operator just picked in that dialog.
 */
let pendingSelection = null;
function rememberRestoreFileSelection(selectedPath) {
    const selection = { path: selectedPath, token: crypto.randomBytes(32).toString('hex') };
    pendingSelection = selection;
    return selection;
}
function clearRestoreFileSelection() {
    pendingSelection = null;
}
/** Returns the picked path for a matching token without consuming it, otherwise null. */
function peekRestoreFileSelection(token) {
    const selection = pendingSelection;
    if (!selection || !token)
        return null;
    const presented = Buffer.from(token, 'utf8');
    const expected = Buffer.from(selection.token, 'utf8');
    if (presented.length !== expected.length || !crypto.timingSafeEqual(presented, expected))
        return null;
    return selection.path;
}
/** Returns the picked path once for a matching token, otherwise null. */
function consumeRestoreFileSelection(token) {
    const path = peekRestoreFileSelection(token);
    if (!path)
        return null;
    pendingSelection = null;
    return path;
}
//# sourceMappingURL=restore-file-selection.js.map