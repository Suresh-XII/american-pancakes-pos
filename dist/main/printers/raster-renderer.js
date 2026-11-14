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
exports.DEFAULT_RASTER_IDLE_TIMEOUT_MS = exports.ChromiumRasterRenderer = void 0;
exports.rasterRendererHtml = rasterRendererHtml;
exports.whenRasterRendererReady = whenRasterRendererReady;
exports.getSharedRasterRenderer = getSharedRasterRenderer;
exports.destroySharedRasterRenderer = destroySharedRasterRenderer;
exports.renderRasterSemanticUnit = renderRasterSemanticUnit;
exports.applyTextSizeToRasterInput = applyTextSizeToRasterInput;
exports.renderUnsupportedRasterLines = renderUnsupportedRasterLines;
const electron_1 = require("electron");
const path = __importStar(require("node:path"));
const raster_1 = require("../../shared/print/raster");
const text_size_1 = require("../../shared/print/text-size");
const thermal_capabilities_1 = require("../../shared/print/thermal-capabilities");
const raster_canvas_1 = require("../../shared/print/raster-canvas");
const DEFAULT_RENDER_TIMEOUT_MS = 15_000;
const MAX_RENDER_TIMEOUT_MS = 2_147_483_647;
/** Self-contained page with no navigation, network access, or Node integration. */
function rasterRendererHtml() {
    return `<!doctype html><meta charset="utf-8"><title>Flo raster surface</title>
<style>html,body{margin:0;padding:0;background:#fff}canvas{display:block}</style>
<script>
const paintRasterRequest = ${raster_canvas_1.paintRasterRequest.toString()};
(() => {
  const api = window.__floRaster;
  if (!api) return;
  const familyName = (value) => /^[A-Za-z0-9 _-]{1,64}$/.test(value);
  const makeFailure = (request, code, detail) => ({ version: 1, requestId: request.requestId, ok: false, code, detail });
  const loadedFonts = new Map();
  const render = async (request) => {
    if (!request || request.version !== 1 || typeof request.text !== 'string' || typeof request.financial !== 'boolean' || (request.bundledFont !== undefined && (!request.bundledFont || !familyName(request.bundledFont.family)))) {
      return makeFailure(request || { requestId: '' }, 'invalid-request', 'Raster request failed validation');
    }
    try {
      if (request.bundledFont) {
        const fontKey = request.bundledFont.family + '|' + request.bundledFont.dataUrl;
        let font = loadedFonts.get(fontKey);
        if (!font) {
          font = new FontFace(request.bundledFont.family, 'url(' + request.bundledFont.dataUrl + ')');
          try {
            await font.load();
            document.fonts.add(font);
            loadedFonts.set(fontKey, font);
          } catch (error) {
            return makeFailure(request, 'font-unavailable', error instanceof Error ? error.message : String(error));
          }
        }
      }
      return paintRasterRequest(request, () => document.createElement('canvas'));
    } catch (error) {
      return makeFailure(request, 'render-failed', error instanceof Error ? error.message : String(error));
    }
  };
  api.onRequest(async (message) => {
    const request = message && message.request;
    api.sendResult({ version: 1, result: await render(request) });
  });
})();
</script>`;
}
/** Main-process owner for the dedicated, hidden Chromium raster surface. */
class ChromiumRasterRenderer {
    surface;
    timeoutMs;
    ipc;
    onActivity;
    pending = new Map();
    ready;
    readyResolve;
    readyTimer;
    readySettled = false;
    readyError = null;
    destroyed = false;
    onResult = (event, result) => {
        if (!this.isSurfaceSender(event.sender) || !result || typeof result !== 'object')
            return;
        const message = result;
        const candidate = message.result;
        if (!candidate || typeof candidate !== 'object')
            return;
        const candidateRecord = candidate;
        if (message.version !== 1 ||
            candidateRecord.version !== 1 ||
            typeof candidateRecord.requestId !== 'string')
            return;
        const requestId = candidateRecord.requestId;
        const entry = this.pending.get(requestId);
        if (!entry)
            return;
        clearTimeout(entry.timer);
        this.pending.delete(requestId);
        entry.resolve((0, raster_1.isRasterRenderResult)(candidate)
            ? candidate
            : {
                version: 1,
                requestId,
                ok: false,
                code: 'render-failed',
                detail: 'Raster renderer returned an invalid result',
            });
    };
    onReady = (event) => {
        if (this.isSurfaceSender(event.sender))
            this.settleReady();
    };
    onLoadFailure = (_event, errorCode, errorDescription) => {
        this.failSurface(`Raster surface failed to load (${errorCode}): ${errorDescription}`);
    };
    onSurfaceClosed = () => {
        this.failSurface('Raster surface was closed');
    };
    onRenderProcessGone = () => {
        this.failSurface('Raster renderer process exited');
    };
    constructor(options = {}) {
        const configuredTimeoutMs = Number(process.env.RASTER_RENDER_TIMEOUT_MS);
        const renderTimeoutMs = Number.isFinite(configuredTimeoutMs) &&
            Number.isInteger(configuredTimeoutMs) &&
            configuredTimeoutMs > 0 &&
            configuredTimeoutMs <= MAX_RENDER_TIMEOUT_MS
            ? configuredTimeoutMs
            : DEFAULT_RENDER_TIMEOUT_MS;
        this.timeoutMs = options.timeoutMs ?? renderTimeoutMs;
        this.ipc = options.ipc ?? electron_1.ipcMain;
        this.onActivity = options.onActivity;
        this.ready = new Promise((resolve) => {
            this.readyResolve = resolve;
        });
        const windowFactory = options.windowFactory ?? ((windowOptions) => new electron_1.BrowserWindow(windowOptions));
        this.surface = windowFactory({
            show: false,
            width: 1,
            height: 1,
            webPreferences: {
                preload: options.preloadPath ?? path.join(__dirname, '../raster-preload.js'),
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: true,
            },
        });
        this.ipc.on('flo:raster-ready', this.onReady);
        this.ipc.on('flo:raster-result', this.onResult);
        this.surface.on('closed', this.onSurfaceClosed);
        this.surface.webContents.on('did-fail-load', this.onLoadFailure);
        this.surface.webContents.on('render-process-gone', this.onRenderProcessGone);
        this.readyTimer = setTimeout(() => this.settleReady('Raster surface readiness timed out'), this.timeoutMs);
        void this.surface.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(rasterRendererHtml())}`);
    }
    isSurfaceSender(sender) {
        return sender === this.surface.webContents;
    }
    settleReady(error) {
        if (error && !this.readyError)
            this.readyError = error;
        if (this.readySettled)
            return;
        this.readySettled = true;
        clearTimeout(this.readyTimer);
        this.readyResolve();
    }
    failSurface(detail) {
        this.destroyed = true;
        this.settleReady(detail);
        for (const [requestId, entry] of this.pending.entries()) {
            clearTimeout(entry.timer);
            entry.resolve({ version: 1, requestId, ok: false, code: 'render-failed', detail });
        }
        this.pending.clear();
        this.ipc.removeListener('flo:raster-ready', this.onReady);
        this.ipc.removeListener('flo:raster-result', this.onResult);
        this.surface.removeListener('closed', this.onSurfaceClosed);
        this.surface.webContents.removeListener('did-fail-load', this.onLoadFailure);
        this.surface.webContents.removeListener('render-process-gone', this.onRenderProcessGone);
        if (!this.surface.isDestroyed()) {
            try {
                this.surface.close();
            }
            catch { }
        }
    }
    async render(request) {
        if (!(0, raster_1.isRasterRenderRequest)(request)) {
            const requestId = request &&
                typeof request === 'object' &&
                'requestId' in request &&
                typeof request.requestId === 'string'
                ? request.requestId
                : '';
            return {
                version: 1,
                requestId,
                ok: false,
                code: 'invalid-request',
                detail: 'Raster request failed validation',
            };
        }
        if (this.destroyed || this.surface.isDestroyed()) {
            return {
                version: 1,
                requestId: request.requestId,
                ok: false,
                code: 'render-failed',
                detail: this.readyError ?? 'Raster surface is unavailable',
            };
        }
        this.onActivity?.();
        await this.ready;
        if (this.readyError)
            return {
                version: 1,
                requestId: request.requestId,
                ok: false,
                code: 'render-failed',
                detail: this.readyError,
            };
        return await new Promise((resolve) => {
            if (this.pending.has(request.requestId)) {
                resolve({
                    version: 1,
                    requestId: request.requestId,
                    ok: false,
                    code: 'render-failed',
                    detail: 'Duplicate raster request ID',
                });
                return;
            }
            const timer = setTimeout(() => {
                this.pending.delete(request.requestId);
                resolve({
                    version: 1,
                    requestId: request.requestId,
                    ok: false,
                    code: 'render-failed',
                    detail: 'Raster rendering timed out',
                });
            }, this.timeoutMs);
            this.pending.set(request.requestId, { resolve, timer });
            try {
                this.surface.webContents.send('flo:raster-request', { version: 1, request });
            }
            catch (error) {
                clearTimeout(timer);
                this.pending.delete(request.requestId);
                resolve({
                    version: 1,
                    requestId: request.requestId,
                    ok: false,
                    code: 'render-failed',
                    detail: error instanceof Error ? error.message : 'Raster surface is unavailable',
                });
            }
        });
    }
    isDestroyed() {
        return this.destroyed || this.surface.isDestroyed();
    }
    destroy() {
        if (this.destroyed)
            return;
        this.failSurface('Raster surface was closed');
    }
}
exports.ChromiumRasterRenderer = ChromiumRasterRenderer;
exports.DEFAULT_RASTER_IDLE_TIMEOUT_MS = 300_000;
let sharedRasterRenderer = null;
let sharedRasterIdleTimer = null;
let sharedRasterIdleTimeoutMs = exports.DEFAULT_RASTER_IDLE_TIMEOUT_MS;
function resetSharedRasterIdleTimer() {
    if (sharedRasterIdleTimer) {
        clearTimeout(sharedRasterIdleTimer);
        sharedRasterIdleTimer = null;
    }
    if (sharedRasterRenderer && !sharedRasterRenderer.isDestroyed()) {
        sharedRasterIdleTimer = setTimeout(() => {
            destroySharedRasterRenderer();
        }, sharedRasterIdleTimeoutMs);
    }
}
/** Wait for Electron readiness, since a BrowserWindow cannot exist before it. */
async function whenRasterRendererReady(targetApp = electron_1.app) {
    if (targetApp &&
        typeof targetApp.isReady === 'function' &&
        typeof targetApp.whenReady === 'function' &&
        !targetApp.isReady()) {
        await targetApp.whenReady();
    }
}
/** Obtain the warm shared Chromium raster singleton, recreating if needed. */
function getSharedRasterRenderer(options) {
    if (options?.idleTimeoutMs !== undefined) {
        sharedRasterIdleTimeoutMs = options.idleTimeoutMs;
    }
    if (!sharedRasterRenderer || sharedRasterRenderer.isDestroyed()) {
        const userOnActivity = options?.onActivity;
        sharedRasterRenderer = new ChromiumRasterRenderer({
            ...options,
            onActivity: () => {
                userOnActivity?.();
                resetSharedRasterIdleTimer();
            },
        });
    }
    resetSharedRasterIdleTimer();
    return sharedRasterRenderer;
}
/** Teardown the shared raster singleton if active. */
function destroySharedRasterRenderer() {
    if (sharedRasterIdleTimer) {
        clearTimeout(sharedRasterIdleTimer);
        sharedRasterIdleTimer = null;
    }
    if (sharedRasterRenderer) {
        const renderer = sharedRasterRenderer;
        sharedRasterRenderer = null;
        renderer.destroy();
    }
}
/** Attach the semantic financial boundary only after a successful full render. */
async function renderRasterSemanticUnit(renderer, request, financial) {
    const result = await renderer.render(request);
    if (!result.ok)
        return { ok: false, code: result.code, detail: result.detail, financial };
    if (!result.unit.complete || result.unit.bands.length === 0) {
        return {
            ok: false,
            code: 'render-failed',
            detail: 'Raster renderer returned an incomplete semantic unit',
            financial,
        };
    }
    return { ok: true, unit: { ...result.unit, financial, complete: true } };
}
function mapPhysicalSourceLines(group) {
    if (!group.sourceLines) {
        return Array.from({ length: group.lineCount }, (_, offset) => ({
            lineIndex: group.lineIndex + offset,
            lineCount: 1,
            controlLine: group.lines[offset] ?? '',
        }));
    }
    const controlLines = group.sourceControlLines;
    if (!controlLines) {
        return group.sourceLines.length === group.lineCount
            ? group.sourceLines.map((_, sourceIndex) => ({
                lineIndex: group.lineIndex + sourceIndex,
                lineCount: 1,
                sourceIndex,
                controlLine: group.lines[sourceIndex] ?? '',
            }))
            : null;
    }
    if (controlLines.length !== group.sourceLines.length || controlLines.length === 0)
        return null;
    const starts = [];
    let cursor = 0;
    for (const controlLine of controlLines) {
        const start = group.lines.indexOf(controlLine, cursor);
        if (start < 0 || (starts.length === 0 && start !== 0))
            return null;
        starts.push(start);
        cursor = start + 1;
    }
    const ranges = starts.map((start, sourceIndex) => ({
        lineIndex: group.lineIndex + start,
        lineCount: (starts[sourceIndex + 1] ?? group.lines.length) - start,
        sourceIndex,
        controlLine: controlLines[sourceIndex],
    }));
    return ranges.every((range) => range.lineCount > 0) &&
        ranges.at(-1).lineIndex + ranges.at(-1).lineCount === group.lineIndex + group.lineCount
        ? ranges
        : null;
}
function semanticLineGroups(lines) {
    const groups = [];
    for (let lineIndex = 0; lineIndex < lines.length;) {
        const line = lines[lineIndex];
        const kotItem = line.includes('{DOUBLE_HEIGHT}') && line.includes('{BOLD}') && !line.includes('{/CENTER}');
        if (kotItem) {
            const end = lineIndex + 1;
            let next = end;
            while (next < lines.length) {
                const candidate = lines[next];
                if (candidate.includes('{CUT}') || /^[-=]{8,}$/.test(candidate))
                    break;
                if (kotItem && candidate.includes('{DOUBLE_HEIGHT}') && candidate.includes('{BOLD}'))
                    break;
                next += 1;
            }
            groups.push({
                groupId: `kot-item-${lineIndex}`,
                lineIndex,
                lineCount: next - lineIndex,
                lines: lines.slice(lineIndex, next),
            });
            lineIndex = next;
            continue;
        }
        groups.push({ groupId: `line-${lineIndex}`, lineIndex, lineCount: 1, lines: [line] });
        lineIndex += 1;
    }
    return groups;
}
/** Enlarges raster input lines and the control lines that group metadata matches against. */
function applyTextSizeToRasterInput(lines, groups, textSize) {
    if (textSize === 'normal')
        return { lines, groups };
    const enlarge = (line) => (0, text_size_1.applyTextSizeToLine)(line, textSize);
    return {
        lines: lines.map(enlarge),
        groups: (groups ?? semanticLineGroups(lines)).map((group) => ({
            ...group,
            ...(group.sourceControlLines
                ? { sourceControlLines: group.sourceControlLines.map(enlarge) }
                : {}),
        })),
    };
}
const RASTER_CONTROL_TOKEN_RE = /\{(?:\/?(?:CENTER|BOLD|DOUBLE_HEIGHT|DOUBLE_WIDTH|FONT_B)|INIT|CUT|FEED|STORE_NAME|FINANCIAL)\}/g;
function stripRasterControlTokens(line) {
    return line.replace(RASTER_CONTROL_TOKEN_RE, '');
}
function controlMetadataLine(line, sourceText) {
    if (sourceText === undefined)
        return line;
    if (sourceText.length === 0)
        return line;
    let sourceIndex = line.indexOf(sourceText);
    while (sourceIndex >= 0) {
        const tokenStart = line.lastIndexOf('{', sourceIndex);
        const tokenEnd = tokenStart >= 0 ? line.indexOf('}', tokenStart) : -1;
        if (tokenStart < 0 || tokenStart === sourceIndex || tokenEnd < sourceIndex) {
            return line.slice(0, sourceIndex) + line.slice(sourceIndex + sourceText.length);
        }
        sourceIndex = line.indexOf(sourceText, sourceIndex + sourceText.length);
    }
    let metadataLine = line;
    for (const token of sourceText.match(RASTER_CONTROL_TOKEN_RE) ?? []) {
        const tokenIndex = metadataLine.lastIndexOf(token);
        if (tokenIndex >= 0)
            metadataLine =
                metadataLine.slice(0, tokenIndex) + metadataLine.slice(tokenIndex + token.length);
    }
    return metadataLine;
}
function requestForRasterLine(line, lineIndex, capabilities, requestId, financial, sourceText, layout) {
    const metadataLine = controlMetadataLine(line, sourceText);
    if (metadataLine.includes('{INIT}') ||
        metadataLine.includes('{CUT}') ||
        metadataLine.includes('{FEED}'))
        return null;
    const text = sourceText !== undefined ? sourceText || ' ' : stripRasterControlTokens(line) || ' ';
    const styles = [
        metadataLine.includes('{BOLD}') ? 'bold' : null,
        metadataLine.includes('{DOUBLE_HEIGHT}') ? 'double-height' : null,
        metadataLine.includes('{DOUBLE_WIDTH}') ? 'double-width' : null,
        metadataLine.includes('{FONT_B}') ? 'font-b' : null,
    ].filter((style) => style !== null);
    return {
        version: 1,
        requestId: `${requestId}-${lineIndex}`,
        text,
        widthDots: capabilities.raster.widthDots,
        maxBandHeight: capabilities.raster.maxBandHeight,
        direction: /[\u0590-\u08FF\uFB50-\uFEFF]/.test(text) ? 'rtl' : 'ltr',
        align: metadataLine.includes('{CENTER}') && metadataLine.includes('{/CENTER}') ? 'center' : 'left',
        ...(layout ? { layout } : {}),
        style: metadataLine.includes('{DOUBLE_HEIGHT}')
            ? 'double-height'
            : metadataLine.includes('{DOUBLE_WIDTH}')
                ? 'double-width'
                : metadataLine.includes('{FONT_B}')
                    ? 'font-b'
                    : metadataLine.includes('{BOLD}')
                        ? 'bold'
                        : 'normal',
        ...(styles.length > 0 ? { styles } : {}),
        financial,
        maxLines: 256,
        ...(capabilities.raster.font ? { bundledFont: capabilities.raster.font } : {}),
    };
}
async function renderUnsupportedRasterLines(renderer, lines, capabilities, requestPrefix, rasterGroups) {
    const units = [];
    const failures = [];
    const groups = rasterGroups
        ? rasterGroups.flatMap((group) => {
            const valid = Number.isSafeInteger(group.lineIndex) &&
                Number.isSafeInteger(group.lineCount) &&
                group.lineIndex >= 0 &&
                group.lineCount > 0 &&
                group.lineIndex + group.lineCount <= lines.length;
            if (!valid) {
                failures.push({
                    lineIndex: Number.isSafeInteger(group.lineIndex) ? group.lineIndex : 0,
                    lineCount: Number.isSafeInteger(group.lineCount) && group.lineCount > 0 ? group.lineCount : 1,
                    text: (group.sourceLines ?? []).filter(Boolean).join('\n'),
                    financial: group.financial === true,
                    code: 'invalid-range',
                    detail: 'Raster semantic group range is outside the print document',
                });
                return [];
            }
            return [
                { ...group, lines: lines.slice(group.lineIndex, group.lineIndex + group.lineCount) },
            ];
        })
        : semanticLineGroups(lines);
    const overlappingGroups = new Set();
    for (let leftIndex = 0; leftIndex < groups.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < groups.length; rightIndex += 1) {
            const left = groups[leftIndex];
            const right = groups[rightIndex];
            if (left.lineIndex < right.lineIndex + right.lineCount &&
                right.lineIndex < left.lineIndex + left.lineCount) {
                overlappingGroups.add(left);
                overlappingGroups.add(right);
            }
        }
    }
    for (const group of overlappingGroups) {
        failures.push({
            lineIndex: group.lineIndex,
            lineCount: group.lineCount,
            text: (group.sourceLines ?? group.lines.map(stripRasterControlTokens))
                .filter(Boolean)
                .join('\n'),
            financial: group.financial === true,
            code: 'invalid-range',
            detail: 'Raster semantic groups overlap in the print document',
        });
    }
    const covered = new Set(groups.flatMap((group) => Array.from({ length: group.lineCount }, (_, offset) => group.lineIndex + offset)));
    const completeGroups = groups.filter((group) => !overlappingGroups.has(group));
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        if (!covered.has(lineIndex))
            completeGroups.push({
                groupId: `line-${lineIndex}`,
                lineIndex,
                lineCount: 1,
                lines: [lines[lineIndex]],
            });
    }
    completeGroups.sort((left, right) => left.lineIndex - right.lineIndex);
    const semanticGroups = Array.from(completeGroups.reduce((groups, group) => {
        const ranges = groups.get(group.groupId) ?? [];
        ranges.push(group);
        groups.set(group.groupId, ranges);
        return groups;
    }, new Map()))
        .map(([, ranges]) => ranges)
        .sort((left, right) => left[0].lineIndex - right[0].lineIndex);
    for (const ranges of semanticGroups) {
        const group = ranges[0];
        const groupText = ranges
            .flatMap((range) => range.sourceLines
            ? Array.from(range.sourceLines)
            : range.lines.map(stripRasterControlTokens))
            .filter(Boolean)
            .join('\n');
        const needsRaster = ranges.some((range) => (range.sourceLines ?? range.lines).some((line) => {
            const text = range.sourceLines ? line : stripRasterControlTokens(line);
            return text.length > 0 && !(0, thermal_capabilities_1.isThermalTextRepresentable)(text, capabilities);
        }));
        if (!needsRaster)
            continue;
        const financial = ranges.some((range) => range.financial === true);
        const renderedRanges = [];
        let failure = null;
        for (const range of ranges) {
            const renderedUnits = [];
            const physicalSourceLines = mapPhysicalSourceLines(range);
            if (!physicalSourceLines) {
                failure = {
                    lineIndex: range.lineIndex,
                    lineCount: range.lineCount,
                    text: groupText,
                    financial,
                    code: 'invalid-range',
                    detail: 'Raster semantic source rows do not map to physical print lines',
                };
                break;
            }
            for (const physicalSourceLine of physicalSourceLines) {
                const sourceText = physicalSourceLine.sourceIndex === undefined
                    ? undefined
                    : range.sourceLines[physicalSourceLine.sourceIndex];
                const layoutFinancial = physicalSourceLine.sourceIndex === undefined
                    ? financial
                    : (range.financialSourceLines?.[physicalSourceLine.sourceIndex] ?? financial);
                const layout = sourceText !== undefined && layoutFinancial
                    ? range.sourceLayouts?.[physicalSourceLine.sourceIndex]
                    : undefined;
                const request = requestForRasterLine(physicalSourceLine.controlLine, physicalSourceLine.lineIndex, capabilities, requestPrefix, layoutFinancial, sourceText, layout);
                if (!request)
                    continue;
                let result;
                try {
                    result = await renderRasterSemanticUnit(renderer, request, layoutFinancial);
                }
                catch (error) {
                    result = {
                        ok: false,
                        code: 'render-failed',
                        detail: error instanceof Error ? error.message : String(error),
                        financial: layoutFinancial,
                    };
                }
                if (!result.ok) {
                    failure = {
                        lineIndex: range.lineIndex,
                        lineCount: range.lineCount,
                        text: groupText,
                        financial: result.financial,
                        code: result.code,
                        detail: result.detail,
                    };
                    break;
                }
                renderedUnits.push(result.unit);
            }
            if (failure)
                break;
            renderedRanges.push({
                lineIndex: range.lineIndex,
                lineCount: range.lines.length,
                bands: renderedUnits.flatMap((unit) => unit.bands),
            });
        }
        if (failure) {
            const groupFailure = failure;
            failures.push(...ranges.map((range) => ({
                ...groupFailure,
                lineIndex: range.lineIndex,
                lineCount: range.lines.length,
            })));
            continue;
        }
        units.push(...renderedRanges.map((range) => ({
            lineIndex: range.lineIndex,
            lineCount: range.lineCount,
            unit: {
                unitId: ranges.length === 1 ? group.groupId : `${group.groupId}-${range.lineIndex}`,
                financial,
                complete: true,
                bands: range.bands,
            },
        })));
    }
    return { units, failures };
}
//# sourceMappingURL=raster-renderer.js.map