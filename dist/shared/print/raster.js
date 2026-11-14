"use strict";
/**
 * Renderer/transport-neutral raster contract for ESC/POS thermal printing.
 *
 * This module is deliberately pure: it knows nothing about Electron, fonts,
 * printers, or transports. A profile must opt into raster explicitly before
 * callers may encode a band. Pixels are packed MSB-first as required by
 * ESC/POS GS v 0 (m=0).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.GS_V_0_MODE = exports.DEFAULT_RASTER_MAX_BAND_HEIGHT = void 0;
exports.rasterCapabilityEnabled = rasterCapabilityEnabled;
exports.rasterWebUsbPathEnabled = rasterWebUsbPathEnabled;
exports.validateRasterBand = validateRasterBand;
exports.encodeGsV0Band = encodeGsV0Band;
exports.concatBytes = concatBytes;
exports.encodeRasterUnits = encodeRasterUnits;
exports.buildRasterDiagnosticBands = buildRasterDiagnosticBands;
exports.encodeWholeReceiptRaster = encodeWholeReceiptRaster;
exports.encodeMixedPrintParts = encodeMixedPrintParts;
exports.encodeRasterFeedAndCut = encodeRasterFeedAndCut;
exports.isBundledFontDataUrl = isBundledFontDataUrl;
exports.isRasterRenderRequest = isRasterRenderRequest;
exports.isRasterRenderResult = isRasterRenderResult;
exports.DEFAULT_RASTER_MAX_BAND_HEIGHT = 200;
const MAX_RASTER_WIDTH_DOTS = 8192;
exports.GS_V_0_MODE = 0;
function rasterCapabilityEnabled(capabilities, mode = 'mixed') {
    return (capabilities?.raster.enabled === true &&
        Number.isSafeInteger(capabilities.raster.widthDots) &&
        capabilities.raster.widthDots > 0 &&
        capabilities.raster.widthDots <= MAX_RASTER_WIDTH_DOTS &&
        Number.isSafeInteger(capabilities.raster.maxBandHeight) &&
        capabilities.raster.maxBandHeight > 0 &&
        capabilities.raster.maxBandHeight <= exports.DEFAULT_RASTER_MAX_BAND_HEIGHT &&
        capabilities.raster.modes.includes(mode));
}
function rasterWebUsbPathEnabled(capabilities, rendererAvailable, profileId) {
    return (rasterCapabilityEnabled(capabilities, 'mixed') &&
        rendererAvailable &&
        typeof profileId === 'string' &&
        profileId.length > 0);
}
function validateRasterBand(band, maxBandHeight = exports.DEFAULT_RASTER_MAX_BAND_HEIGHT) {
    if (!Number.isSafeInteger(maxBandHeight) || maxBandHeight <= 0 || maxBandHeight > 0xffff)
        throw new Error('Invalid maximum raster band height');
    if (!Number.isSafeInteger(band.widthDots) || band.widthDots <= 0)
        throw new Error('Raster width must be a positive integer');
    if (!Number.isSafeInteger(band.heightDots) || band.heightDots <= 0)
        throw new Error('Raster height must be a positive integer');
    if (band.heightDots > 0xffff)
        throw new Error('Raster height exceeds GS v 0 limit');
    if (band.heightDots > maxBandHeight)
        throw new Error(`Raster band exceeds maximum height of ${maxBandHeight}`);
    const widthBytes = Math.ceil(band.widthDots / 8);
    if (widthBytes > 0xffff)
        throw new Error('Raster width exceeds GS v 0 limit');
    const expectedLength = widthBytes * band.heightDots;
    if (band.pixels.length !== band.widthDots * band.heightDots) {
        throw new Error('Raster pixels must contain one value per pixel');
    }
    if (!Number.isSafeInteger(expectedLength))
        throw new Error('Raster dimensions are too large');
}
/** Encode exactly one validated band using GS v 0, m=0 (normal density). */
function encodeGsV0Band(band, maxBandHeight = exports.DEFAULT_RASTER_MAX_BAND_HEIGHT) {
    validateRasterBand(band, maxBandHeight);
    const widthBytes = Math.ceil(band.widthDots / 8);
    const payload = new Uint8Array(widthBytes * band.heightDots);
    for (let y = 0; y < band.heightDots; y += 1) {
        for (let x = 0; x < band.widthDots; x += 1) {
            if (band.pixels[y * band.widthDots + x] !== 0) {
                payload[y * widthBytes + Math.floor(x / 8)] |= 0x80 >> (x % 8);
            }
        }
    }
    const command = new Uint8Array(8 + payload.length);
    command.set([
        0x1d,
        0x76,
        0x30,
        exports.GS_V_0_MODE,
        widthBytes & 0xff,
        (widthBytes >> 8) & 0xff,
        band.heightDots & 0xff,
        (band.heightDots >> 8) & 0xff,
    ]);
    command.set(payload, 8);
    return command;
}
function concatBytes(parts) {
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const result = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
        result.set(part, offset);
        offset += part.length;
    }
    return result;
}
/**
 * Encode complete semantic units in order. No partial unit is ever emitted;
 * this is the shared pre-transport guard used by backend and WebUSB callers.
 */
