"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildBackendMixedRasterBytes = buildBackendMixedRasterBytes;
const raster_1 = require("../../shared/print/raster");
/** Backend adapter kept transport-neutral for TCP, OS RAW, and WebUSB parity. */
function buildBackendMixedRasterBytes(parts, capabilities, cutMode) {
    return Buffer.from((0, raster_1.encodeMixedPrintParts)(parts, capabilities, cutMode));
}
//# sourceMappingURL=raster-output.js.map