function encodeRasterUnits(units, capabilities, mode = 'mixed') {
    if (!rasterCapabilityEnabled(capabilities, mode))
        throw new Error(`Raster ${mode} output is not enabled for this printer profile`);
    const parts = [];
    for (const unit of units) {
        if (!unit.complete || unit.bands.length === 0) {
            throw new Error(unit.financial
                ? 'Financial raster unit is incomplete'
                : `Raster unit ${unit.unitId} is incomplete`);
        }
        for (const band of unit.bands) {
            if (band.widthDots !== capabilities.raster.widthDots) {
                throw new Error(`Raster width ${band.widthDots} does not match profile width ${capabilities.raster.widthDots}`);
            }
            parts.push(encodeGsV0Band(band, capabilities.raster.maxBandHeight));
        }
    }
    return concatBytes(parts);
}
/** Diagnostic bands used by the capability-gated printer test page. */
function buildRasterDiagnosticBands(widthDots, maxBandHeight = exports.DEFAULT_RASTER_MAX_BAND_HEIGHT) {
    if (!Number.isSafeInteger(widthDots) || widthDots <= 0 || widthDots > MAX_RASTER_WIDTH_DOTS)
        throw new Error('Invalid diagnostic raster width');
    if (!Number.isSafeInteger(maxBandHeight) ||
        maxBandHeight <= 0 ||
        maxBandHeight > exports.DEFAULT_RASTER_MAX_BAND_HEIGHT) {
        throw new Error('Invalid diagnostic raster band height');
    }
    const makeBand = (heightDots, yOffset, pixel) => ({
        widthDots,
        heightDots,
        pixels: Uint8Array.from({ length: widthDots * heightDots }, (_, index) => {
            const x = index % widthDots;
            const y = yOffset + Math.floor(index / widthDots);
            return pixel(x, y) ? 1 : 0;
        }),
    });
    const bands = [];
    const appendBands = (heightDots, pixel) => {
        for (let offset = 0; offset < heightDots; offset += maxBandHeight) {
            bands.push(makeBand(Math.min(maxBandHeight, heightDots - offset), offset, pixel));
        }
    };
    appendBands(48, (x) => x >= 8 && x < widthDots - 8);
    appendBands(48, (x, y) => Math.floor(x / 8) % 2 === Math.floor(y / 8) % 2);
    appendBands(24, () => true);
    bands.forEach((band) => validateRasterBand(band, maxBandHeight));
    return bands;
}
/** Tested compatibility path; callers must opt into the profile's whole-receipt mode. */
function encodeWholeReceiptRaster(unit, capabilities, cutMode) {
    return concatBytes([
        encodeRasterUnits([unit], capabilities, 'whole-receipt'),
        encodeRasterFeedAndCut(cutMode),
    ]);
}
/**
 * Assemble transport-neutral mixed output. Native bytes are copied verbatim;
 * raster parts are encoded in order, so backend and WebUSB share this boundary.
 */
function encodeMixedPrintParts(parts, capabilities, cutMode) {
    const encoded = [];
    for (const part of parts) {
        encoded.push(part.kind === 'native'
            ? new Uint8Array(part.bytes)
            : encodeRasterUnits([part.unit], capabilities));
    }
    encoded.push(encodeRasterFeedAndCut(cutMode));
    return concatBytes(encoded);
}
/** Standard trailing feed and profile-selected cut used by all raw paths. */
function encodeRasterFeedAndCut(cutMode, feedLines = 5) {
    if (!Number.isSafeInteger(feedLines) || feedLines < 0 || feedLines > 255)
        throw new Error('Invalid raster feed count');
    return new Uint8Array([
        0x1b,
        0x64,
        feedLines,
        ...(cutMode === 'partial' ? [0x1d, 0x56, 0x42, 0x00] : [0x1d, 0x56, 0x00]),
    ]);
}
function isBundledFontDataUrl(dataUrl) {
    return (typeof dataUrl === 'string' &&
        dataUrl.length <= 4_000_000 &&
        /^data:font\/(?:woff2?|truetype|opentype);base64,[A-Za-z0-9+/]+={0,2}$/.test(dataUrl));
}
function isRasterRenderRequest(value) {
    if (!value || typeof value !== 'object')
        return false;
    const request = value;
    return (request.version === 1 &&
        typeof request.requestId === 'string' &&
        request.requestId.length > 0 &&
        request.requestId.length <= 128 &&
        typeof request.text === 'string' &&
        request.text.length <= 16_000 &&
        Number.isSafeInteger(request.widthDots) &&
        request.widthDots > 0 &&
        request.widthDots <= MAX_RASTER_WIDTH_DOTS &&
        Number.isSafeInteger(request.maxBandHeight) &&
        request.maxBandHeight > 0 &&
        request.maxBandHeight <= exports.DEFAULT_RASTER_MAX_BAND_HEIGHT &&
        (request.direction === 'ltr' || request.direction === 'rtl') &&
        (request.align === undefined || request.align === 'left' || request.align === 'center') &&
        (request.layout === undefined ||
            (!!request.layout &&
                (request.layout.kind === 'financial-summary' || request.layout.kind === 'financial-item') &&
                Array.isArray(request.layout.columns) &&
                request.layout.columns.length >= 2 &&
                (request.layout.columns.length <= 3 ||
                    (request.layout.columns.length === 4 &&
                        request.layout.columns.every((column) => !!column && typeof column.widthRatio === 'number'))) &&
                request.layout.columns.every((column) => !!column &&
                    typeof column.text === 'string' &&
                    column.text.length <= 16_000 &&
                    (column.align === 'left' || column.align === 'right') &&
                    (column.widthRatio === undefined ||
                        (typeof column.widthRatio === 'number' &&
                            Number.isFinite(column.widthRatio) &&
                            column.widthRatio > 0 &&
                            column.widthRatio <= 1))) &&
                request.layout.columns.reduce((sum, col) => sum + (typeof col?.widthRatio === 'number' ? col.widthRatio : 0), 0) <= 1.000001)) &&
        ['normal', 'bold', 'double-height', 'double-width', 'font-b'].includes(request.style) &&
        (request.styles === undefined ||
            (Array.isArray(request.styles) &&
                request.styles.length > 0 &&
                request.styles.length <= 4 &&
                request.styles.every((style) => ['normal', 'bold', 'double-height', 'double-width', 'font-b'].includes(style)))) &&
        typeof request.financial === 'boolean' &&
        Number.isSafeInteger(request.maxLines) &&
        request.maxLines > 0 &&
        request.maxLines <= 256 &&
        (request.bundledFont === undefined ||
            (!!request.bundledFont &&
                typeof request.bundledFont === 'object' &&
                typeof request.bundledFont.family === 'string' &&
                /^[A-Za-z0-9 _-]{1,64}$/.test(request.bundledFont.family) &&
                isBundledFontDataUrl(request.bundledFont.dataUrl))));
}
function isRasterBand(value) {
    if (!value || typeof value !== 'object')
        return false;
    const band = value;
    return (Number.isSafeInteger(band.widthDots) &&
        band.widthDots > 0 &&
        Number.isSafeInteger(band.heightDots) &&
        band.heightDots > 0 &&
        band.pixels instanceof Uint8Array &&
        band.pixels.length === band.widthDots * band.heightDots);
}
function isRasterSemanticUnit(value) {
    if (!value || typeof value !== 'object')
        return false;
    const unit = value;
    return (typeof unit.unitId === 'string' &&
        typeof unit.financial === 'boolean' &&
        typeof unit.complete === 'boolean' &&
        Array.isArray(unit.bands) &&
        unit.bands.every(isRasterBand));
}
function isRasterRenderResult(value) {
    if (!value || typeof value !== 'object')
        return false;
    const result = value;
    if (result.version !== 1 || typeof result.requestId !== 'string')
        return false;
    if (result.ok === true)
        return isRasterSemanticUnit(result.unit);
    return (result.ok === false &&
        (result.code === 'invalid-request' ||
            result.code === 'font-unavailable' ||
            result.code === 'render-failed') &&
        typeof result.detail === 'string');
}
//# sourceMappingURL=raster.js.map