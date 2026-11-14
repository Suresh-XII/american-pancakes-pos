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
exports.NETWORK_PRINT_CHUNK_DELAY_MS = exports.NETWORK_PRINT_CHUNK_SIZE = exports.capabilitiesForPrinter = exports.dotsForPaperWidth = exports.makeFinancialPrintRefusalMessage = exports.hasFinancialPrintWarning = exports.buildEscPos = exports.appendCashDrawerPulse = exports.resolveCurrencyPrefix = exports.normalizeThermalText = exports.appendPoweredByFooter = exports.pushCenteredWrapped = exports.pushWrapped = exports.wrapText = exports.normalizePrintLanguage = exports.truncateShapedLine = exports.truncate = exports.rightAlign = exports.formatCurrency = exports.financialRows = exports.addonRows = exports.itemRows = exports.itemAmountWidth = exports.itemNameWidth = void 0;
exports.sanitizePowerShellStderr = sanitizePowerShellStderr;
exports.classifyPrintFailure = classifyPrintFailure;
exports.isMasRuntime = isMasRuntime;
exports.detectConnectedPrinters = detectConnectedPrinters;
exports.initPrinter = initPrinter;
exports.printReceipt = printReceipt;
exports.printKOT = printKOT;
exports.printDeliverySlip = printDeliverySlip;
exports.printDeliverySlipDetailed = printDeliverySlipDetailed;
exports.buildEscPosQrCode = buildEscPosQrCode;
exports.printPaymentTicket = printPaymentTicket;
exports.printPaymentTicketDetailed = printPaymentTicketDetailed;
exports.printReceiptDetailed = printReceiptDetailed;
exports.printKOTDetailed = printKOTDetailed;
exports.columnsForPaperWidth = columnsForPaperWidth;
exports.resolvePrinterContext = resolvePrinterContext;
exports.printMenuDocument = printMenuDocument;
exports.prepareReceipt = prepareReceipt;
exports.receiptDocumentLines = receiptDocumentLines;
exports.rasterizePrintDocumentForWebUsb = rasterizePrintDocumentForWebUsb;
exports.rasterizeKotDocumentForWebUsb = rasterizeKotDocumentForWebUsb;
exports.formatReceipt = formatReceipt;
exports.normalizeReceiptTemplate = normalizeReceiptTemplate;
exports.renderPluginReceipt = renderPluginReceipt;
exports.pluginReceiptLines = pluginReceiptLines;
exports.selectTemplateRenderProfile = selectTemplateRenderProfile;
exports.formatCompactReceipt = formatCompactReceipt;
exports.formatClassicReceipt = formatClassicReceipt;
exports.resolvePaymentMethodLabel = resolvePaymentMethodLabel;
exports.formatTableLabel = formatTableLabel;
exports.formatKOT = formatKOT;
exports.buildTestPage = buildTestPage;
exports.buildZReportBody = buildZReportBody;
exports.printZReport = printZReport;
exports.escPosToText = escPosToText;
exports.printViaNetwork = printViaNetwork;
exports.printViaUSB = printViaUSB;
exports.describeWindowsPrintProcessFailure = describeWindowsPrintProcessFailure;
exports.getPrinterStatus = getPrinterStatus;
const net = __importStar(require("net"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const util_1 = require("util");
const db_1 = require("../db");
const profiles_1 = require("./profiles");
Object.defineProperty(exports, "dotsForPaperWidth", { enumerable: true, get: function () { return profiles_1.dotsForPaperWidth; } });
Object.defineProperty(exports, "capabilitiesForPrinter", { enumerable: true, get: function () { return profiles_1.capabilitiesForPrinter; } });
const countries_1 = require("../countries");
const tax_components_1 = require("../services/tax-components");
const print_templates_1 = require("../services/print-templates");
const document_merchant_1 = require("./document-merchant");
const errors_1 = require("../errors");
const cloud_sync_1 = require("../services/cloud-sync");
const print_labels_generated_1 = require("../print/print-labels.generated");
const charges_1 = require("../../shared/charges");
const order_item_status_1 = require("../../shared/order-item-status");
const template_labels_1 = require("../print/template-labels");
const document_classic_1 = require("./document-classic");
const document_compact_1 = require("./document-compact");
const document_kot_1 = require("./document-kot");
const document_delivery_slip_1 = require("./document-delivery-slip");
const document_menu_1 = require("./document-menu");
const thermal_capabilities_1 = require("../../shared/print/thermal-capabilities");
const ipp_client_1 = require("./ipp-client");
const raster_1 = require("../../shared/print/raster");
const text_size_1 = require("../../shared/print/text-size");
const warnings_1 = require("../../shared/print/warnings");
Object.defineProperty(exports, "hasFinancialPrintWarning", { enumerable: true, get: function () { return warnings_1.hasFinancialPrintWarning; } });
Object.defineProperty(exports, "makeFinancialPrintRefusalMessage", { enumerable: true, get: function () { return warnings_1.makeFinancialPrintRefusalMessage; } });
const width_1 = require("../../shared/print/width");
const print_1 = require("../../shared/print");
const formatting_helpers_1 = require("./formatting-helpers");
Object.defineProperty(exports, "itemNameWidth", { enumerable: true, get: function () { return formatting_helpers_1.itemNameWidth; } });
Object.defineProperty(exports, "itemAmountWidth", { enumerable: true, get: function () { return formatting_helpers_1.itemAmountWidth; } });
Object.defineProperty(exports, "itemRows", { enumerable: true, get: function () { return formatting_helpers_1.itemRows; } });
Object.defineProperty(exports, "addonRows", { enumerable: true, get: function () { return formatting_helpers_1.addonRows; } });
Object.defineProperty(exports, "financialRows", { enumerable: true, get: function () { return formatting_helpers_1.financialRows; } });
Object.defineProperty(exports, "formatCurrency", { enumerable: true, get: function () { return formatting_helpers_1.formatCurrency; } });
Object.defineProperty(exports, "rightAlign", { enumerable: true, get: function () { return formatting_helpers_1.rightAlign; } });
Object.defineProperty(exports, "truncate", { enumerable: true, get: function () { return formatting_helpers_1.truncate; } });
Object.defineProperty(exports, "truncateShapedLine", { enumerable: true, get: function () { return formatting_helpers_1.truncateShapedLine; } });
Object.defineProperty(exports, "normalizePrintLanguage", { enumerable: true, get: function () { return formatting_helpers_1.normalizePrintLanguage; } });
Object.defineProperty(exports, "wrapText", { enumerable: true, get: function () { return formatting_helpers_1.wrapText; } });
Object.defineProperty(exports, "pushWrapped", { enumerable: true, get: function () { return formatting_helpers_1.pushWrapped; } });
Object.defineProperty(exports, "pushCenteredWrapped", { enumerable: true, get: function () { return formatting_helpers_1.pushCenteredWrapped; } });
Object.defineProperty(exports, "appendPoweredByFooter", { enumerable: true, get: function () { return formatting_helpers_1.appendPoweredByFooter; } });
Object.defineProperty(exports, "normalizeThermalText", { enumerable: true, get: function () { return formatting_helpers_1.normalizeThermalText; } });
Object.defineProperty(exports, "resolveCurrencyPrefix", { enumerable: true, get: function () { return formatting_helpers_1.resolveCurrencyPrefix; } });
Object.defineProperty(exports, "appendCashDrawerPulse", { enumerable: true, get: function () { return formatting_helpers_1.appendCashDrawerPulse; } });
Object.defineProperty(exports, "buildEscPos", { enumerable: true, get: function () { return formatting_helpers_1.buildEscPos; } });
const XML_ENTITIES = {
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&apos;': "'",
    '&amp;': '&',
};
/** Strips PowerShell CLIXML serialization envelopes and extracts clean error text. */
function sanitizePowerShellStderr(stderr) {
    if (!stderr)
        return '';
    const raw = String(stderr).trim();
    if (!raw.includes('#< CLIXML') && !raw.includes('<Objs')) {
        return raw;
    }
    const errorMatches = [];
    const regex = /<S S="Error">(.*?)<\/S>/gs;
    let match;
    while ((match = regex.exec(raw)) !== null) {
        const text = match[1]
            .replace(/_x000D__x000A_/g, '\n')
            .replace(/_x([0-9a-fA-F]{4})_/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
            .replace(/&(?:lt|gt|quot|apos|amp);/g, (entity) => XML_ENTITIES[entity] ?? entity)
            .trim();
        if (text && !text.startsWith('At line:') && !text.startsWith('+ ')) {
            errorMatches.push(text);
        }
    }
    if (errorMatches.length > 0) {
        return errorMatches.join('\n').trim();
    }
    // No structured error-stream content — e.g. only progress-record CLIXML
    // (<Obj S="progress">...), as emitted by module auto-loading during
    // `Add-Type`. Strip every CLIXML envelope wherever it appears in the
    // buffer, not just a leading header, and keep the surrounding plain text.
    return raw
        .replace(/#<\s*CLIXML[\r\n]*/gi, '')
        .replace(/<Objs[^>]*>.*?<\/Objs>/gs, '')
        .replace(/_x000D__x000A_/g, '\n')
        .replace(/_x([0-9a-fA-F]{4})_/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
        .trim();
}
// A network printer that refuses the socket is as gone as an unplugged one; the
// errnos are matched lowercased because `value` is.
const NETWORK_UNREACHABLE_RE = /\bconnect (?:econnrefused|ehostunreach|enetunreach)\b/;
/** Stable, privacy-safe classification for fleet telemetry. */
function classifyPrintFailure(detail) {
    const value = sanitizePowerShellStderr(detail).toLowerCase();
    if (!value)
        return 'unknown';
    if (value.includes('no printer configured') || value.includes('no windows printer configured'))
        return 'not_configured';
    // The queue the till was told to use is gone: `lp` cannot even name it. Anchored
    // on `lp:` so a Node filesystem ENOENT is not blamed on the printer.
    if (value.includes('lp: no such file or directory') ||
        value.includes('printer or class does not exist') ||
        value.includes('not found in macos printers') ||
        value.includes('no default destination'))
        return 'not_configured';
    if (value.includes('offline') ||
        value.includes('use printer offline') ||
        value.includes('disconnected') ||
        value.includes('printer is not available') ||
        NETWORK_UNREACHABLE_RE.test(value))
        return 'offline';
    // The printer is present but needs a person: paper, cover, or a vendor error flag.
    if (value.includes('out of paper') ||
        value.includes('paper jam') ||
        value.includes('cover is open') ||
        value.includes('needs attention') ||
        value.includes('reported an error'))
        return 'needs_attention';
    if (value.includes('not accepting') ||
        value.includes('queue is disabled') ||
        value.includes('disabled since') ||
        (value.includes('queue') && value.includes('unavailable')) ||
        value.includes('cannot open printer'))
        return 'queue_unavailable';
    if (value.includes('spool') ||
        value.includes('startdocprinter') ||
        value.includes('startpageprinter'))
        return 'spooler_error';
    if (value.includes('driver') || value.includes('no driver'))
        return 'driver_error';
    if (value.includes('access denied') || value.includes('permission'))
        return 'permission_denied';
    if (value.includes('timed out') || value.includes('timeout'))
        return 'timeout';
    if (value.includes('writeprinter') || (value.includes('accepted') && value.includes('of')))
        return 'write_error';
    if (value.includes('not supported') || value.includes('unsupported'))
        return 'unsupported';
    return 'unknown';
}
function extractPlatformErrorCode(detail) {
    const match = String(detail || '').match(/\b(?:win32 error|error)\s+(\d+)\b/i);
    if (!match)
        return undefined;
    const code = Number(match[1]);
    return Number.isSafeInteger(code) ? code : undefined;
}
function isMasRuntime() {
    return (process.env.MAS_BUILD === '1' || process.mas === true);
}
const PRINTER_DETECTION_TIMEOUT_MS = 10_000;
function guessPaperWidth(name, model) {
    const profile = (0, profiles_1.matchSupportedPrinterProfile)(name, model);
    if (profile)
        return profile.defaultPaperWidth;
    const s = (name + ' ' + model).toLowerCase();
    if (s.includes('58'))
        return 'cols-32';
    return 'cols-42';
}
function annotateProfile(info) {
    const profile = (0, profiles_1.matchSupportedPrinterProfile)(info.name, info.make, info.model);
    return profile
        ? { ...info, profileId: profile.id, paperWidth: info.paperWidth || profile.defaultPaperWidth }
        : info;
}
function parseDeviceUri(uri) {
    const m = uri.match(/(?:socket|ipp|ipps|http|https|lpd):\/\/([^:\/\s]+)(?::(\d+))?/i);
    if (!m)
        return {};
    const host = m[1];
    const port = m[2] ? parseInt(m[2], 10) : undefined;
    const isIp = /^\d+\.\d+\.\d+\.\d+$/.test(host);
    return { ip: isIp ? host : host, port };
}
async function detectConnectedPrinters(signal) {
    const printers = [];
    if (signal?.aborted) {
        return printers;
    }
    if (isMasRuntime()) {
        // In sandboxed MAS build, access local CUPS daemon via IPP
        // instead of shelling out to lpstat/lpoptions.
        return process.platform === 'darwin' ? await detectPrintersViaIpp(signal) : printers;
    }
    if (process.platform === 'darwin') {
        return await detectMacOSPrinters(signal);
    }
    if (process.platform === 'win32') {
        return detectWindowsPrinters(signal);
    }
    if (process.platform === 'linux') {
        return detectLinuxPrinters(signal);
    }
    return printers;
}
async function detectMacOSPrinters(signal) {
    const printers = [];
    try {
        const { stdout: lpStatOutput } = await execFileAsync('lpstat', ['-v'], {
            encoding: 'utf8',
            timeout: PRINTER_DETECTION_TIMEOUT_MS,
            signal,
            maxBuffer: 10 * 1024 * 1024,
        });
        const lines = lpStatOutput.split('\n');
        const printerNames = new Set();
        for (const line of lines) {
            const match = line.match(/device for (\S+):\s*(.+)/);
            if (match) {
                if (signal?.aborted)
                    return printers;
                const name = match[1];
                const uri = match[2].trim();
                if (!printerNames.has(name)) {
                    printerNames.add(name);
                    const makeModel = await getMacOSPrinterDetails(name, signal);
                    const isDefault = await isMacOSDefaultPrinter(name, signal);
                    const status = await getMacOSPrinterStatus(name, signal);
                    if (signal?.aborted)
                        return printers;
                    const isNetwork = /^(socket|ipp|ipps|http|https|lpd):\/\//i.test(uri);
                    const { ip, port } = isNetwork ? parseDeviceUri(uri) : {};
                    printers.push(annotateProfile({
                        name,
                        make: makeModel.make,
                        model: makeModel.model,
                        connectionType: isNetwork ? 'network' : 'usb',
                        deviceUri: uri,
                        status,
                        isDefault,
                        ipAddress: ip,
                        port: port || (isNetwork ? 9100 : undefined),
                        paperWidth: guessPaperWidth(name, makeModel.model),
                    }));
                }
            }
        }
    }
    catch (err) {
        console.log('[Printer] Could not detect macOS printers:', err);
    }
    return printers;
}
// MAS-build counterpart to detectMacOSPrinters: same CUPS queues, reached over
// local IPP instead of `lpstat`/`lpoptions` (see ipp-client.ts for why).
async function detectPrintersViaIpp(signal) {
    const printers = [];
    try {
        const [groups, defaultName] = await Promise.all([
            (0, ipp_client_1.ippGetPrinters)(signal),
            (0, ipp_client_1.ippGetDefaultPrinterName)(signal).catch(() => null),
        ]);
        for (const group of groups) {
            if (signal?.aborted)
                return printers;
            const name = group['printer-name']?.[0];
            if (typeof name !== 'string' || !name)
                continue;
            const deviceUri = String(group['device-uri']?.[0] || '');
            const makeAndModel = String(group['printer-make-and-model']?.[0] || '');
            const isNetwork = /^(socket|ipp|ipps|http|https|lpd):\/\//i.test(deviceUri);
            const { ip, port } = isNetwork ? parseDeviceUri(deviceUri) : {};
            const parsedUsb = !isNetwork ? parseCupsDeviceUri(deviceUri) : null;
            const [make, ...modelParts] = makeAndModel.split(' ');
            const model = modelParts.join(' ') || 'Thermal Printer';
            const state = group['printer-state']?.[0];
            const accepting = group['printer-is-accepting-jobs']?.[0];
            const status = accepting === false || state === 5 ? 'offline' : state === 4 ? 'printing' : 'idle';
            printers.push(annotateProfile({
                name,
                make: parsedUsb?.make || make || 'Unknown',
                model: parsedUsb?.model || model,
                connectionType: isNetwork ? 'network' : 'usb',
                deviceUri,
                status,
                isDefault: name === defaultName,
                ipAddress: ip,
                port: port || (isNetwork ? 9100 : undefined),
                paperWidth: guessPaperWidth(name, parsedUsb?.model || model),
            }));
        }
        // When CUPS-Get-Default is unset, fall back to the single configured printer.
        if (!defaultName && printers.length === 1) {
            printers[0].isDefault = true;
        }
    }
    catch (err) {
        console.log('[Printer] Could not detect printers via local IPP:', err);
    }
    return printers;
}
async function getMacOSPrinterStatus(name, signal) {
    try {
        const { stdout } = await execFileAsync('lpstat', ['-p', name], {
            encoding: 'utf8',
            timeout: PRINTER_DETECTION_TIMEOUT_MS,
            signal,
            maxBuffer: 10 * 1024 * 1024,
        });
        const out = stdout.toLowerCase();
        if (out.includes('disabled'))
            return 'offline';
        if (out.includes('printing') || out.includes('now printing'))
            return 'printing';
        return 'idle';
    }
    catch {
        return 'offline';
    }
}
async function getMacOSPrinterDetails(name, signal) {
    let make = 'Unknown';
    let model = 'Thermal Printer';
    try {
        const { stdout: info } = await execFileAsync('lpoptions', ['-p', name, '-l'], {
            encoding: 'utf8',
            timeout: PRINTER_DETECTION_TIMEOUT_MS,
            signal,
            maxBuffer: 10 * 1024 * 1024,
        });
        const lower = info.toLowerCase();
        if (lower.includes('epson') || name.toLowerCase().includes('tm-')) {
            make = 'Epson';
            model = extractEpsonModel(name, info);
        }
        else if (lower.includes('xprinter') || name.toLowerCase().includes('xprinter')) {
            make = 'Xprinter';
            model = name.includes('80') ? 'Xprinter 80mm' : 'Xprinter 58mm';
        }
        else if (lower.includes('star') || name.toLowerCase().includes('tsp')) {
            make = 'Star';
            model = 'TSP Thermal';
        }
        else if (lower.includes('zjiang') || name.toLowerCase().includes('zj')) {
            make = 'Zjiang';
            model = '58mm Thermal';
        }
        else if (lower.includes('zebra')) {
            make = 'Zebra';
            model = 'Zebra Thermal';
        }
        else if (lower.includes('brother')) {
            make = 'Brother';
            model = 'Brother Thermal';
        }
        else if (lower.includes('canon')) {
            make = 'Canon';
            model = 'Canon Printer';
        }
        else if (lower.includes('hp') || lower.includes('hewlett')) {
            make = 'HP';
            model = 'HP Printer';
        }
        else {
            const nameLower = name.toLowerCase();
            if (nameLower.includes('58') || nameLower.includes('thermal')) {
                make = 'Generic';
                model = '58mm Thermal Printer';
            }
            else if (nameLower.includes('80')) {
                make = 'Generic';
                model = '80mm Thermal Printer';
            }
        }
    }
    catch {
        const nameLower = name.toLowerCase();
        if (nameLower.includes('epson') || nameLower.includes('tm-')) {
            make = 'Epson';
            model = 'TM Series';
        }
        else if (nameLower.includes('xprinter')) {
            make = 'Xprinter';
            model = nameLower.includes('80') ? 'Xprinter 80mm' : 'Xprinter 58mm';
        }
    }
    return { make, model };
}
function extractEpsonModel(name, info) {
    const lower = name.toLowerCase();
    if (lower.includes('tm-m30'))
        return 'TM-m30';
    if (lower.includes('tm-t88'))
        return 'TM-T88';
    if (lower.includes('tm-t82'))
        return 'TM-T82';
    if (lower.includes('tm-t20'))
        return 'TM-T20';
    if (lower.includes('tm-t60'))
        return 'TM-T60';
    if (lower.includes('tm-l90'))
        return 'TM-L90';
    if (lower.includes('tm-h600'))
        return 'TM-H600';
    if (lower.includes('tm-u'))
        return 'TM-U Series';
    if (lower.includes('tm-'))
        return 'TM Series';
    return 'Epson Thermal';
}
async function isMacOSDefaultPrinter(name, signal) {
    try {
        const { stdout: defaultPrinter } = await execFileAsync('lpstat', ['-d'], {
            encoding: 'utf8',
            timeout: PRINTER_DETECTION_TIMEOUT_MS,
            signal,
            maxBuffer: 10 * 1024 * 1024,
        });
        return defaultPrinter.includes(name);
    }
    catch {
        return false;
    }
}
// Windows PowerShell 5.1 encodes redirected stdout/stderr with the console/OEM
// code page, so decoding those bytes as UTF-8 turns accented diagnostics into
// replacement characters. Every helper therefore switches its .NET writers to
// UTF-8 explicitly, and the console code page too where a console exists. The
// module-loading progress record is silenced because it is framing, not a
// device reason. Best-effort on purpose: this must never be able to break
// printing, so a failure here leaves the default streams in place.
const POWERSHELL_UTF8_PRELUDE = `
$ProgressPreference = 'SilentlyContinue'
try {
  $floUtf8 = New-Object -TypeName System.Text.UTF8Encoding -ArgumentList $false
  $floOut = New-Object -TypeName System.IO.StreamWriter -ArgumentList ([Console]::OpenStandardOutput()), $floUtf8
  $floErr = New-Object -TypeName System.IO.StreamWriter -ArgumentList ([Console]::OpenStandardError()), $floUtf8
  $floOut.AutoFlush = $true
  $floErr.AutoFlush = $true
  [Console]::SetOut($floOut)
  [Console]::SetError($floErr)
  [Console]::OutputEncoding = $floUtf8
} catch { }
`;
/** Command line for a Windows PowerShell helper, with the UTF-8 stream
 * contract prefixed so no helper can emit console-code-page output. */
function windowsPowerShellCommandArgs(script) {
    return [
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(`${POWERSHELL_UTF8_PRELUDE}${script}`, 'utf16le').toString('base64'),
    ];
}
// Enumerate printers via Get-CimInstance (Win32_Printer) using -EncodedCommand.
const DETECT_WINDOWS_PRINTERS_SCRIPT = `
$ErrorActionPreference = 'Stop'
try {
  Get-CimInstance -ClassName Win32_Printer -Property Name,Default,PrinterStatus,DriverName |
    Select-Object Name,Default,PrinterStatus,DriverName |
    ConvertTo-Json -Compress
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  [Console]::Error.Flush()
  exit 1
}
`;
// Win32_Printer.PrinterStatus: 1=Other, 2=Unknown, 3=Idle, 4=Printing, 5=Warming Up, 6=Stopped Printing, 7=Offline.
function mapWindowsPrinterStatus(printerStatus) {
    if (printerStatus === 3 || printerStatus === 5)
        return 'idle';
    if (printerStatus === 4)
        return 'printing';
    return 'offline';
}
async function detectWindowsPrinters(signal) {
    const printers = [];
    try {
        const { stdout } = await execFileAsync('powershell', windowsPowerShellCommandArgs(DETECT_WINDOWS_PRINTERS_SCRIPT), {
            encoding: 'utf8',
            timeout: PRINTER_DETECTION_TIMEOUT_MS,
            signal,
            windowsHide: true,
            maxBuffer: 10 * 1024 * 1024,
        });
        const trimmed = stdout.trim();
        if (trimmed && trimmed !== 'null') {
            const parsed = JSON.parse(trimmed);
            const entries = Array.isArray(parsed) ? parsed : [parsed];
            for (const entry of entries) {
                const name = typeof entry?.Name === 'string' ? entry.Name.trim() : '';
                if (!name)
                    continue;
                const driver = typeof entry.DriverName === 'string' ? entry.DriverName : '';
                const makeModel = detectWindowsMakeModel(name, driver);
                printers.push(annotateProfile({
                    name,
                    make: makeModel.make,
                    model: makeModel.model,
                    connectionType: 'usb',
                    deviceUri: name,
                    driver,
                    status: mapWindowsPrinterStatus(entry.PrinterStatus),
                    isDefault: entry.Default === true,
                    paperWidth: guessPaperWidth(name, makeModel.model),
                }));
            }
        }
    }
    catch (err) {
        // The detection script is also passed as -EncodedCommand, and the app log
        // tail is attached to support tickets, so the raw error (whose message
        // embeds the command line) must never be logged.
        const rawDetail = sanitizePowerShellStderr(String(err?.stderr || '').trim()) ||
            describeWindowsPrintProcessFailure(err);
        const detail = capWindowsPrintDetail(rawDetail);
        console.log(`[Printer] Could not detect Windows printers via Get-CimInstance: ${detail}`);
    }
    return printers;
}
function detectWindowsMakeModel(name, driver) {
    let make = 'Unknown';
    let model = 'Thermal Printer';
    const lower = (name + ' ' + driver).toLowerCase();
    if (lower.includes('epson') || name.toLowerCase().includes('tm-')) {
        make = 'Epson';
        model = name.includes('TM-m30')
            ? 'TM-m30'
            : name.includes('TM-T88')
                ? 'TM-T88'
                : name.includes('TM-T82')
                    ? 'TM-T82'
                    : name.includes('TM-T20')
                        ? 'TM-T20'
                        : 'TM Series';
    }
    else if (lower.includes('xprinter')) {
        make = 'Xprinter';
        model = lower.includes('80') ? 'Xprinter 80mm' : 'Xprinter 58mm';
    }
    else if (lower.includes('star') || lower.includes('tsp')) {
        make = 'Star';
        model = 'TSP Thermal';
    }
    else if (lower.includes('zjiang')) {
        make = 'Zjiang';
        model = '58mm Thermal';
    }
    else if (lower.includes('zebra')) {
        make = 'Zebra';
        model = 'Zebra Thermal';
    }
    else if (lower.includes('brother')) {
        make = 'Brother';
        model = 'Brother Thermal';
    }
    else if (lower.includes('58') || lower.includes('thermal')) {
        make = 'Generic';
        model = '58mm Thermal';
    }
    else if (lower.includes('80')) {
        make = 'Generic';
        model = '80mm Thermal';
    }
    return { make, model };
}
// USB vendor ID lookup for common thermal printer brands
const THERMAL_PRINTER_VENDORS = {
    '04b8': 'Epson',
    '0456': 'Xprinter',
    '0519': 'Star Micronics',
    '0525': 'Star Micronics',
    '0416': 'Zjiang',
    '0419': 'Bixolon',
    '1d90': 'Citizen',
    '04f9': 'Brother',
};
// Bridge chip vendor IDs (not printer brands — these identify the USB-to-serial chip)
const BRIDGE_CHIP_VENDORS = new Set(['1a86', '10c4', '0403']);
function parseCupsDeviceUri(uri) {
    // USB URIs look like: usb://Epson/TM-T88V?serial=ABC123
    const usbMatch = uri.match(/usb:\/\/([^/?]+)\/([^?]+)/);
    if (usbMatch) {
        return { make: decodeURIComponent(usbMatch[1]), model: decodeURIComponent(usbMatch[2]) };
    }
    // Network URIs look like: socket://192.168.1.100:9100
    return null;
}
async function getMakeModelFromLpstat(signal) {
    const result = new Map();
    try {
        const { stdout: output } = await execFileAsync('lpstat', ['-l', '-p'], {
            encoding: 'utf8',
            timeout: PRINTER_DETECTION_TIMEOUT_MS,
            signal,
            maxBuffer: 10 * 1024 * 1024,
        });
        let currentName = '';
        for (const line of output.split('\n')) {
            const nameMatch = line.match(/^printer (\S+) is/);
            if (nameMatch)
                currentName = nameMatch[1];
            const uriMatch = line.match(/Device URI:\s*(.+)/);
            if (uriMatch && currentName) {
                const parsed = parseCupsDeviceUri(uriMatch[1].trim());
                if (parsed)
                    result.set(currentName, parsed);
            }
        }
    }
    catch {
        /* CUPS not available */
    }
    return result;
}
function getUsbPrinterVendorIds() {
    const result = new Map();
    const devicesDir = '/sys/bus/usb/devices';
    try {
        const entries = fs.readdirSync(devicesDir);
        for (const entry of entries) {
            if (entry.includes(':'))
                continue; // skip interfaces
            const devPath = `${devicesDir}/${entry}`;
            try {
                const devClass = fs.readFileSync(`${devPath}/bDeviceClass`, 'utf8').trim();
                if (devClass !== '07')
                    continue; // 07 = USB printer class
                const vendorId = fs.readFileSync(`${devPath}/idVendor`, 'utf8').trim();
                const manufacturer = readSysfsSafe(`${devPath}/manufacturer`);
                const product = readSysfsSafe(`${devPath}/product`);
                result.set(entry, { vendorId, manufacturer, product });
            }
            catch {
                /* skip device */
            }
        }
    }
    catch {
        /* sysfs not available */
    }
    return result;
}
function readSysfsSafe(filePath) {
    try {
        return fs.readFileSync(filePath, 'utf8').trim();
    }
    catch {
        return null;
    }
}
async function detectLinuxPrinters(signal) {
    const printers = [];
    try {
        // Layer 1: Get make/model from CUPS Device URI (most reliable)
        const cupsMakeModel = await getMakeModelFromLpstat(signal);
        if (signal?.aborted)
            return printers;
        // Layer 2: Get USB vendor IDs from sysfs (works without CUPS)
        const usbVendors = getUsbPrinterVendorIds();
        // Get printer list from CUPS
        const { stdout: output } = await execFileAsync('lpstat', ['-v'], {
            encoding: 'utf8',
            timeout: PRINTER_DETECTION_TIMEOUT_MS,
            signal,
            maxBuffer: 10 * 1024 * 1024,
        });
        const lines = output.split('\n');
        for (const line of lines) {
            if (signal?.aborted)
                return printers;
            const match = line.match(/device for (\S+):\s*(.+)/);
            if (match) {
                const name = match[1];
                const uri = match[2].trim();
                const isNetwork = /^(socket|ipp|ipps|http|https|lpd):\/\//i.test(uri);
                const { ip, port } = isNetwork ? parseDeviceUri(uri) : {};
                // Try CUPS Device URI first, then fall back to Generic
                const cupsInfo = cupsMakeModel.get(name);
                let make = cupsInfo?.make || 'Generic';
                let model = cupsInfo?.model || 'Thermal Printer';
                // For USB printers without CUPS info, try sysfs vendor ID lookup
                if (!cupsInfo && !isNetwork) {
                    for (const [, vendorInfo] of usbVendors) {
                        // Skip bridge chips — they identify the serial adapter, not the printer
                        if (BRIDGE_CHIP_VENDORS.has(vendorInfo.vendorId.toLowerCase())) {
                            // But if sysfs has manufacturer/product strings, use those
                            if (vendorInfo.manufacturer && vendorInfo.product) {
                                make = vendorInfo.manufacturer;
                                model = vendorInfo.product;
                            }
                            continue;
                        }
                        const vendorMake = THERMAL_PRINTER_VENDORS[vendorInfo.vendorId.toLowerCase()];
                        if (vendorMake) {
                            make = vendorMake;
                            model = vendorInfo.product || 'Thermal Printer';
                            break;
                        }
                    }
                }
                printers.push(annotateProfile({
                    name,
                    make,
                    model,
                    connectionType: isNetwork ? 'network' : 'usb',
                    deviceUri: uri,
                    status: 'idle',
                    isDefault: false,
                    ipAddress: ip,
                    port: port || (isNetwork ? 9100 : undefined),
                    paperWidth: guessPaperWidth(name, model),
                }));
            }
        }
    }
    catch {
        console.log('[Printer] Could not detect Linux printers');
    }
    return printers;
}
async function initPrinter() {
    try {
        const db = (0, db_1.getDatabase)();
        const printer = db.prepare('SELECT * FROM printers WHERE is_default = 1').get();
        if (printer) {
            console.log(`[Printer] Default printer: ${printer.name} (${printer.connection_type})`);
        }
        else {
            console.log('[Printer] No default printer configured');
        }
    }
    catch (error) {
        console.log('[Printer] Printer initialization skipped (database not ready)');
    }
}
async function printReceipt(order, bill, business, template = 'classic', useUnicode = false, isReprint = false, signal, arabicShapingOverride, language, additionalLanguage) {
    try {
        if (signal?.aborted)
            return { ok: false, detail: 'Print cancelled during shutdown' };
        console.log('[Printer] printReceipt called, template:', template, 'useUnicode:', useUnicode, 'isReprint:', isReprint);
        const printer = getPrinterConfig();
        if (!printer) {
            console.log('[Printer] No printer configured');
            return { ok: false, detail: 'No printer configured' };
        }
        const prepared = prepareReceipt(order, bill, business, template, useUnicode, isReprint, arabicShapingOverride, language, additionalLanguage);
        const { data, warnings, columns } = await rasterizeReceiptIfEnabled(prepared, order, bill, business, template, useUnicode, isReprint, arabicShapingOverride, language, additionalLanguage);
        if ((0, warnings_1.hasFinancialPrintWarning)(warnings)) {
            return {
                ok: false,
                detail: (0, warnings_1.makeFinancialPrintRefusalMessage)(warnings),
                failureClass: 'unsupported',
                warnings,
            };
        }
        const pulseSetting = (0, db_1.getSettingValue)('cash_drawer_pulse_enabled');
        const shouldPulse = pulseSetting === null
            ? printer.cash_drawer_pulse_enabled === 1
            : pulseSetting === 'true' && shouldPulseForPayment(bill);
        const receiptData = shouldPulse ? (0, formatting_helpers_1.appendCashDrawerPulse)(data) : data;
        console.log('[Printer] Using printer:', printer.name, printer.connection_type, 'columns:', columns);
        console.log('[Printer] Receipt data length:', receiptData.length, 'bytes');
        console.log('[Printer] First 100 bytes:', Array.from(receiptData.slice(0, 100))
            .map((b) => b.toString(16))
            .join(' '));
        const dispatch = await dispatchPrint(printer, receiptData, signal);
        return warnings.length > 0 ? { ...dispatch, warnings } : dispatch;
    }
    catch (error) {
        console.error('[Printer] Print error:', error);
        return { ok: false, detail: error?.message };
    }
}
/** Determine whether paid bill contains a payment method configured to open cash drawer. */
function shouldPulseForPayment(bill) {
    const configured = (0, db_1.getSettingValue)('cash_drawer_pulse_methods');
    let methods = ['cash', 'card'];
    try {
        const parsed = configured ? JSON.parse(configured) : methods;
        if (Array.isArray(parsed)) {
            const valid = parsed.filter((value) => typeof value === 'string');
            // Non-empty array without valid strings restores defaults; empty array stays empty.
            methods = parsed.length > 0 && valid.length === 0 ? ['cash', 'card'] : valid;
        }
    }
    catch {
        /* Keep the safe cash/card defaults. */
    }
    if (!bill?.payment_details)
        return false;
    try {
        const payments = typeof bill.payment_details === 'string'
            ? JSON.parse(bill.payment_details)
            : bill.payment_details;
        if (!Array.isArray(payments))
            return false;
        const db = (0, db_1.getDatabase)();
        return payments.some((payment) => {
            if (!payment || Number(payment.amount || 0) <= 0)
                return false;
            let method = String(payment.method || '').toLowerCase();
            if (method === 'custom' && Number.isSafeInteger(Number(payment.payment_method_id))) {
                const row = db
                    .prepare('SELECT name FROM payment_methods WHERE id = ?')
                    .get(Number(payment.payment_method_id));
                method = String(row?.name || method).toLowerCase();
            }
            return methods.some((selected) => selected.toLowerCase() === method);
        });
    }
    catch {
        return false;
    }
}
async function printKOT(order, items, stationName, useUnicode = false, targetPrinter, signal, arabicShapingOverride, language) {
    try {
        if (signal?.aborted)
            return { ok: false, detail: 'Print cancelled during shutdown' };
        console.log('[Printer] printKOT called, items count:', items?.length || 0, 'useUnicode:', useUnicode, 'station:', stationName);
        const printer = targetPrinter || getPrinterConfig();
        if (!printer) {
            console.log('[Printer] No printer configured');
            return { ok: false, detail: 'No printer configured' };
        }
        console.log('[Printer] Using printer:', printer.name, printer.connection_type);
        const { profile, columns: cols, capabilities, } = resolvePrinterContext(printer, arabicShapingOverride);
        const db = (0, db_1.getDatabase)();
        const biz = db.prepare('SELECT * FROM settings LIMIT 1').get();
        const locale = biz?.country ? ((0, countries_1.getCountryByCode)(biz.country)?.locale ?? 'en-US') : 'en-US';
        // Resolves through the country profile when the stored timezone is
        // missing or invalid, matching resolveRegionalSnapshot's own contract.
        // Throws RegionalNotConfiguredError (naming country, the actual missing
        // field) only when the country itself is unresolvable.
        const timezone = (0, countries_1.resolveRegionalSnapshot)({
            country: (0, db_1.getSettingValue)('country') ?? undefined,
            currency: (0, db_1.getSettingValue)('currency') ?? undefined,
            timezone: (0, db_1.getSettingValue)('timezone') ?? undefined,
        }).timezone;
        const tzOptions = { timeZone: timezone };
        const warnings = [];
        const nativeCapabilities = nativeFallbackCapabilities(capabilities);
        let data;
        if ((0, raster_1.rasterCapabilityEnabled)(capabilities)) {
            const documentResult = (0, document_kot_1.renderKotViaDocument)(order, items, stationName, {
                columns: cols,
                language: (0, formatting_helpers_1.normalizePrintLanguage)(language ?? biz?.language),
                locale,
                timezone,
                useUnicode,
                arabicShaping: capabilities.shaping.arabic,
                cutMode: profile.cutMode,
                capabilities,
            });
            const nativeResult = (0, document_kot_1.renderKotViaDocument)(order, items, stationName, {
                columns: cols,
                language: (0, formatting_helpers_1.normalizePrintLanguage)(language ?? biz?.language),
                locale,
                timezone,
                useUnicode,
                arabicShaping: nativeCapabilities.shaping.arabic,
                cutMode: profile.cutMode,
                capabilities: nativeCapabilities,
            });
            const rasterized = await rasterizeDocumentLines(documentResult.lines, documentResult.warnings, {
                useUnicode,
                cutMode: profile.cutMode,
                arabicShaping: capabilities.shaping.arabic,
                columns: cols,
                language: (0, formatting_helpers_1.normalizePrintLanguage)(language ?? biz?.language),
                capabilities,
                requestPrefix: 'kot',
            }, documentResult.rasterGroups);
            data =
                rasterized.rasterSelected && !rasterized.rasterFailed ? rasterized.data : nativeResult.data;
            if (rasterized.rasterFailed)
                warnings.push(...nativeResult.warnings);
            warnings.push(...rasterized.warnings);
        }
        else {
            data = formatKOT(order, items, stationName, cols, useUnicode, profile.cutMode, locale, tzOptions, warnings, capabilities.shaping.arabic, (0, formatting_helpers_1.normalizePrintLanguage)(language ?? biz?.language), capabilities);
        }
        if ((0, warnings_1.hasFinancialPrintWarning)(warnings)) {
            return {
                ok: false,
                detail: (0, warnings_1.makeFinancialPrintRefusalMessage)(warnings),
                failureClass: 'unsupported',
                warnings,
            };
        }
        console.log('[Printer] KOT data length:', data.length, 'bytes');
        const dispatch = await dispatchPrint(printer, data, signal);
        return warnings.length > 0 ? { ...dispatch, warnings } : dispatch;
    }
    catch (error) {
        console.error('[Printer] KOT print error:', error);
        return { ok: false, detail: error?.message };
    }
}
/** Dispatch a rendered delivery slip to the resolved printer. */
async function printDeliverySlip(order, items, contact, useUnicode = false, targetPrinter, signal, arabicShapingOverride, language, showCustomerPhone) {
    try {
        if (signal?.aborted)
            return { ok: false, detail: 'Print cancelled during shutdown' };
        const printer = targetPrinter || getPrinterConfig();
        if (!printer) {
            return { ok: false, detail: 'No printer configured' };
        }
        const { profile, columns: cols, capabilities, } = resolvePrinterContext(printer, arabicShapingOverride);
        const db = (0, db_1.getDatabase)();
        // Key/value table: a `SELECT * LIMIT 1` row has no `country` property, so
        // reading it that way silently pins the slip date to en-US.
        const countryCode = (0, db_1.getSettingValue)('country') ?? '';
        const storeLanguage = (0, db_1.getSettingValue)('language') ?? undefined;
        const locale = countryCode ? ((0, countries_1.getCountryByCode)(countryCode)?.locale ?? 'en-US') : 'en-US';
        const timezone = (0, countries_1.resolveRegionalSnapshot)({
            country: (0, db_1.getSettingValue)('country') ?? undefined,
            currency: (0, db_1.getSettingValue)('currency') ?? undefined,
            timezone: (0, db_1.getSettingValue)('timezone') ?? undefined,
        }).timezone;
        const currency = (0, countries_1.resolveTenantCurrency)((0, db_1.getSettingValue)('currency') ?? '', countryCode);
        const currencyLocale = (0, countries_1.getCountryByCode)(countryCode)?.locale ?? locale;
        const currencyDisplayValue = (0, db_1.getSettingValue)('currency_display');
        const currencyDisplay = ['rial', 'toman', 'toman_short'].includes(currencyDisplayValue ?? '')
            ? currencyDisplayValue
            : undefined;
        const digits = (0, db_1.getSettingValue)('number_digits') === 'latin' ? 'latin' : 'locale';
        const currencySymbol = (0, countries_1.getCurrencySymbol)(currency, currencyLocale);
        const warnings = [];
        const nativeCapabilities = nativeFallbackCapabilities(capabilities);
        const renderWith = (caps) => (0, document_delivery_slip_1.renderDeliverySlipViaDocument)(order, items, contact, {
            columns: cols,
            language: (0, formatting_helpers_1.normalizePrintLanguage)(language ?? storeLanguage),
            locale,
            currency,
            currencySymbol,
            currencyDisplay,
            digits,
            timezone,
            useUnicode,
            arabicShaping: caps.shaping.arabic,
            cutMode: profile.cutMode,
            capabilities: caps,
            showCustomerPhone: showCustomerPhone ?? true,
        });
        let data;
        if ((0, raster_1.rasterCapabilityEnabled)(capabilities)) {
            const documentResult = renderWith(capabilities);
            const nativeResult = renderWith(nativeCapabilities);
            const rasterized = await rasterizeDocumentLines(documentResult.lines, documentResult.warnings, {
                useUnicode,
                cutMode: profile.cutMode,
                arabicShaping: capabilities.shaping.arabic,
                columns: cols,
                language: (0, formatting_helpers_1.normalizePrintLanguage)(language ?? storeLanguage),
                capabilities,
                requestPrefix: 'delivery-slip',
            }, documentResult.rasterGroups);
            if (rasterized.rasterSelected && !rasterized.rasterFailed) {
                data = rasterized.data;
                warnings.push(...rasterized.warnings);
            }
            else {
                // The native bytes are going to the printer, so its warnings are the
                // ones staff must see, or an unrepresentable address reports success.
                data = nativeResult.data;
                warnings.push(...nativeResult.warnings, ...rasterized.warnings);
            }
        }
        else {
            const nativeResult = renderWith(capabilities);
            data = nativeResult.data;
            warnings.push(...nativeResult.warnings);
        }
        if ((0, warnings_1.hasFinancialPrintWarning)(warnings)) {
            return {
                ok: false,
                detail: (0, warnings_1.makeFinancialPrintRefusalMessage)(warnings),
                failureClass: 'unsupported',
                warnings,
            };
        }
        const dispatch = await dispatchPrint(printer, data, signal);
        return warnings.length > 0 ? { ...dispatch, warnings } : dispatch;
    }
    catch (error) {
        console.error('[Printer] Delivery slip print error:', error);
        return { ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
}
async function printDeliverySlipDetailed(...args) {
    const id = (0, errors_1.correlationId)();
    try {
        const dispatch = await printDeliverySlip(...args);
        const result = dispatch.ok
            ? { ok: true, correlationId: id, stage: 'dispatch', warnings: dispatch.warnings }
            : {
                ok: false,
                code: 'print.delivery_slip.failed',
                correlationId: id,
                stage: 'dispatch',
                detail: dispatch.detail,
                failureClass: dispatch.failureClass || classifyPrintFailure(dispatch.detail),
                platformErrorCode: dispatch.platformErrorCode || extractPlatformErrorCode(dispatch.detail),
                jobId: dispatch.jobId,
                driverName: dispatch.driverName,
                printerStatus: dispatch.printerStatus,
                warnings: dispatch.warnings,
            };
        if (!result.ok)
            reportPrintFailure('delivery_slip', result);
        return result;
    }
    catch (error) {
        const detail = error.message;
        const result = {
            ok: false,
            code: 'print.delivery_slip.failed',
            correlationId: id,
            stage: 'dispatch',
            detail,
            failureClass: classifyPrintFailure(detail),
            platformErrorCode: extractPlatformErrorCode(detail),
        };
        reportPrintFailure('delivery_slip', result);
        return result;
    }
}
function buildEscPosQrCode(payload) {
    const payloadBytes = Buffer.from(payload, 'utf8');
    const pL = (payloadBytes.length + 3) & 0xff;
    const pH = ((payloadBytes.length + 3) >> 8) & 0xff;
    return Buffer.concat([
        Buffer.from([0x1b, 0x61, 0x01]),
        Buffer.from([0x1d, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]),
        Buffer.from([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, 0x06]),
        Buffer.from([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31]),
        Buffer.from([0x1d, 0x28, 0x6b, pL, pH, 0x31, 0x50, 0x30]),
        payloadBytes,
        Buffer.from([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30]),
        Buffer.from([0x1b, 0x61, 0x00]),
    ]);
}
async function printPaymentTicket(order, items, options = {}) {
    try {
        if (options.signal?.aborted)
            return { ok: false, detail: 'Print cancelled during shutdown' };
        const printer = options.targetPrinter || getPrinterConfig();
        if (!printer && !options.preview) {
            return { ok: false, detail: 'No printer configured' };
        }
        const { profile, columns: cols } = resolvePrinterContext(printer || { paper_width: '80mm' });
        const storeName = (0, db_1.getSettingValue)('business_name') || 'FloCafe';
        let snapshot;
        try {
            snapshot = (0, countries_1.resolveRegionalSnapshot)({
                country: (0, db_1.getSettingValue)('country') || undefined,
                currency: (0, db_1.getSettingValue)('currency') || undefined,
                timezone: (0, db_1.getSettingValue)('timezone') || undefined,
            });
        }
        catch {
            snapshot = (0, countries_1.resolveRegionalSnapshot)({
                country: 'US',
                currency: 'USD',
                timezone: 'UTC',
            });
        }
        const currency = snapshot.currency;
        const fractionDigits = snapshot.currencyFractionDigits;
        const locale = snapshot.locale;
        const tz = snapshot.timezone;
        const prefix = (0, formatting_helpers_1.resolveCurrencyPrefix)(snapshot.currencySymbol || currency, false);
        const formatAmount = (val) => (0, formatting_helpers_1.formatCurrency)(val, prefix, locale, false, fractionDigits);
        const localTime = (iso) => {
            try {
                const d = (0, db_1.parseDbTimestamp)(iso);
                if (isNaN(d.getTime()))
                    return iso;
                return d.toLocaleString('en-US-u-nu-latn', { timeZone: tz });
            }
            catch {
                return iso;
            }
        };
        const balance = options.balance ?? order.total;
        const storeNameLines = (0, formatting_helpers_1.wrapText)((0, formatting_helpers_1.safePrinterText)(storeName), cols).map((line) => `{CENTER}{BOLD}${line}{/BOLD}{/CENTER}`);
        const lines = [
            '{INIT}',
            ...storeNameLines,
            '{CENTER}{BOLD}PAYMENT TICKET{/BOLD}{/CENTER}',
            `{CENTER}Ticket #: ${order.order_number}{/CENTER}`,
            '-'.repeat(cols),
            `Type: ${order.type === 'dine_in' ? 'Dine In' : 'Takeaway'}`,
        ];
        if (order.table_name) {
            lines.push(`Table: ${order.table_name}`);
        }
        if (order.created_at) {
            lines.push(`Date: ${localTime(order.created_at)}`);
        }
        if (order.scheduled_for) {
            lines.push(`Scheduled For: ${localTime(order.scheduled_for)}`);
        }
        lines.push('-'.repeat(cols));
        for (const item of items) {
            const quantity = `${item.quantity}x `;
            const amount = item.total !== undefined ? formatAmount(Number(item.total)) : '';
            const quantityWidth = (0, width_1.displayCellWidth)(quantity);
            const amountWidth = (0, width_1.displayCellWidth)(amount);
            (0, formatting_helpers_1.assertFinancialValueFitsColumns)(quantity, cols, 'payment ticket item quantity');
            if (amount)
                (0, formatting_helpers_1.assertFinancialValueFitsColumns)(amount, cols, 'payment ticket item amount');
            const inlineAmount = !amount || quantityWidth + amountWidth + 1 <= cols;
            const nameWidth = Math.max(1, cols - quantityWidth - (amount && inlineAmount ? amountWidth + 1 : 0));
            const nameLines = (0, formatting_helpers_1.wrapText)((0, formatting_helpers_1.safePrinterText)(item.product_name), nameWidth);
            const firstLine = quantity + (nameLines.shift() || '');
            if (amount && inlineAmount) {
                lines.push(firstLine + (0, formatting_helpers_1.rightAlign)(amount, cols - (0, width_1.displayCellWidth)(firstLine)));
            }
            else {
                lines.push(firstLine);
            }
            lines.push(...nameLines.map((line) => ' '.repeat(quantityWidth) + line));
            if (amount && !inlineAmount)
                lines.push((0, width_1.padToDisplayCells)(amount, cols, 'right'));
        }
        lines.push('-'.repeat(cols));
        const totalAmount = formatAmount(Number(order.total));
        const balanceAmount = formatAmount(Number(balance));
        const pushSummaryAmount = (label, amount, field) => {
            (0, formatting_helpers_1.assertFinancialValueFitsColumns)(amount, cols, field);
            const labelWidth = (0, width_1.displayCellWidth)(label);
            if (labelWidth + 1 + (0, width_1.displayCellWidth)(amount) <= cols) {
                lines.push(`${label}${(0, formatting_helpers_1.rightAlign)(amount, cols - labelWidth)}`);
            }
            else {
                lines.push(...(0, formatting_helpers_1.wrapText)(label, cols).map((line) => (0, width_1.padToDisplayCells)(line, cols)));
                lines.push((0, width_1.padToDisplayCells)(amount, cols, 'right'));
            }
        };
        pushSummaryAmount('Total:', totalAmount, 'payment ticket total');
        pushSummaryAmount('Balance Due:', balanceAmount, 'payment ticket balance');
        lines.push('-'.repeat(cols));
        lines.push('{CENTER}Please pay at the payment counter{/CENTER}');
        lines.push('{CENTER}Scan or enter ticket number to pay:{/CENTER}');
        const qrPayload = `FLOCAFE-TICKET:${order.order_number}`;
        const qrBytes = buildEscPosQrCode(qrPayload);
        lines.push(`{RAW_BYTES:${qrBytes.toString('base64')}}`);
        lines.push(`{CENTER}${qrPayload}{/CENTER}`);
        lines.push('');
        lines.push('{CUT}');
        const data = (0, formatting_helpers_1.buildEscPos)(lines, options.useUnicode ?? false, {
            cutMode: profile.cutMode,
            columns: cols,
        });
        if (options.preview) {
            return { ok: true, preview: true, bytes: Array.from(data), warnings: [] };
        }
        if (printer?.connection_type === 'webusb') {
            return {
                ok: true,
                bytes: Array.from(data),
                connection_type: 'webusb',
                warnings: [],
            };
        }
        return await dispatchPrint(printer, data, options.signal);
    }
    catch (error) {
        console.error('[Printer] Payment ticket print error:', error);
        return { ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
}
async function printPaymentTicketDetailed(...args) {
    const id = (0, errors_1.correlationId)();
    try {
        const dispatch = await printPaymentTicket(...args);
        const result = dispatch.ok
            ? {
                ok: true,
                correlationId: id,
                stage: 'dispatch',
                warnings: dispatch.warnings,
                bytes: dispatch.bytes,
                preview: dispatch.preview,
                connection_type: dispatch.connection_type,
            }
            : {
                ok: false,
                code: 'print.payment_ticket.failed',
                correlationId: id,
                stage: 'dispatch',
                detail: dispatch.detail,
                failureClass: dispatch.failureClass || classifyPrintFailure(dispatch.detail),
                platformErrorCode: dispatch.platformErrorCode || extractPlatformErrorCode(dispatch.detail),
                jobId: dispatch.jobId,
                driverName: dispatch.driverName,
                printerStatus: dispatch.printerStatus,
                warnings: dispatch.warnings,
            };
        if (!result.ok)
            reportPrintFailure('payment_ticket', result);
        return result;
    }
    catch (error) {
        const detail = error.message;
        const result = {
            ok: false,
            code: 'print.payment_ticket.failed',
            correlationId: id,
            stage: 'dispatch',
            detail,
            failureClass: classifyPrintFailure(detail),
            platformErrorCode: extractPlatformErrorCode(detail),
        };
        reportPrintFailure('payment_ticket', result);
        return result;
    }
}
/**
 * Report print failure via telemetry tiers (best-effort, non-blocking).
 */
function reportPrintFailure(kind, result) {
    let connectionType = 'unknown';
    try {
        const configured = getPrinterConfig()?.connection_type;
        if (configured === 'network' || configured === 'usb' || configured === 'webusb')
            connectionType = configured;
    }
    catch {
        /* best-effort only */
    }
    const failureClass = result.failureClass || classifyPrintFailure(result.detail);
    const pointStage = failureClass === 'timeout' ? 'timeout' : 'queue';
    cloud_sync_1.cloudSync.captureOperationFailure({
        capture_point: `fc.backend.printer.${kind}.${pointStage}`,
        outcome: result.stage === 'prepare' ? 'not_applied' : 'unknown',
        correlation_id: result.correlationId,
        facts: { connection_type: connectionType, failure_class: failureClass, kind },
    });
}
/** Typed adapters used by API callers while legacy boolean callers migrate. */
async function printReceiptDetailed(...args) {
    const id = (0, errors_1.correlationId)();
    try {
        const dispatch = await printReceipt(...args);
        const stage = !dispatch.ok && (0, warnings_1.hasFinancialPrintWarning)(dispatch.warnings || []) ? 'prepare' : 'dispatch';
        const result = dispatch.ok
            ? { ok: true, correlationId: id, stage: 'dispatch', warnings: dispatch.warnings }
            : {
                ok: false,
                code: 'print.receipt.failed',
                correlationId: id,
                stage,
                detail: dispatch.detail,
                failureClass: dispatch.failureClass || classifyPrintFailure(dispatch.detail),
                platformErrorCode: dispatch.platformErrorCode || extractPlatformErrorCode(dispatch.detail),
                jobId: dispatch.jobId,
                driverName: dispatch.driverName,
                printerStatus: dispatch.printerStatus,
                warnings: dispatch.warnings,
            };
        if (!result.ok)
            reportPrintFailure('receipt', result);
        return result;
    }
    catch (error) {
        const detail = error.message;
        const result = {
            ok: false,
            code: 'print.receipt.failed',
            correlationId: id,
            stage: 'dispatch',
            detail,
            failureClass: classifyPrintFailure(detail),
            platformErrorCode: extractPlatformErrorCode(detail),
        };
        reportPrintFailure('receipt', result);
        return result;
    }
}
async function printKOTDetailed(...args) {
    const id = (0, errors_1.correlationId)();
    try {
        const dispatch = await printKOT(...args);
        const result = dispatch.ok
            ? { ok: true, correlationId: id, stage: 'dispatch', warnings: dispatch.warnings }
            : {
                ok: false,
                code: 'print.kot.failed',
                correlationId: id,
                stage: 'dispatch',
                detail: dispatch.detail,
                failureClass: dispatch.failureClass || classifyPrintFailure(dispatch.detail),
                platformErrorCode: dispatch.platformErrorCode || extractPlatformErrorCode(dispatch.detail),
                jobId: dispatch.jobId,
                driverName: dispatch.driverName,
                printerStatus: dispatch.printerStatus,
                warnings: dispatch.warnings,
            };
        if (!result.ok)
            reportPrintFailure('kot', result);
        return result;
    }
    catch (error) {
        const detail = error.message;
        const result = {
            ok: false,
            code: 'print.kot.failed',
            correlationId: id,
            stage: 'dispatch',
            detail,
            failureClass: classifyPrintFailure(detail),
            platformErrorCode: extractPlatformErrorCode(detail),
        };
        reportPrintFailure('kot', result);
        return result;
    }
}
function getColumnsForPrinter(printer, profile) {
    const paperWidth = printer.paper_width || profile.defaultPaperWidth || '80mm';
    const explicitColumns = columnsForPaperWidth(paperWidth);
    if (explicitColumns)
        return explicitColumns;
    return profile.fontAColumns || 48;
}
function nativeFallbackCapabilities(capabilities) {
    return capabilities.raster.enabled
        ? { ...capabilities, raster: { ...capabilities.raster, enabled: false } }
        : capabilities;
}
function columnsForPaperWidth(paperWidth) {
    return (0, width_1.columnsForPaperWidth)(paperWidth);
}
/**
 * Resolves profile, layout column count, and capabilities aligned with printer paper_width and
 * text_size. `columns` is the width document layout must target; extra large text halves it.
 */
function resolvePrinterContext(printer, arabicShapingOverride) {
    const profile = (0, profiles_1.resolvePrinterProfile)(printer);
    const textSize = (0, text_size_1.normalizePrinterTextSize)(printer?.text_size);
    const columns = (0, text_size_1.layoutColumnsForTextSize)(getColumnsForPrinter(printer, profile), textSize);
    const baseCapabilities = (0, profiles_1.capabilitiesForPrinter)(profile, printer?.paper_width || profile.defaultPaperWidth, arabicShapingOverride);
    const capabilities = textSize === 'normal' ? baseCapabilities : { ...baseCapabilities, textSize };
    return { profile, columns, capabilities };
}
async function dispatchPrint(printer, data, signal) {
    switch (printer.connection_type) {
        case 'network':
            return await printViaNetwork(printer.ip_address, printer.port || 9100, data, signal);
        case 'usb':
            if (isMasRuntime() && process.platform !== 'darwin') {
                const detail = 'USB printers are not supported in the App Store build. Use a network printer.';
                console.log(`[Printer] ${detail}`);
                return { ok: false, detail, failureClass: classifyPrintFailure(detail) };
            }
            return await printViaUSB(data, printer.name, signal);
        case 'webusb':
            console.log('[Printer] WebUSB printer — not supported in Electron');
            return {
                ok: false,
                detail: 'WebUSB printers are handled in the browser, not by the desktop app',
            };
        default:
            console.log(`[Printer] Unsupported connection type: ${printer.connection_type}`);
            return { ok: false, detail: `Unsupported connection type: ${printer.connection_type}` };
    }
}
function getPrinterConfig() {
    const db = (0, db_1.getDatabase)();
    return db
        .prepare(`SELECT * FROM printers
     WHERE connection_type != 'webusb'
     ORDER BY is_default DESC, name
     LIMIT 1`)
        .get();
}
async function printMenuDocument(document, signal, targetPrinter, language = 'en') {
    try {
        if (signal?.aborted)
            return { ok: false, detail: 'Print cancelled during shutdown' };
        const printer = targetPrinter || getPrinterConfig();
        if (!printer)
            return { ok: false, detail: 'No printer configured' };
        const { profile, columns, capabilities } = resolvePrinterContext(printer);
        let rendered = (0, document_menu_1.renderMenuViaDocument)(document, {
            columns,
            language,
            arabicShaping: capabilities.shaping.arabic,
            cutMode: profile.cutMode,
            capabilities,
        });
        if ((0, raster_1.rasterCapabilityEnabled)(capabilities)) {
            const rasterized = await rasterizeDocumentLines(rendered.lines, rendered.warnings, {
                useUnicode: false,
                cutMode: profile.cutMode,
                arabicShaping: capabilities.shaping.arabic,
                columns,
                language,
                capabilities,
                requestPrefix: 'menu',
            });
            if (rasterized.rasterFailed) {
                return { ok: false, detail: 'Menu raster rendering failed', warnings: rasterized.warnings };
            }
            rendered = { ...rendered, data: rasterized.data, warnings: rasterized.warnings };
        }
        if (rendered.warnings.length > 0) {
            return {
                ok: false,
                detail: 'Menu text is not supported by the selected printer',
                warnings: rendered.warnings,
            };
        }
        if (printer.connection_type === 'webusb') {
            return {
                ok: true,
                bytes: rendered.data,
                connection_type: 'webusb',
                ...(rendered.warnings.length > 0 ? { warnings: rendered.warnings } : {}),
            };
        }
        const result = await dispatchPrint(printer, rendered.data, signal);
        return {
            ...result,
            bytes: rendered.data,
            connection_type: printer.connection_type,
            ...(rendered.warnings.length > 0 ? { warnings: rendered.warnings } : {}),
        };
    }
    catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        console.error('[Printer] Menu print failed:', detail);
        return { ok: false, detail };
    }
}
function prepareReceipt(order, bill, business, template = 'classic', useUnicode = false, isReprint = false, arabicShapingOverride, language, additionalLanguage) {
    let printer = getPrinterConfig();
    if (!printer) {
        printer = {
            id: 0,
            name: 'Default 80mm Preview',
            paper_width: '80mm',
        };
    }
    const { profile, columns, capabilities } = resolvePrinterContext(printer, arabicShapingOverride);
    const warnings = [];
    const nativeCapabilities = nativeFallbackCapabilities(capabilities);
    const data = formatReceipt(order, bill, business, template, columns, useUnicode, isReprint, profile.cutMode, warnings, nativeCapabilities.shaping.arabic, language, additionalLanguage, nativeCapabilities);
    return { printer, data, warnings, columns };
}
function receiptDocumentLines(order, bill, business, template, columns, useUnicode, isReprint, arabicShaping, language, additionalLanguage, cutMode, capabilities) {
    // See formatReceipt's identical placeholder below for why country + currency are both required.
    const biz = business || {
        name: 'Store',
        address: '',
        phone: '',
        taxRegistrationNumber: '',
        country: 'US',
        currency: 'USD',
    };
    const rasterBiz = { ...biz };
    const selection = (0, print_templates_1.parseBillTemplateSelection)(template);
    if (selection?.source === 'merchant') {
        const result = (0, document_merchant_1.renderMerchantReceiptViaDocument)(order, bill, rasterBiz, selection.id, {
            columns,
            language,
            ...(additionalLanguage !== undefined ? { additionalLanguage } : {}),
            isReprint,
            useUnicode,
            arabicShaping,
            cutMode,
            capabilities,
        });
        return { lines: result.lines, warnings: result.warnings, rasterGroups: result.rasterGroups };
    }
    const installedPack = selection?.source === 'pack' ? (0, print_templates_1.loadInstalledPrintTemplate)(selection.id) : null;
    if (installedPack) {
        const warnings = [];
        const result = pluginReceiptLines(installedPack, order, bill, rasterBiz, columns, useUnicode, isReprint, warnings, arabicShaping, language, capabilities);
        return {
            lines: result.lines,
            warnings,
            rasterGroups: result.rasterGroups,
            columns: result.columns,
        };
    }
    // A missing pack template prints the classic layout without the second language, as natively.
    const normalizedTemplate = selection?.source === 'pack'
        ? 'classic'
        : normalizeReceiptTemplate(selection?.source === 'core' ? selection.id : template);
    const rasterLanguage = selection?.source === 'pack' ? undefined : additionalLanguage;
    const result = normalizedTemplate === 'compact'
        ? (0, document_compact_1.renderCompactReceiptViaDocument)(order, bill, rasterBiz, {
            columns,
            language,
            ...(rasterLanguage !== undefined ? { additionalLanguage: rasterLanguage } : {}),
            isReprint,
            useUnicode,
            arabicShaping,
            cutMode,
            capabilities,
            preserveCurrencySymbol: true,
            maskCustomerPhone: false,
        })
        : (0, document_classic_1.renderClassicReceiptViaDocument)(order, bill, rasterBiz, {
            columns,
            language,
            ...(rasterLanguage !== undefined ? { additionalLanguage: rasterLanguage } : {}),
            isReprint,
            useUnicode,
            arabicShaping,
            cutMode,
            capabilities,
            preserveCurrencySymbol: true,
            maskCustomerPhone: false,
        });
    return result;
}
async function rasterizeDocumentLines(lines, sourceWarnings, options, rasterGroups) {
    let financialRasterText = '';
    const financialRasterContent = (rasterGroups ?? []).some((group) => {
        const sourceLines = group.sourceLines ?? lines.slice(group.lineIndex, group.lineIndex + group.lineCount);
        return sourceLines.some((line, index) => {
            const financial = group.financialSourceLines?.[index] ?? group.financial === true;
            const unsupported = financial && line.length > 0 && !(0, thermal_capabilities_1.isThermalTextRepresentable)(line, options.capabilities);
            if (unsupported)
                financialRasterText = line;
            return unsupported;
        });
    });
    let selectedFinancial = financialRasterContent;
    const failureResult = (error) => {
        const message = error instanceof Error ? error.message : String(error);
        const financial = selectedFinancial;
        const warnings = sourceWarnings.filter((warning) => warning.kind !== 'line' && warning.kind !== 'financial');
        warnings.push({
            field: financial ? 'financial row' : 'raster renderer',
            text: financial ? financialRasterText : '',
            message: `Raster rendering failed: ${message}`,
            kind: financial ? 'financial' : 'line',
        });
        return { data: Buffer.alloc(0), warnings, rasterSelected: false, rasterFailed: true };
    };
    let renderer;
    let result = failureResult(new Error('Raster renderer was not initialized'));
    try {
        const { getSharedRasterRenderer, renderUnsupportedRasterLines, whenRasterRendererReady, applyTextSizeToRasterInput, } = await Promise.resolve().then(() => __importStar(require('./raster-renderer')));
        await whenRasterRendererReady();
        renderer = getSharedRasterRenderer();
        const enlarged = applyTextSizeToRasterInput(lines, rasterGroups, options.capabilities.textSize ?? 'normal');
        const raster = await renderUnsupportedRasterLines(renderer, enlarged.lines, options.capabilities, options.requestPrefix, enlarged.groups);
        selectedFinancial =
            raster.units.some((unit) => unit.unit.financial) ||
                raster.failures.some((failure) => failure.financial);
        const warnings = sourceWarnings.filter((warning) => warning.kind !== 'line' && warning.kind !== 'financial');
        const data = (0, formatting_helpers_1.buildEscPos)(lines, options.useUnicode, {
            cutMode: options.cutMode,
            arabicShaping: options.arabicShaping,
            columns: options.columns,
            language: options.language,
            capabilities: options.capabilities,
            rasterUnits: raster.units,
            rasterFailures: raster.failures,
        }, warnings);
        for (const failure of raster.failures) {
            warnings.push({
                field: failure.financial ? 'financial row' : 'receipt line',
                text: failure.text,
                message: `Raster rendering failed (${failure.code}): ${failure.detail}`,
                kind: failure.financial ? 'financial' : 'line',
            });
        }
        result = {
            data,
            warnings,
            rasterSelected: raster.units.length > 0,
            rasterFailed: raster.failures.length > 0 ||
                warnings.some((warning) => warning.kind === 'line' || warning.kind === 'financial'),
        };
    }
    catch (error) {
        result = failureResult(error);
    }
    return result;
}
async function rasterizePrintDocumentForWebUsb(document, template, profileId, options) {
    const profile = (0, profiles_1.resolvePrinterProfile)({ profile_id: profileId });
    const capabilities = (0, profiles_1.capabilitiesForPrinter)(profile, `cols-${options.columns}`, options.arabicShaping);
    if (!(0, raster_1.rasterCapabilityEnabled)(capabilities, 'mixed'))
        return { ok: false, error: 'Raster output is not enabled for this printer profile' };
    const rasterGroups = [];
    const lines = template === 'compact'
        ? (0, document_compact_1.renderBillDocumentToCompactLines)(document, {
            ...options,
            preserveCurrencySymbol: true,
            cutMode: profile.cutMode,
            capabilities,
            maskCustomerPhone: false,
            rasterGroups,
        })
        : (0, document_classic_1.renderBillDocumentToClassicLines)(document, {
            ...options,
            preserveCurrencySymbol: true,
            cutMode: profile.cutMode,
            capabilities,
            maskCustomerPhone: false,
            rasterGroups,
        });
    const result = await rasterizeDocumentLines(lines, [], {
        ...options,
        cutMode: profile.cutMode,
        capabilities,
        requestPrefix: 'webusb-receipt',
    }, rasterGroups);
    if ((0, warnings_1.hasFinancialPrintWarning)(result.warnings)) {
        return { ok: false, error: (0, warnings_1.makeFinancialPrintRefusalMessage)(result.warnings) };
    }
    return {
        ok: true,
        data: result.data,
        warnings: result.warnings,
        rasterSelected: result.rasterSelected,
        rasterFailed: result.rasterFailed,
    };
}
async function rasterizeKotDocumentForWebUsb(document, profileId, options) {
    const profile = (0, profiles_1.resolvePrinterProfile)({ profile_id: profileId });
    const capabilities = (0, profiles_1.capabilitiesForPrinter)(profile, `cols-${options.columns}`, options.arabicShaping);
    if (!(0, raster_1.rasterCapabilityEnabled)(capabilities, 'mixed'))
        return { ok: false, error: 'Raster output is not enabled for this printer profile' };
    const rasterGroups = [];
    const lines = (0, document_kot_1.renderKotDocumentToLines)(document, {
        ...options,
        cutMode: profile.cutMode,
        capabilities,
        rasterGroups,
    });
    const result = await rasterizeDocumentLines(lines, [], {
        ...options,
        cutMode: profile.cutMode,
        capabilities,
        requestPrefix: 'webusb-kot',
    }, rasterGroups);
    if ((0, warnings_1.hasFinancialPrintWarning)(result.warnings)) {
        return { ok: false, error: (0, warnings_1.makeFinancialPrintRefusalMessage)(result.warnings) };
    }
    return {
        ok: true,
        data: result.data,
        warnings: result.warnings,
        rasterSelected: result.rasterSelected,
        rasterFailed: result.rasterFailed,
    };
}
async function rasterizeReceiptIfEnabled(prepared, order, bill, business, template, useUnicode, isReprint, arabicShapingOverride, language, additionalLanguage) {
    const { profile, capabilities } = resolvePrinterContext(prepared.printer, arabicShapingOverride);
    if (!(0, raster_1.rasterCapabilityEnabled)(capabilities))
        return prepared;
    const document = receiptDocumentLines(order, bill, business, template, prepared.columns, useUnicode, isReprint, capabilities.shaping.arabic, (0, formatting_helpers_1.normalizePrintLanguage)(language), additionalLanguage === undefined ? undefined : (0, formatting_helpers_1.normalizePrintLanguage)(additionalLanguage), profile.cutMode, capabilities);
    if (!document)
        return prepared;
    const result = await rasterizeDocumentLines(document.lines, document.warnings, {
        useUnicode,
        cutMode: profile.cutMode,
        arabicShaping: capabilities.shaping.arabic,
        columns: document.columns ?? prepared.columns,
        language: (0, formatting_helpers_1.normalizePrintLanguage)(language),
        capabilities,
        requestPrefix: 'receipt',
    }, document.rasterGroups);
    if (result.rasterFailed) {
        return { ...prepared, warnings: [...prepared.warnings, ...result.warnings] };
    }
    return result.rasterSelected
        ? { ...prepared, data: result.data, warnings: result.warnings }
        : prepared;
}
function formatReceipt(order, bill, business, template, cols = 48, useUnicode = false, isReprint = false, cutMode = 'full', warnings, arabicShaping = false, language, additionalLanguage, capabilities) {
    console.log('[Printer] formatReceipt - template:', template);
    console.log('[Printer] formatReceipt - order:', order?.order_number, 'bill:', bill?.bill_number);
    console.log('[Printer] formatReceipt - items count:', order?.items?.length || 0, 'cols:', cols);
    const lang = (0, formatting_helpers_1.normalizePrintLanguage)(language);
    // No business info supplied at all (e.g. a synthetic preview) — a neutral
    // explicit country + currency, never a default country or INR
    // (docs/reference/product-invariants.md). resolveTenantCurrency validates the
    // country before it ever looks at currency, so both must be present.
    const biz = business || {
        name: 'Store',
        address: '',
        phone: '',
        taxRegistrationNumber: '',
        country: 'US',
        currency: 'USD',
    };
    // Merchant templates resolve through document pipeline; pack templates use compliance renderer.
    const selection = (0, print_templates_1.parseBillTemplateSelection)(template);
    if (selection?.source === 'pack') {
        return renderPluginReceipt((0, print_templates_1.loadInstalledPrintTemplate)(selection.id), order, bill, biz, cols, useUnicode, isReprint, cutMode, warnings, arabicShaping, lang, capabilities);
    }
    if (selection?.source === 'merchant') {
        const result = (0, document_merchant_1.renderMerchantReceiptViaDocument)(order, bill, biz, selection.id, {
            columns: cols,
            language: lang,
            ...(additionalLanguage !== undefined
                ? { additionalLanguage: (0, formatting_helpers_1.normalizePrintLanguage)(additionalLanguage) }
                : {}),
            isReprint,
            useUnicode,
            arabicShaping,
            cutMode,
            capabilities,
        });
        if (warnings && result.warnings.length > 0)
            warnings.push(...result.warnings);
        return result.data;
    }
    const tpl = normalizeReceiptTemplate(selection?.source === 'core' ? selection.id : template);
    try {
        switch (tpl) {
            case 'classic':
                return formatClassicReceipt(order, bill, biz, cols, useUnicode, isReprint, cutMode, warnings, arabicShaping, lang, additionalLanguage, capabilities);
            default:
                return formatCompactReceipt(order, bill, biz, cols, useUnicode, isReprint, cutMode, warnings, arabicShaping, lang, additionalLanguage, capabilities);
        }
    }
    catch (err) {
        console.error('[Printer] formatReceipt error:', err);
        throw err;
    }
}
function normalizeReceiptTemplate(template) {
    const normalized = String(template || 'classic')
        .toLowerCase()
        .replace(/[^a-z]/g, '');
    if (normalized.includes('compact') || normalized.includes('minimal'))
        return 'compact';
    return 'classic';
}
function renderPluginReceipt(template, order, bill, biz, cols, useUnicode, isReprint, cutMode, warnings, arabicShaping = false, lang = 'en', capabilities) {
    if (!template)
        return formatClassicReceipt(order, bill, biz, cols, useUnicode, isReprint, cutMode, warnings, arabicShaping, lang, undefined, capabilities);
    const rendered = pluginReceiptLines(template, order, bill, biz, cols, useUnicode, isReprint, warnings, arabicShaping, lang, capabilities);
    return (0, formatting_helpers_1.buildEscPos)(rendered.lines, useUnicode, {
        cutMode,
        arabicShaping,
        columns: rendered.columns,
        language: lang,
        capabilities,
        financialLineRanges: rendered.financialLineRanges,
    }, warnings);
}
function pluginReceiptLines(template, order, bill, biz, cols, useUnicode, isReprint, warnings, arabicShaping = false, lang = 'en', capabilities) {
    const renderer = parseJson(template.renderer_json, {});
    const payload = parseJson(template.template_payload_json, {});
    if (renderer.id !== 'flocafe-thermal-receipt-template' ||
        renderer.version !== 1 ||
        payload.format !== 'escpos-line-template-v1') {
        throw new Error(`Unsupported receipt plugin renderer for template ${template.template_id}`);
    }
    const profile = selectTemplateRenderProfile(payload, cols, capabilities?.textSize ?? 'normal', warnings);
    return escposLineTemplateV1Lines(payload, profile, order, bill, biz, useUnicode, isReprint, arabicShaping, lang, capabilities);
}
function parseJson(raw, fallback) {
    try {
        return JSON.parse(raw);
    }
    catch {
        return fallback;
    }
}
/**
 * Picks the pack width profile by physical paper width, then reflows its layout when enlarged text
 * narrows the target column count.
 */
function selectTemplateRenderProfile(payload, layoutColumns, textSize, warnings) {
    const selected = selectTemplateWidthProfile(payload, (0, text_size_1.physicalColumnsForTextSize)(layoutColumns, textSize), warnings);
    const columns = (0, text_size_1.layoutColumnsForTextSize)(selected.columns, textSize);
    if (columns >= selected.columns) {
        return { ...selected, columns };
    }
    return {
        ...selected,
        columns,
        layout: reflowTemplateLayout(selected.layout, columns),
    };
}
function compactPluginColumnFloor(key, width) {
    switch (key) {
        case 'quantity':
            return Math.min(width, 3);
        case 'taxRate':
            return Math.min(width, 4);
        case 'rate':
        case 'amount':
            return Math.min(width, 6);
        default:
            return Math.min(width, 6);
    }
}
function reflowPluginLineItems(lineItems, targetColumns) {
    const configured = lineItems?.columns;
    if (!Array.isArray(configured) || configured.length === 0)
        return lineItems;
    const validIndices = [];
    for (let i = 0; i < configured.length; i += 1) {
        const col = configured[i];
        if (col?.key && Number.isInteger(Number(col?.width)) && Number(col?.width) > 0) {
            validIndices.push(i);
        }
    }
    if (validIndices.length === 0)
        return lineItems;
    const rawGap = Number(lineItems?.gap);
    const configuredGap = Number.isInteger(rawGap) && rawGap >= 0 && rawGap <= 4 ? rawGap : 0;
    const origWidths = validIndices.map((index) => Number(configured[index].width));
    const currentTotal = origWidths.reduce((sum, width) => sum + width, 0) +
        configuredGap * Math.max(0, validIndices.length - 1);
    if (currentTotal <= targetColumns)
        return lineItems;
    const gap = validIndices.length <= 1 || configuredGap === 0 || targetColumns < validIndices.length * 2
        ? 0
        : 1;
    const available = Math.max(validIndices.length, targetColumns - gap * Math.max(0, validIndices.length - 1));
    const widths = validIndices.map((index, pos) => compactPluginColumnFloor(configured[index]?.key, origWidths[pos]));
    const sum = widths.reduce((acc, width) => acc + width, 0);
    if (sum < available) {
        let extra = available - sum;
        const itemPos = validIndices.findIndex((index) => isPluginItemColumn(configured[index]));
        const minItemShare = itemPos >= 0 ? Math.min(origWidths[itemPos], Math.ceil(available * 0.45)) : 0;
        if (itemPos >= 0 && widths[itemPos] < minItemShare) {
            const add = Math.min(extra, minItemShare - widths[itemPos]);
            widths[itemPos] += add;
            extra -= add;
        }
        for (const key of ['amount', 'rate', 'quantity', 'taxRate']) {
            if (extra <= 0)
                break;
            const pos = validIndices.findIndex((index) => configured[index]?.key === key);
            if (pos < 0)
                continue;
            const cap = key === 'amount'
                ? Math.min(origWidths[pos], 9)
                : key === 'rate'
                    ? Math.min(origWidths[pos], 7)
                    : Math.min(origWidths[pos], 4);
            if (widths[pos] < cap) {
                const add = Math.min(extra, cap - widths[pos]);
                widths[pos] += add;
                extra -= add;
            }
        }
        if (extra > 0) {
            const targetPos = itemPos >= 0 ? itemPos : 0;
            widths[targetPos] += extra;
        }
    }
    else if (sum > available) {
        let deficit = sum - available;
        const shrinkOrder = [
            { match: (col) => isPluginItemColumn(col), minWidth: 4 },
            { match: (col) => col?.key === 'quantity', minWidth: 2 },
            { match: (col) => col?.key === 'rate' || col?.key === 'taxRate', minWidth: 4 },
            { match: (col) => col?.key !== 'amount', minWidth: 1 },
            { match: () => true, minWidth: 1 },
        ];
        for (const rule of shrinkOrder) {
            for (let pos = 0; pos < validIndices.length && deficit > 0; pos += 1) {
                const col = configured[validIndices[pos]];
                if (!rule.match(col))
                    continue;
                const reducible = Math.max(0, widths[pos] - rule.minWidth);
                if (reducible > 0) {
                    const take = Math.min(deficit, reducible);
                    widths[pos] -= take;
                    deficit -= take;
                }
            }
        }
    }
    const nextColumns = configured.map((col) => ({ ...col }));
    validIndices.forEach((colIndex, pos) => {
        const col = nextColumns[colIndex];
        const origWidth = origWidths[pos];
        const nextWidth = widths[pos];
        col.width = nextWidth;
        if (isPluginItemColumn(col) &&
            col.wrap === true &&
            nextWidth < origWidth &&
            typeof col.maxLines === 'number' &&
            Number.isInteger(col.maxLines) &&
            col.maxLines > 0) {
            col.maxLines = Math.ceil((col.maxLines * origWidth) / nextWidth);
        }
    });
    return {
        ...lineItems,
        ...(Number.isInteger(rawGap) ? { gap } : {}),
        columns: nextColumns,
    };
}
function reflowTemplateLayout(layout, targetColumns) {
    if (!layout || typeof layout !== 'object' || targetColumns <= 0)
        return layout;
    const layoutRecord = layout;
    const rawLineItems = layoutRecord.lineItems && typeof layoutRecord.lineItems === 'object'
        ? layoutRecord.lineItems
        : undefined;
    const nextLineItems = rawLineItems
        ? reflowPluginLineItems(rawLineItems, targetColumns)
        : layoutRecord.lineItems;
    const rawTaxSummary = layoutRecord.taxSummary && typeof layoutRecord.taxSummary === 'object'
        ? layoutRecord.taxSummary
        : undefined;
    let nextTaxSummary = layoutRecord.taxSummary;
    const labelWidth = Number(rawTaxSummary?.labelWidth);
    const amountWidth = Number(rawTaxSummary?.amountWidth);
    if (rawTaxSummary &&
        Number.isInteger(labelWidth) &&
        Number.isInteger(amountWidth) &&
        labelWidth > 0 &&
        amountWidth > 0) {
        const gap = targetColumns >= 3 ? 1 : 0;
        if (labelWidth + amountWidth + gap > targetColumns) {
            const minLabel = Math.min(labelWidth, Math.min(8, Math.max(1, Math.floor(targetColumns / 2))));
            const nextAmountWidth = Math.max(1, Math.min(amountWidth, targetColumns - gap - minLabel));
            const nextLabelWidth = Math.max(1, targetColumns - gap - nextAmountWidth);
            nextTaxSummary = {
                ...rawTaxSummary,
                labelWidth: nextLabelWidth,
                amountWidth: nextAmountWidth,
            };
        }
    }
    if (nextLineItems === layoutRecord.lineItems && nextTaxSummary === layoutRecord.taxSummary) {
        return layout;
    }
    return {
        ...layoutRecord,
        ...(nextLineItems !== layoutRecord.lineItems ? { lineItems: nextLineItems } : {}),
        ...(nextTaxSummary !== layoutRecord.taxSummary ? { taxSummary: nextTaxSummary } : {}),
    };
}
function selectTemplateWidthProfile(payload, printerColumns, warnings) {
    const profiles = collectTemplateWidthProfiles(payload);
    const exact = profiles.find((profile) => profile.columns === printerColumns);
    if (exact)
        return exact;
    const smaller = profiles
        .filter((profile) => profile.columns < printerColumns)
        .sort((a, b) => b.columns - a.columns)[0];
    if (smaller)
        return smaller;
    warnings?.push({
        field: 'bill_template_width',
        text: String(printerColumns),
        message: `Template has no ${printerColumns}-column profile; rendered with the printer width instead of squeezing a wider profile.`,
    });
    return { columns: printerColumns, layout: {} };
}
function collectTemplateWidthProfiles(payload) {
    if (!Array.isArray(payload?.widthProfiles))
        return [];
    return payload.widthProfiles
        .map((profile) => ({
        columns: Number(profile?.columns),
        layout: profile?.layout && typeof profile.layout === 'object' ? profile.layout : {},
    }))
        .filter((profile) => Number.isInteger(profile.columns) && profile.columns >= 32 && profile.columns <= 48)
        .sort((a, b) => a.columns - b.columns);
}
/** Template charge-row ids are camelCase; the engine breakdown stores snake_case ids. */
const TEMPLATE_ROW_TO_CHARGE_ID = {
    serviceCharge: 'service_charge',
    packagingCharge: 'packaging_charge',
};
function escposLineTemplateV1Lines(payload, profile, order, bill, biz, useUnicode, isReprint, arabicShaping = false, lang = 'en', capabilities) {
    const lines = [];
    const financialLineRanges = [];
    const rasterGroups = [];
    // The layout lets a raster fallback render the full row with its amount right-aligned.
    const pushFinancialLines = (financialLines, layout) => {
        if (financialLines.length === 0)
            return;
        const lineIndex = lines.length;
        financialLineRanges.push({ lineIndex, lineCount: financialLines.length });
        rasterGroups.push({
            groupId: `pack-financial-${lineIndex}`,
            lineIndex,
            lineCount: financialLines.length,
            financial: true,
            ...(layout
                ? {
                    sourceLines: [layout.columns.map((column) => column.text).join(' ')],
                    sourceControlLines: [financialLines[0]],
                    sourceLayouts: [layout],
                    financialSourceLines: [true],
                }
                : {}),
        });
        lines.push(...financialLines);
    };
    const summaryLayout = (label, value) => ({
        kind: 'financial-summary',
        columns: [
            { text: label, align: 'left' },
            { text: value.trimStart(), align: 'right' },
        ],
    });
    const pushFinancialRow = (label, value, bold = false) => {
        const rows = (0, formatting_helpers_1.financialRows)(label, value, cols, lang, capabilities);
        pushFinancialLines(bold ? rows.map((line) => `{BOLD}${line}{/BOLD}`) : rows, summaryLayout(label, value));
    };
    const cols = profile.columns;
    const layout = profile.layout || {};
    const date = (0, db_1.parseDbTimestamp)(order.created_at);
    const bar = '='.repeat(cols);
    const dash = '-'.repeat(cols);
    const currency = (0, countries_1.resolveTenantCurrency)(biz.currency, biz.country);
    const fractionDigits = (0, countries_1.getCurrencyFractionDigits)(currency);
    const trimDecimals = biz.trim_decimals === true;
    const locale = (0, countries_1.getCountryByCode)(biz.country)?.locale ?? 'en-US';
    // CLDR-derived only — a stored currency_symbol setting is not an input
    // (docs/reference/product-invariants.md: no per-store override of a snapshot value).
    const prefix = (0, formatting_helpers_1.resolveCurrencyPrefix)((0, countries_1.getCurrencySymbol)(currency, locale) || currency, useUnicode, capabilities, false, currency);
    const normalize = (text) => (0, formatting_helpers_1.normalizeThermalText)(text, capabilities);
    const configuredTaxLabel = normalize((0, template_labels_1.sanitizeTemplateLabelText)(String(payload?.fields?.taxRegistrationNumberLabel ||
        (0, countries_1.getCountryByCode)(biz.country)?.taxIdLabel ||
        'Tax ID')));
    const taxComponents = (0, tax_components_1.resolveTaxComponents)({ ...bill, items: order.items });
    const hasTax = Number(bill.tax_amount) !== 0 || taxComponents.some((component) => component.amount !== 0);
    // Sanitize pack strings against reserved tokens and clamp to selected width profile.
    const title = hasTax
        ? (0, template_labels_1.fitTemplateLabel)(normalize(String(payload?.header?.taxTitleWhenTaxPresent || '')), cols) ||
            (0, template_labels_1.fitTemplateLabel)(normalize((0, template_labels_1.resolveTemplateLabel)(payload?.labels, 'taxInvoice', lang)), cols)
        : (0, template_labels_1.fitTemplateLabel)(normalize(String(payload?.header?.titleWhenTaxAbsent || '')), cols) ||
            (0, template_labels_1.fitTemplateLabel)(normalize((0, template_labels_1.resolveTemplateLabel)(payload?.labels, 'invoice', lang)), cols);
    const tzOptions = biz.timezone ? { timeZone: biz.timezone } : undefined;
    lines.push('{INIT}');
    if (isReprint)
        lines.push('{CENTER}{BOLD}{DOUBLE_HEIGHT}{DOUBLE_WIDTH}** ' +
            normalize((0, print_labels_generated_1.printLabel)(lang, 'receipt.reprint')) +
            ' **{/DOUBLE_WIDTH}{/DOUBLE_HEIGHT}{/BOLD}{/CENTER}');
    if (biz.show_name !== false && biz.name) {
        const name = payload?.header?.businessNameTransform === 'uppercase'
            ? String(biz.name).toUpperCase()
            : String(biz.name);
        lines.push('{STORE_NAME}{CENTER}{BOLD}' +
            (0, formatting_helpers_1.truncateShapedLine)(name, cols, arabicShaping, lang, capabilities) +
            '{/BOLD}{/CENTER}');
    }
    lines.push(bar);
    lines.push(`{CENTER}${title}{/CENTER}`);
    lines.push(bar);
    lines.push(normalize((0, print_labels_generated_1.printLabel)(lang, 'print.invoiceNumber')) +
        ' ' +
        (bill.bill_number || order.order_number));
    lines.push(normalize((0, print_labels_generated_1.printLabel)(lang, 'receipt.date')) +
        ': ' +
        date.toLocaleDateString(locale + '-u-nu-latn', tzOptions));
    lines.push(normalize((0, print_labels_generated_1.printLabel)(lang, 'print.time')) +
        ': ' +
        date.toLocaleTimeString(locale + '-u-nu-latn', tzOptions));
    if (biz.show_table_number !== false && order.table?.name)
        lines.push((0, formatting_helpers_1.truncateShapedLine)(formatTableLabel(order.table.name, lang), cols, arabicShaping, lang, capabilities));
    // The heading marks these as the customer's details, so a receipt that also
    // prints the store address cannot read as carrying a second business address.
    const deliveryAddress = String(order?.delivery_address ?? '').trim();
    if (deliveryAddress.length > 0)
        lines.push(normalize((0, print_labels_generated_1.printLabel)(lang, 'print.customerDetails')));
    if (biz.show_customer_name !== false && biz.customer_name)
        lines.push((0, formatting_helpers_1.truncateShapedLine)((0, print_labels_generated_1.printLabel)(lang, 'pos.customer') + ': ' + biz.customer_name, cols, arabicShaping, lang, capabilities));
    if (biz.show_customer_phone !== false && biz.customer_phone)
        lines.push(normalize((0, print_labels_generated_1.printLabel)(lang, 'print.numberShort')) + ': ' + biz.customer_phone);
    if (deliveryAddress.length > 0) {
        // Wrapped, not truncated, so the courier reads the whole address.
        (0, formatting_helpers_1.pushWrapped)(lines, normalize((0, print_labels_generated_1.printLabel)(lang, 'print.deliverySlip.address')) + ': ' + deliveryAddress, cols, lang, capabilities);
    }
    lines.push(dash);
    lines.push(pluginItemHeader(layout, cols, lang, capabilities));
    lines.push(dash);
    if (order.items) {
        const amtLen = (0, formatting_helpers_1.itemAmountWidth)(order, prefix, locale, trimDecimals, cols, fractionDigits);
        const itemNameLen = (0, formatting_helpers_1.itemNameWidth)(cols, amtLen);
        for (const item of order.items) {
            if ((0, order_item_status_1.isExcludedFromBillReceipt)(item.status))
                continue;
            pushFinancialLines(pluginItemRows(item, layout, cols, prefix, locale, trimDecimals, fractionDigits, lang, capabilities), pluginItemLayout(item, layout, cols, prefix, locale, trimDecimals, fractionDigits, lang, capabilities));
            if (pluginDetailLines(layout).includes('addons')) {
                for (const addon of (0, formatting_helpers_1.parseAddons)(item.addons)) {
                    const quantitySuffix = typeof addon.quantity === 'number' && addon.quantity > 1 ? ` x${addon.quantity}` : '';
                    const addonLabel = '  + ' + addon.name + quantitySuffix;
                    if (addon.price) {
                        const addonAmount = (0, formatting_helpers_1.formatCurrency)(addon.price, prefix, locale, trimDecimals, fractionDigits);
                        const addonLines = (0, formatting_helpers_1.addonRows)(addon, itemNameLen, amtLen, cols, prefix, locale, trimDecimals, lang, fractionDigits, capabilities);
                        pushFinancialLines(addonLines, summaryLayout(addonLabel, addonAmount));
                    }
                    else {
                        (0, formatting_helpers_1.pushWrapped)(lines, addonLabel, cols, lang, capabilities);
                    }
                }
            }
            if (item.serving_summary) {
                (0, formatting_helpers_1.pushWrapped)(lines, '  Serving: ' + item.serving_summary, cols, lang, capabilities);
            }
            if (pluginDetailLines(layout).includes('specialInstructions') && item.special_instructions) {
                (0, formatting_helpers_1.pushWrapped)(lines, '  ' + normalize((0, print_labels_generated_1.printLabel)(lang, 'print.note')) + ': ' + item.special_instructions, cols, lang, capabilities);
            }
        }
    }
    lines.push(dash);
    // Row labels share line with right-aligned amount; clamped with 12-column reserve.
    const rowLabelWidth = Math.max(8, cols - 12);
    if (payload?.totals?.showSubtotal !== false) {
        const label = (0, template_labels_1.fitTemplateLabel)(normalize((0, template_labels_1.resolveTemplateLabel)(payload?.labels, 'subtotal', lang)), rowLabelWidth);
        pushFinancialRow(label, (0, formatting_helpers_1.formatCurrency)(bill.subtotal, prefix, locale, trimDecimals, fractionDigits));
    }
    if (Number(bill.discount_amount) > 0 && payload?.totals?.showDiscount !== false) {
        const label = (0, template_labels_1.fitTemplateLabel)(normalize((0, template_labels_1.resolveTemplateLabel)(payload?.labels, 'discount', lang)), rowLabelWidth);
        pushFinancialRow(label, '-' + (0, formatting_helpers_1.formatCurrency)(bill.discount_amount, prefix, locale, trimDecimals, fractionDigits));
    }
    if (biz.show_tax_breakdown !== false && taxComponents.length > 0) {
        for (const tax of taxComponents) {
            if (tax.amount === 0)
                continue;
            const hasRate = tax.rate !== null && tax.rate !== undefined && String(tax.rate).trim() !== '';
            const rateToken = hasRate ? `@${String(tax.rate).trim()}%` : '';
            if (hasRate) {
                (0, formatting_helpers_1.assertFinancialValueFitsColumns)(rateToken, cols, 'tax rate');
            }
            const rawLabel = hasRate ? `${tax.title} ${rateToken}` : tax.title;
            const taxAmount = (0, formatting_helpers_1.formatCurrency)(tax.amount, prefix, locale, trimDecimals, fractionDigits);
            pushFinancialLines(pluginSummaryRow(rawLabel, taxAmount, layout, cols, lang, capabilities), summaryLayout(normalize(rawLabel), taxAmount));
        }
    }
    else if (Number(bill.tax_amount) !== 0) {
        const label = (0, template_labels_1.fitTemplateLabel)(normalize((0, template_labels_1.resolveTemplateLabel)(payload?.labels, 'tax', lang)), rowLabelWidth);
        pushFinancialRow(label, (0, formatting_helpers_1.formatCurrency)(bill.tax_amount, prefix, locale, trimDecimals, fractionDigits));
    }
    // chargeRows capability declaration preserves stable country/legal row order.
    // When the bill carries an engine breakdown it is the itemised source of truth,
    // so the standard rows it already covers are not repeated below.
    const itemisedCharges = (0, charges_1.receiptChargeLines)(bill.charges_breakdown);
    const itemisedIds = new Set(itemisedCharges.map((charge) => charge.id));
    const chargeAmounts = {
        serviceCharge: Number(bill.service_charge) || 0,
        deliveryCharge: Number(bill.delivery_charge) || 0,
        packagingCharge: Number(bill.packaging_charge) || 0,
    };
    for (const row of (0, template_labels_1.declaredTemplateChargeRows)(payload?.totals?.chargeRows)) {
        const amount = chargeAmounts[row];
        if (amount === 0)
            continue;
        const chargeId = TEMPLATE_ROW_TO_CHARGE_ID[row] ?? row;
        if (itemisedIds.has(chargeId))
            continue;
        const label = (0, template_labels_1.fitTemplateLabel)(normalize((0, template_labels_1.resolveTemplateLabel)(payload?.labels, row, lang)), rowLabelWidth);
        pushFinancialRow(label, (0, formatting_helpers_1.formatCurrency)(amount, prefix, locale, trimDecimals, fractionDigits));
    }
    // Merchant-named surcharges have no catalog label; the configured name is the
    // label, so only the amount needs formatting.
    for (const charge of itemisedCharges) {
        pushFinancialRow(charge.name, (0, formatting_helpers_1.formatCurrency)(charge.amount, prefix, locale, trimDecimals, fractionDigits));
    }
    lines.push(bar);
    // Label precedence: template literal wins, then labels map, then localized catalog.
    const totalLabel = (0, template_labels_1.fitTemplateLabel)(normalize(String(payload?.totals?.grandTotalLabel || '')), rowLabelWidth) ||
        (0, template_labels_1.fitTemplateLabel)(normalize((0, template_labels_1.resolveTemplateLabel)(payload?.labels, 'total', lang)), rowLabelWidth);
    pushFinancialRow(totalLabel, (0, formatting_helpers_1.formatCurrency)(bill.total, prefix, locale, trimDecimals, fractionDigits), true);
    if (bill.payment_details) {
        lines.push(dash);
        try {
            const payments = typeof bill.payment_details === 'string'
                ? JSON.parse(bill.payment_details)
                : bill.payment_details;
            if (payments && Array.isArray(payments)) {
                for (const payment of payments) {
                    if (payment && payment.method) {
                        const amount = Number(payment.amount) || 0;
                        const methodLabel = (0, formatting_helpers_1.truncate)(resolvePaymentMethodLabel(String(payment.method), lang), cols - 12, lang, capabilities);
                        pushFinancialRow(methodLabel, (0, formatting_helpers_1.formatCurrency)(amount, prefix, locale, trimDecimals, fractionDigits));
                        const tender = (0, print_1.projectCashTender)({
                            method: String(payment.method),
                            amount,
                            tendered: (0, print_1.optionalPaymentAmount)(payment.tendered_amount),
                            change: (0, print_1.optionalPaymentAmount)(payment.change_amount),
                        });
                        if (tender) {
                            const tenderedLabel = (0, formatting_helpers_1.truncate)((0, print_labels_generated_1.printLabel)(lang, 'receipt.cashReceived'), cols - 12, lang, capabilities);
                            pushFinancialRow(tenderedLabel, (0, formatting_helpers_1.formatCurrency)(tender.tendered, prefix, locale, trimDecimals, fractionDigits));
                            if (tender.change > 0) {
                                const changeLabel = (0, formatting_helpers_1.truncate)((0, print_labels_generated_1.printLabel)(lang, 'pos.changeReturned'), cols - 12, lang, capabilities);
                                pushFinancialRow(changeLabel, (0, formatting_helpers_1.formatCurrency)(tender.change, prefix, locale, trimDecimals, fractionDigits));
                            }
                        }
                    }
                }
            }
        }
        catch (err) {
            console.warn('[Printer] Failed to parse payment details JSON:', err.message);
        }
    }
    lines.push(bar);
    if (biz.show_address !== false && biz.address)
        (0, formatting_helpers_1.pushWrapped)(lines, normalize((0, print_labels_generated_1.printLabel)(lang, 'print.address')) + ': ' + biz.address, cols, lang, capabilities);
    if (biz.show_phone !== false && biz.phone)
        (0, formatting_helpers_1.pushWrapped)(lines, normalize((0, print_labels_generated_1.printLabel)(lang, 'print.phoneLong')) + ': ' + biz.phone, cols, lang, capabilities);
    const showTaxRegistration = payload?.totals?.showTaxRegistrationNumber === 'when_tax_present_or_enabled'
        ? hasTax || biz.show_tax_id === true
        : biz.show_tax_id === true;
    if (showTaxRegistration && biz.taxRegistrationNumber)
        (0, formatting_helpers_1.pushWrapped)(lines, configuredTaxLabel + ': ' + biz.taxRegistrationNumber, cols, lang, capabilities);
    if (payload?.footer?.useConfiguredFooterNote !== false && biz.footer_note)
        (0, formatting_helpers_1.pushCenteredWrapped)(lines, biz.footer_note, cols, lang, capabilities);
    else
        lines.push('{CENTER}' +
            ((0, template_labels_1.fitTemplateLabel)(normalize(String(payload?.footer?.defaultMessage || '')), cols) ||
                (0, template_labels_1.fitTemplateLabel)(normalize((0, template_labels_1.resolveTemplateLabel)(payload?.labels, 'footerThanks', lang)), cols)) +
            '{/CENTER}');
    if (payload?.footer?.includePoweredByFloPOS !== false)
        (0, formatting_helpers_1.appendPoweredByFooter)(lines, cols);
    lines.push('{CUT}');
    return { lines, columns: cols, financialLineRanges, rasterGroups };
}
/** Compact thermal receipt: builds PrintDocument and renders via document-compact pipeline. */
function formatCompactReceipt(order, bill, biz, cols = 48, useUnicode = false, isReprint = false, cutMode = 'full', warnings, arabicShaping = false, lang = 'en', additionalLanguage, capabilities) {
    const result = (0, document_compact_1.renderCompactReceiptViaDocument)(order, bill, biz, {
        columns: cols,
        language: lang,
        ...(additionalLanguage !== undefined ? { additionalLanguage } : {}),
        isReprint,
        useUnicode,
        arabicShaping,
        cutMode,
        capabilities,
    });
    if (warnings && result.warnings.length > 0)
        warnings.push(...result.warnings);
    return result.data;
}
/** Classic thermal receipt: builds PrintDocument and renders via document-classic pipeline. */
function formatClassicReceipt(order, bill, biz, cols = 48, useUnicode = false, isReprint = false, cutMode = 'full', warnings, arabicShaping = false, lang = 'en', additionalLanguage, capabilities) {
    const result = (0, document_classic_1.renderClassicReceiptViaDocument)(order, bill, biz, {
        columns: cols,
        language: lang,
        ...(additionalLanguage !== undefined ? { additionalLanguage } : {}),
        isReprint,
        useUnicode,
        arabicShaping,
        cutMode,
        capabilities,
    });
    if (warnings && result.warnings.length > 0)
        warnings.push(...result.warnings);
    return result.data;
}
const PLUGIN_FINANCIAL_COLUMN_KEYS = new Set(['quantity', 'rate', 'taxRate', 'amount']);
function isPluginFinancialColumn(column) {
    return Boolean(column?.key && PLUGIN_FINANCIAL_COLUMN_KEYS.has(column.key));
}
function pluginLineItemColumns(layout, cols, lang = 'en', capabilities) {
    const configured = layout?.lineItems?.columns;
    if (Array.isArray(configured) && configured.length > 0) {
        const columns = configured
            .map((column) => {
            const key = typeof column?.key === 'string' ? column.key : undefined;
            const financial = Boolean(key && PLUGIN_FINANCIAL_COLUMN_KEYS.has(key));
            return {
                key,
                label: typeof column?.label === 'string'
                    ? (0, formatting_helpers_1.normalizeThermalText)(column.label, capabilities)
                    : undefined,
                width: Number(column?.width),
                align: (column?.align === 'right' || column?.align === 'center'
                    ? column.align
                    : 'left'),
                wrap: !financial && column?.wrap === true,
                maxLines: Number.isInteger(column?.maxLines) && column.maxLines > 0 ? column.maxLines : undefined,
                ellipsis: financial ? false : column?.ellipsis !== false,
            };
        })
            .filter((column) => column.key && Number.isInteger(column.width) && Number(column.width) > 0);
        if (columns.length > 0)
            return columns;
    }
    const gap = pluginLineGap(layout);
    return [
        {
            key: 'item',
            label: (0, formatting_helpers_1.normalizeThermalText)((0, print_labels_generated_1.printLabel)(lang, 'receipt.item'), capabilities),
            width: Math.max(1, (0, formatting_helpers_1.itemNameWidth)(cols, 10) - gap * 2),
            align: 'left',
            wrap: true,
            maxLines: 2,
            ellipsis: true,
        },
        {
            key: 'quantity',
            label: (0, formatting_helpers_1.normalizeThermalText)((0, print_labels_generated_1.printLabel)(lang, 'receipt.qty'), capabilities),
            width: 4,
            align: 'left',
        },
        {
            key: 'amount',
            label: (0, formatting_helpers_1.normalizeThermalText)((0, print_labels_generated_1.printLabel)(lang, 'receipt.amount'), capabilities),
            width: 10,
            align: 'right',
        },
    ];
}
function pluginLineGap(layout) {
    const configured = layout?.lineItems?.columns;
    if (!Array.isArray(configured) || configured.length === 0)
        return 1;
    const gap = Number(layout?.lineItems?.gap);
    return Number.isInteger(gap) && gap >= 0 && gap <= 4 ? gap : 0;
}
function pluginDetailLines(layout) {
    const detailLines = layout?.lineItems?.detailLines;
    if (!Array.isArray(detailLines))
        return ['addons', 'specialInstructions'];
    return detailLines.filter((line) => typeof line === 'string');
}
function pluginItemHeader(layout, cols, lang = 'en', capabilities) {
    return composePluginColumns(pluginLineItemColumns(layout, cols, lang, capabilities).map((column) => ({
        ...column,
        value: column.label || column.key || '',
    })), pluginLineGap(layout), cols);
}
function isPluginItemColumn(column) {
    if (!column || isPluginFinancialColumn(column))
        return false;
    return column.wrap === true || column.key === 'item';
}
function fitPluginRowColumns(columns, gap = 1) {
    const widths = columns.map((column) => Number(column.width));
    for (let i = columns.length - 1; i >= 0; i -= 1) {
        if (isPluginItemColumn(columns[i]))
            continue;
        const minSep = gap === 0 && i > 0 ? 1 : 0;
        const needed = (0, width_1.displayCellWidth)(columns[i].value) + minSep;
        if (needed <= widths[i])
            continue;
        let deficit = needed - widths[i];
        for (let j = 0; j < columns.length && deficit > 0; j += 1) {
            if (j === i || isPluginItemColumn(columns[j]))
                continue;
            const minFloor = Math.max(1, (0, width_1.displayCellWidth)(columns[j].value) + (gap === 0 && j > 0 ? 1 : 0));
            const spare = Math.max(0, widths[j] - minFloor);
            if (spare > 0) {
                const take = Math.min(deficit, spare);
                widths[j] -= take;
                widths[i] += take;
                deficit -= take;
            }
        }
        for (let j = 0; j < columns.length && deficit > 0; j += 1) {
            if (j === i || !isPluginItemColumn(columns[j]))
                continue;
            const spare = Math.max(0, widths[j] - 4);
            if (spare > 0) {
                const take = Math.min(deficit, spare);
                widths[j] -= take;
                widths[i] += take;
                deficit -= take;
            }
        }
    }
    return columns.map((column, index) => widths[index] === column.width ? column : { ...column, width: widths[index] });
}
function wrapPluginItemColumn(column, width) {
    const targetWidth = Math.max(1, width);
    const maxLines = column.wrap ? column.maxLines || 2 : column.maxLines || 1;
    const wrapped = column.wrap ? (0, formatting_helpers_1.wrapText)(column.value, targetWidth) : [column.value];
    const limited = wrapped.slice(0, maxLines);
    if ((wrapped.length > maxLines ||
        (0, width_1.displayCellWidth)(limited[limited.length - 1] || '') > targetWidth) &&
        limited.length > 0) {
        limited[limited.length - 1] = truncateCell(limited[limited.length - 1], targetWidth, column.ellipsis !== false);
    }
    return limited.length > 0 ? limited : [''];
}
function pluginItemRows(item, layout, cols, prefix, locale, trimDecimals, fractionDigits, lang = 'en', capabilities) {
    const columns = pluginLineItemColumns(layout, cols, lang, capabilities);
    const gap = pluginLineGap(layout);
    const preparedColumns = columns.map((column) => {
        const rawValue = (0, formatting_helpers_1.normalizeThermalText)(pluginItemColumnValue(column.key || '', item, prefix, locale, trimDecimals, fractionDigits), capabilities);
        const value = isPluginItemColumn(column)
            ? column.align === 'right'
                ? rawValue.trimStart()
                : rawValue
            : rawValue.trim();
        if (!isPluginItemColumn(column)) {
            (0, formatting_helpers_1.assertFinancialValueFitsColumns)(value, cols, `item ${column.key || 'financial'} column`);
        }
        return {
            ...column,
            value,
        };
    });
    const values = fitPluginRowColumns(preparedColumns, gap);
    const totalSingleLineWidth = values.reduce((sum, column) => sum + Number(column.width), 0) +
        gap * Math.max(0, values.length - 1);
    const wrappedValues = values.map((column, columnIndex) => {
        if (!isPluginItemColumn(column))
            return [column.value];
        const reserveTrailingSpace = gap === 0 && columnIndex < values.length - 1 && values[columnIndex + 1]?.align !== 'right';
        const itemTextWidth = Math.max(1, Number(column.width) - (reserveTrailingSpace ? 1 : 0));
        return wrapPluginItemColumn(column, itemTextWidth);
    });
    const firstLineCells = values.map((column, columnIndex) => alignCell(truncateCell(wrappedValues[columnIndex][0] || '', Number(column.width), isPluginItemColumn(column) ? column.ellipsis !== false : false), Number(column.width), column.align || 'left', isPluginItemColumn(column) ? column.ellipsis !== false : false));
    const hasColumnSeparation = gap >= 1 ||
        firstLineCells.every((cell, idx) => idx === 0 ||
            (wrappedValues[idx - 1][0] || '').length === 0 ||
            (wrappedValues[idx][0] || '').length === 0 ||
            firstLineCells[idx - 1].endsWith(' ') ||
            cell.startsWith(' '));
    const allFinancialColumnsFit = totalSingleLineWidth <= cols &&
        hasColumnSeparation &&
        values.every((column) => isPluginItemColumn(column)
            ? Number(column.width) >= 4
            : (0, width_1.displayCellWidth)(column.value) <= Number(column.width));
    if (allFinancialColumnsFit) {
        const lineCount = Math.max(1, ...wrappedValues.map((value) => value.length));
        const rows = [];
        for (let index = 0; index < lineCount; index++) {
            rows.push(composePluginColumns(values.map((column, columnIndex) => ({
                ...column,
                ellipsis: isPluginItemColumn(column) ? column.ellipsis : false,
                value: wrappedValues[columnIndex][index] || '',
            })), gap, cols));
        }
        return rows;
    }
    const rows = [];
    for (const column of preparedColumns) {
        if (!isPluginItemColumn(column))
            continue;
        for (const line of wrapPluginItemColumn(column, cols)) {
            rows.push((0, width_1.padToDisplayCells)(line, cols, column.align || 'left'));
        }
    }
    const financialValues = preparedColumns
        .filter((column) => !isPluginItemColumn(column) && column.value.length > 0)
        .map((column) => column.value);
    const gapSpace = Math.max(1, gap);
    const separator = ' '.repeat(gapSpace);
    let currentGroup = [];
    let currentWidth = 0;
    for (const val of financialValues) {
        const valWidth = (0, width_1.displayCellWidth)(val);
        const nextWidth = currentGroup.length === 0 ? valWidth : currentWidth + gapSpace + valWidth;
        if (currentGroup.length > 0 && nextWidth > cols) {
            rows.push((0, width_1.padToDisplayCells)(currentGroup.join(separator), cols, 'right'));
            currentGroup = [val];
            currentWidth = valWidth;
        }
        else {
            currentGroup.push(val);
            currentWidth = nextWidth;
        }
    }
    if (currentGroup.length > 0) {
        rows.push((0, width_1.padToDisplayCells)(currentGroup.join(separator), cols, 'right'));
    }
    return rows;
}
function pluginItemLayout(item, layout, cols, prefix, locale, trimDecimals, fractionDigits, lang = 'en', capabilities) {
    const configured = fitPluginRowColumns(pluginLineItemColumns(layout, cols, lang, capabilities).map((column) => ({
        ...column,
        value: (0, formatting_helpers_1.normalizeThermalText)(pluginItemColumnValue(column.key || '', item, prefix, locale, trimDecimals, fractionDigits), capabilities).trim(),
    })), pluginLineGap(layout)).map((column) => ({
        text: column.value,
        align: (column.align === 'right' ? 'right' : 'left'),
        width: Math.max(1, Number(column.width) || 1),
    }));
    if (configured.length < 2)
        return undefined;
    const columns = configured.length <= 4
        ? configured
        : [
            configured[0],
            {
                text: configured
                    .slice(1, -2)
                    .map((column) => column.text)
                    .filter(Boolean)
                    .join(' '),
                align: configured[1].align,
                width: configured.slice(1, -2).reduce((sum, column) => sum + column.width, 0),
            },
            configured[configured.length - 2],
            configured[configured.length - 1],
        ];
    const totalWidth = Math.max(cols, columns.reduce((sum, column) => sum + column.width, 0));
    return {
        kind: 'financial-item',
        columns: columns.map((column) => ({
            text: column.text,
            align: column.align,
            widthRatio: column.width / totalWidth,
        })),
    };
}
function pluginItemColumnValue(key, item, prefix, locale, trimDecimals, fractionDigits) {
    switch (key) {
        case 'item':
            return String(item.product_name || '');
        case 'quantity':
            return String(item.quantity ?? '');
        case 'rate': {
            const quantity = Number(item.quantity) || 0;
            const rate = Number(item.unit_price ?? item.price ?? (quantity ? Number(item.total) / quantity : 0));
            return (0, formatting_helpers_1.formatCurrency)(rate, prefix, locale, trimDecimals, fractionDigits);
        }
        case 'taxRate':
            return pluginItemTaxRate(item);
        case 'amount':
            return (0, formatting_helpers_1.formatCurrency)(item.total, prefix, locale, trimDecimals, fractionDigits);
        default:
            return '';
    }
}
function pluginItemTaxRate(item) {
    const rates = new Set();
    const breakdown = Array.isArray(item.tax_breakdown) ? item.tax_breakdown : [];
    for (const component of breakdown) {
        if (component?.rate !== null && component?.rate !== undefined)
            rates.add(String(component.rate));
    }
    return [...rates].join('+');
}
function pluginSummaryRow(label, amount, layout, cols, _lang = 'en', capabilities) {
    const normalizedLabel = (0, formatting_helpers_1.normalizeThermalText)(label, capabilities);
    const trimmedAmount = String(amount ?? '').trimStart();
    const rateMatch = normalizedLabel.match(/(?:^|\s)(@\S+%)$/);
    if (rateMatch) {
        (0, formatting_helpers_1.assertFinancialValueFitsColumns)(rateMatch[1], cols, 'tax rate');
    }
    (0, formatting_helpers_1.assertFinancialValueFitsColumns)(trimmedAmount, cols, 'tax summary amount');
    const labelWidth = Number(layout?.taxSummary?.labelWidth);
    const amountWidth = Number(layout?.taxSummary?.amountWidth);
    const gap = cols >= 3 ? 1 : 0;
    const labelCells = (0, width_1.displayCellWidth)(normalizedLabel);
    const amountCells = (0, width_1.displayCellWidth)(trimmedAmount);
    if (labelCells + gap + amountCells > cols) {
        return [
            ...(0, formatting_helpers_1.wrapText)(normalizedLabel, cols).map((line) => (0, width_1.padToDisplayCells)(line, cols)),
            (0, width_1.padToDisplayCells)(trimmedAmount, cols, 'right'),
        ];
    }
    if (Number.isInteger(labelWidth) &&
        Number.isInteger(amountWidth) &&
        labelWidth > 0 &&
        amountWidth > 0) {
        const effectiveAmountWidth = Math.min(Math.max(1, cols - gap - Math.max(1, labelCells)), Math.max(amountWidth, amountCells));
        const effectiveLabelWidth = labelWidth + effectiveAmountWidth <= cols && labelWidth >= labelCells
            ? labelWidth
            : Math.max(labelCells, cols - gap - effectiveAmountWidth);
        return [
            composePluginColumns([
                { value: normalizedLabel, width: effectiveLabelWidth, align: 'left', ellipsis: true },
                { value: trimmedAmount, width: effectiveAmountWidth, align: 'right', ellipsis: false },
            ], Math.max(0, cols - effectiveLabelWidth - effectiveAmountWidth), cols),
        ];
    }
    return [normalizedLabel + (0, formatting_helpers_1.rightAlign)(trimmedAmount, cols - labelCells)];
}
function composePluginColumns(columns, gap, cols) {
    const separator = ' '.repeat(gap);
    const line = columns
        .map((column) => alignCell(truncateCell(column.value, Number(column.width), column.ellipsis !== false), Number(column.width), column.align || 'left', column.ellipsis !== false))
        .join(separator);
    return (0, width_1.padToDisplayCells)(truncateCell(line, cols, false), cols);
}
function alignCell(value, width, align, ellipsis = true) {
    return (0, width_1.padToDisplayCells)(truncateCell(value, width, ellipsis), width, align);
}
function truncateCell(text, length, ellipsis) {
    const value = String(text || '');
    if (length <= 0)
        return '';
    if ((0, width_1.displayCellWidth)(value) <= length)
        return value;
    if (!ellipsis || length <= 2)
        return (0, width_1.truncateToDisplayCells)(value, length);
    return (0, width_1.truncateToDisplayCells)(value, length - 2) + '..';
}
const PAYMENT_METHOD_CONCEPTS = {
    cash: 'pos.methodCash',
    card: 'pos.methodCard',
    upi: 'pos.methodUpi',
    wallet: 'pos.methodWallet',
};
/** Ported from web-print.ts (#440): known methods localize; unknown keep the capitalize fallback. */
function resolvePaymentMethodLabel(method, lang) {
    const concept = PAYMENT_METHOD_CONCEPTS[String(method || '').toLowerCase()];
    if (concept)
        return (0, print_labels_generated_1.printLabel)(lang, concept);
    return capitalize(String(method || ''));
}
/** pos.tableLabel carries an ICU {name} placeholder; backend rendering swaps it inline. */
function formatTableLabel(tableName, lang) {
    return (0, print_labels_generated_1.printLabel)(lang, 'pos.tableLabel').replace('{name}', tableName);
}
function capitalize(text) {
    return text.length > 0 ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}
/** Kitchen order ticket: builds KotDocument and renders via document-kot pipeline. */
function formatKOT(order, items, stationName, cols = 48, useUnicode = false, cutMode = 'full', locale = 'en-US', tzOptions, warnings, arabicShaping = false, language, capabilities) {
    const lang = (0, formatting_helpers_1.normalizePrintLanguage)(language);
    const result = (0, document_kot_1.renderKotViaDocument)(order, items, stationName, {
        columns: cols,
        language: lang,
        ...(locale ? { locale } : {}),
        ...(tzOptions?.timeZone ? { timezone: String(tzOptions.timeZone) } : {}),
        useUnicode,
        arabicShaping,
        cutMode,
        capabilities,
    });
    if (warnings && result.warnings.length > 0)
        warnings.push(...result.warnings);
    return result.data;
}
function buildTestPage(paperWidth = '80mm', cutMode = 'full', language, timezone, capabilities) {
    const width = columnsForPaperWidth(paperWidth) || 48;
    const lang = (0, formatting_helpers_1.normalizePrintLanguage)(language);
    const label = (concept) => (0, formatting_helpers_1.normalizeThermalText)((0, print_labels_generated_1.printLabel)(lang, concept));
    const bar = '='.repeat(width);
    const ruler = Array.from({ length: width }, (_, i) => String((i + 1) % 10)).join('');
    const edgeProbe = 'X'.repeat(width);
    const lines = [
        '{INIT}',
        '{CENTER}{BOLD}' + label('print.test.title') + '{/BOLD}{/CENTER}',
        '',
        bar,
        '{CENTER}' + label('print.test.networkUsb') + '{/CENTER}',
        bar,
        '',
        `${label('print.test.columns')}: ${width}`,
        ...(0, formatting_helpers_1.wrapText)(label('print.test.wrapHint'), width),
        ruler,
        edgeProbe,
        bar,
        `${label('print.time')}: ${new Date().toLocaleString('en-US-u-nu-latn', timezone ? { timeZone: timezone } : undefined)}`,
        '',
        bar,
        '{CENTER}' + label('print.test.success') + '{/CENTER}',
        bar,
        '{CUT}',
    ];
    if (!capabilities || !(0, raster_1.rasterCapabilityEnabled)(capabilities))
        return (0, formatting_helpers_1.buildEscPos)(lines, false, { cutMode, language: lang, columns: width });
    // Explicit shaping capability prevents raster profile passing unshaped Arabic to text.
    const textData = (0, formatting_helpers_1.buildEscPos)(lines.slice(0, -1), false, {
        cutMode,
        language: lang,
        capabilities,
        arabicShaping: capabilities.shaping.arabic,
        columns: width,
    });
    const rasterData = (0, raster_1.encodeRasterUnits)([
        {
            unitId: 'diagnostic-test-page',
            financial: false,
            complete: true,
            bands: (0, raster_1.buildRasterDiagnosticBands)(capabilities.raster.widthDots, capabilities.raster.maxBandHeight),
        },
    ], capabilities);
    return Buffer.concat([
        textData,
        Buffer.from(rasterData),
        Buffer.from((0, raster_1.encodeRasterFeedAndCut)(cutMode)),
    ]);
}
/**
 * Build the ESC/POS bytes for a Z-report (cierre de caja) from a stored
 * `cash_closures` row. Day-close, no bill — sections in spec print order:
 * header → Z number + business date + period → opening float → cash
 * movements → sales by payment method → refunds → tax breakdown → staff
 * sales → expected / counted / variance (variance emphasized) → operator +
 * signature → footer.
 * The byte builder never touches the drawer pulse; that is appended by
 * `printZReport` (the route layer) so the byte form is reusable for the
 * WebUSB `bytes: number[]` branch where the renderer dispatches.
 */
function buildZReportBody(z, language, printer, warnings) {
    const cols = printer?.columns || columnsForPaperWidth('80mm') || 48;
    const lang = (0, formatting_helpers_1.normalizePrintLanguage)(language ?? z?.__language);
    const additionalLanguage = z?.__additionalLanguage
        ? (0, formatting_helpers_1.normalizePrintLanguage)(z.__additionalLanguage)
        : undefined;
    const settingsRows = (0, db_1.getDatabase)().prepare('SELECT key, value FROM settings').all();
    const settings = Object.fromEntries(settingsRows.map((r) => [r.key, r.value]));
    // Single resolution for currency/locale/timezone — resolves the stored
    // timezone through the country profile when missing or invalid, instead of
    // leaving it undefined (which would use the server's own host timezone,
    // not the tenant's, for the printed period timestamps).
    const snapshot = (0, countries_1.resolveRegionalSnapshot)(settings);
    const currency = snapshot.currency;
    const fractionDigits = (0, countries_1.getCurrencyFractionDigits)(currency);
    const factor = 10 ** fractionDigits;
    const locale = snapshot.locale;
    const tz = snapshot.timezone;
    const prefix = (0, formatting_helpers_1.resolveCurrencyPrefix)((0, countries_1.getCurrencySymbol)(currency, locale), false);
    const trimDecimals = false;
    const centsToAmount = (cents) => (Number(cents) || 0) / factor;
    const formatAmount = (cents) => (0, formatting_helpers_1.formatCurrency)(centsToAmount(cents), prefix, locale, trimDecimals, fractionDigits);
    const localTime = (iso) => {
        try {
            const d = (0, db_1.parseDbTimestamp)(iso);
            if (isNaN(d.getTime()))
                return iso;
            return d.toLocaleString('en-US-u-nu-latn', { timeZone: tz });
        }
        catch {
            return iso;
        }
    };
    const languages = additionalLanguage && additionalLanguage !== lang
        ? [lang, additionalLanguage]
        : [lang];
    const documentData = {
        zNumber: z?.z_number ?? 0,
        businessDate: String(z?.business_date || ''),
        periodStart: localTime(z?.period_start),
        periodEnd: localTime(z?.period_end),
        openingFloatCents: Number(z?.opening_float_cents) || 0,
        payInCents: Number(z?.pay_in_cents) || 0,
        payOutCents: Number(z?.pay_out_cents) || 0,
        safeDropCents: Number(z?.safe_drop_cents) || 0,
        paymentMethods: (Array.isArray(z?.payment_methods) ? z.payment_methods : []).map((row) => ({
            method: String(row?.method || ''),
            count: Number(row?.count) || 0,
            totalCents: Number(row?.total_cents ?? row?.total) || 0,
        })),
        refundCount: Number(z?.refund_count) || 0,
        refundedCents: Number(z?.refunded_cents) || 0,
        taxComponents: (Array.isArray(z?.tax_components) ? z.tax_components : []).map((row) => ({
            title: String(row?.title || row?.label || ''),
            amount: Number(row?.amount) || 0,
        })),
        staffSales: (Array.isArray(z?.staff_sales) ? z.staff_sales : []).map((row) => ({
            name: String(row?.name || row?.user_id || ''),
            orderCount: Number(row?.orderCount ?? row?.orders) || 0,
            revenueCents: Number(row?.revenue_cents ?? row?.revenue) || 0,
        })),
        expectedCashCents: Number(z?.expected_cash_cents) || 0,
        countedCashCents: Number(z?.counted_cash_cents) || 0,
        varianceCents: Number(z?.variance_cents) || 0,
        closedByName: String(z?.closed_by_name || z?.closed_by || ''),
        businessName: String(settings.business_name || ''),
        businessAddress: String(settings.business_address || ''),
        taxRegistrationNumber: String(settings.tax_registration_number || ''),
        isReprint: !!z?.__isReprint,
    };
    const zDocument = (0, print_1.buildZReportDocument)(documentData, {
        languages,
        baseDirection: (0, print_1.containsRtlScript)((0, print_labels_generated_1.printLabel)(lang, 'print.zReport.title')) ? 'rtl' : 'ltr',
        resolveLabel: (conceptId, languageCode) => (0, print_labels_generated_1.printLabel)(languageCode, conceptId),
    });
    const zContext = zLayoutContext(cols, zDocument, printer?.capabilities);
    const bar = '='.repeat(cols);
    const dash = '-'.repeat(cols);
    const sections = [];
    sections.push('{INIT}');
    if (zDocument.header.businessName)
        (0, formatting_helpers_1.pushCenteredWrapped)(sections, zDocument.header.businessName.text, cols, lang, printer?.capabilities);
    if (zDocument.header.businessAddress)
        (0, formatting_helpers_1.pushCenteredWrapped)(sections, zDocument.header.businessAddress.text, cols, lang, printer?.capabilities);
    if (zDocument.header.taxRegistrationNumber)
        (0, formatting_helpers_1.pushCenteredWrapped)(sections, zDocument.header.taxRegistrationNumber.text, cols, lang, printer?.capabilities);
    sections.push('');
    const titleLabel = {
        primary: `${zDocument.header.title.primary} #${zDocument.header.zNumber.text}${zDocument.header.reprintMarker ? ` (${zDocument.header.reprintMarker.primary})` : ''}`,
        ...(zDocument.header.title.secondary
            ? {
                secondary: `${zDocument.header.title.secondary} #${zDocument.header.zNumber.text}${zDocument.header.reprintMarker?.secondary ? ` (${zDocument.header.reprintMarker.secondary})` : ''}`,
            }
            : {}),
    };
    for (const line of (0, print_1.layoutStyledUnit)({ label: titleLabel, field: 'Z report title' }, zContext)
        .lines) {
        sections.push('{CENTER}{BOLD}' + (0, formatting_helpers_1.normalizeThermalText)(line, printer?.capabilities) + '{/BOLD}{/CENTER}');
    }
    sections.push('');
    sections.push(bar);
    for (const row of zDocument.period)
        pushZReportLabelValue(sections, row.label, row.value.text, zContext);
    sections.push(bar);
    sections.push('');
    pushZReportHeading(sections, zDocument.openingFloat.label, zContext, true);
    sections.push('{FINANCIAL}' + (0, formatting_helpers_1.rightAlign)(formatAmount(zDocument.openingFloat.cents), cols));
    sections.push('');
    pushZReportSectionHeading(sections, zDocument.cashMovements.heading, zContext);
    pushZReportLabelValue(sections, zDocument.cashMovements.payIn.label, formatAmount(zDocument.cashMovements.payIn.cents), zContext);
    pushZReportLabelValue(sections, zDocument.cashMovements.payOut.label, formatAmount(zDocument.cashMovements.payOut.cents), zContext);
    pushZReportLabelValue(sections, zDocument.cashMovements.safeDrop.label, formatAmount(zDocument.cashMovements.safeDrop.cents), zContext);
    sections.push('');
    pushZReportSectionHeading(sections, zDocument.payments.heading, zContext);
    if (zDocument.payments.rows.length === 0)
        pushZReportEmpty(sections, zDocument.payments.none, zContext);
    for (const row of zDocument.payments.rows) {
        pushZReportRow(sections, {
            primary: `${row.label.primary} ${row.countLabel.primary.replace('{count}', String(row.count))}`,
            ...(row.label.secondary && row.countLabel.secondary
                ? {
                    secondary: `${row.label.secondary} ${row.countLabel.secondary.replace('{count}', String(row.count))}`,
                }
                : {}),
        }, formatAmount(row.totalCents), zContext);
    }
    sections.push('');
    pushZReportSectionHeading(sections, zDocument.refunds.heading, zContext);
    pushZReportLabelValue(sections, zDocument.refunds.countLabel, String(zDocument.refunds.count), zContext);
    pushZReportLabelValue(sections, zDocument.refunds.totalLabel, formatAmount(zDocument.refunds.totalCents), zContext, true);
    sections.push('');
    pushZReportSectionHeading(sections, zDocument.tax.heading, zContext);
    if (zDocument.tax.rows.length === 0)
        pushZReportEmpty(sections, zDocument.tax.none, zContext);
    for (const row of zDocument.tax.rows)
        pushZReportRow(sections, row.label, (0, formatting_helpers_1.formatCurrency)(row.amount, prefix, locale, trimDecimals, fractionDigits), zContext);
    sections.push('');
    pushZReportSectionHeading(sections, zDocument.staff.heading, zContext);
    if (zDocument.staff.rows.length === 0)
        pushZReportEmpty(sections, zDocument.staff.none, zContext);
    for (const row of zDocument.staff.rows) {
        pushZReportRow(sections, {
            primary: `${row.label.primary} ${row.countLabel.primary.replace('{count}', String(row.count))}`,
            ...(row.label.secondary && row.countLabel.secondary
                ? {
                    secondary: `${row.label.secondary} ${row.countLabel.secondary.replace('{count}', String(row.count))}`,
                }
                : {}),
        }, formatAmount(row.totalCents), zContext);
    }
    sections.push('');
    sections.push(bar);
    pushZReportHeading(sections, zDocument.cash.expected.label, zContext, true);
    sections.push('{FINANCIAL}' + (0, formatting_helpers_1.rightAlign)(formatAmount(zDocument.cash.expected.cents), cols));
    pushZReportHeading(sections, zDocument.cash.counted.label, zContext, true);
    sections.push('{FINANCIAL}' + (0, formatting_helpers_1.rightAlign)(formatAmount(zDocument.cash.counted.cents), cols));
    sections.push(bar);
    const varianceLabel = {
        primary: `${zDocument.cash.variance.label.primary}  ${formatAmount(zDocument.cash.variance.cents)}`,
        ...(zDocument.cash.variance.label.secondary
            ? {
                secondary: `${zDocument.cash.variance.label.secondary}  ${formatAmount(zDocument.cash.variance.cents)}`,
            }
            : {}),
    };
    for (const line of zLaidOutLabel(varianceLabel, zContext)) {
        sections.push('{CENTER}{FINANCIAL}{BOLD}' +
            (0, formatting_helpers_1.normalizeThermalText)(line, printer?.capabilities) +
            '{/BOLD}{/CENTER}');
    }
    sections.push(dash);
    sections.push('');
    if (zDocument.operator.name)
        pushZReportTextValue(sections, zDocument.operator.label, zDocument.operator.name.text, zContext);
    const signatureLines = zLaidOutLabel(zDocument.operator.signatureLabel, zContext);
    const inlineSignature = signatureLines.length === 1
        ? (0, formatting_helpers_1.normalizeThermalText)(signatureLines[0], printer?.capabilities)
        : null;
    const remainingSigCols = inlineSignature === null ? 0 : cols - (0, print_1.thermalDisplayWidth)(inlineSignature) - 1;
    if (inlineSignature !== null && remainingSigCols >= 8) {
        sections.push(inlineSignature + ' ' + '_'.repeat(remainingSigCols));
    }
    else {
        for (const line of signatureLines)
            sections.push((0, formatting_helpers_1.normalizeThermalText)(line, printer?.capabilities));
        sections.push('_'.repeat(cols));
    }
    sections.push('');
    for (const line of (0, print_1.bilingualLabelLines)(zDocument.footer, (0, print_1.selectBilingualFit)(zDocument.footer, cols))) {
        sections.push('{CENTER}' + (0, formatting_helpers_1.normalizeThermalText)(line, printer?.capabilities) + '{/CENTER}');
    }
    sections.push('{CENTER}Z#' +
        zDocument.header.zNumber.text +
        ' - ' +
        (0, formatting_helpers_1.normalizeThermalText)(documentData.businessDate, printer?.capabilities) +
        '{/CENTER}');
    sections.push('{CUT}');
    return (0, formatting_helpers_1.buildEscPos)(sections, false, { cutMode: 'full', language: lang, columns: cols, capabilities: printer?.capabilities }, warnings);
}
function zLayoutContext(columns, document, capabilities) {
    return {
        logicalColumns: columns,
        direction: document.direction.base,
        languages: document.languages,
        capabilities,
    };
}
function zLabelVariants(label, columns) {
    return [...(0, print_1.bilingualLabelLines)(label, (0, print_1.selectBilingualFit)(label, columns))];
}
function zLaidOutLabel(label, context) {
    return [...(0, print_1.layoutStyledUnit)({ label, field: 'Z report label' }, context).lines];
}
function pushZReportHeading(lines, label, context, financial = false) {
    const layout = (0, print_1.layoutStyledUnit)({ label, field: 'Z report section' }, context);
    for (const line of layout.lines)
        lines.push((financial ? '{FINANCIAL}' : '') +
            '{BOLD}' +
            (0, formatting_helpers_1.normalizeThermalText)(line, context.capabilities) +
            '{/BOLD}');
}
function pushZReportSectionHeading(lines, label, context) {
    pushZReportHeading(lines, label, context);
}
function pushZReportEmpty(lines, label, context) {
    const indentedContext = { ...context, logicalColumns: Math.max(1, context.logicalColumns - 2) };
    for (const line of zLaidOutLabel(label, indentedContext)) {
        lines.push('  ' + (0, formatting_helpers_1.normalizeThermalText)(line, context.capabilities));
    }
}
function pushZReportLabelValue(lines, label, value, context, financial = false) {
    const columns = context.logicalColumns;
    const normalizedValue = (0, formatting_helpers_1.normalizeThermalText)(value, context.capabilities);
    const labelLines = zLaidOutLabel(label, context);
    if (labelLines.length === 1 &&
        (0, print_1.thermalDisplayWidth)(labelLines[0]) + 1 + (0, print_1.thermalDisplayWidth)(normalizedValue) <= columns) {
        lines.push((financial ? '{FINANCIAL}' : '') +
            (0, formatting_helpers_1.normalizeThermalText)(labelLines[0], context.capabilities) +
            (0, formatting_helpers_1.rightAlign)(normalizedValue, columns - (0, print_1.thermalDisplayWidth)(labelLines[0])));
        return;
    }
    for (const line of labelLines)
        lines.push((financial ? '{FINANCIAL}' : '') + (0, formatting_helpers_1.normalizeThermalText)(line, context.capabilities));
    for (const line of (0, formatting_helpers_1.wrapText)(normalizedValue, columns))
        lines.push((financial ? '{FINANCIAL}' : '') + (0, formatting_helpers_1.rightAlign)(line, columns));
}
function pushZReportTextValue(lines, label, value, context) {
    const labelWithValue = {
        primary: `${label.primary} ${value}`,
        ...(label.secondary ? { secondary: `${label.secondary} ${value}` } : {}),
    };
    for (const line of zLaidOutLabel(labelWithValue, context)) {
        lines.push((0, formatting_helpers_1.normalizeThermalText)(line, context.capabilities));
    }
}
function pushZReportRow(lines, label, value, context) {
    const prefix = '  ';
    const columns = context.logicalColumns;
    const normalizedValue = (0, formatting_helpers_1.normalizeThermalText)(value, context.capabilities);
    const labelContext = { ...context, logicalColumns: Math.max(1, columns - prefix.length) };
    const labelLines = zLaidOutLabel(label, labelContext);
    if (labelLines.length === 1 &&
        prefix.length + (0, print_1.thermalDisplayWidth)(labelLines[0]) + 1 + (0, print_1.thermalDisplayWidth)(normalizedValue) <=
            columns) {
        lines.push('{FINANCIAL}' +
            prefix +
            labelLines[0] +
            (0, formatting_helpers_1.rightAlign)(normalizedValue, columns - prefix.length - (0, print_1.thermalDisplayWidth)(labelLines[0])));
        return;
    }
    for (const line of labelLines)
        lines.push('{FINANCIAL}' + prefix + (0, formatting_helpers_1.normalizeThermalText)(line, context.capabilities));
    for (const line of (0, formatting_helpers_1.wrapText)(normalizedValue, columns))
        lines.push('{FINANCIAL}' + (0, formatting_helpers_1.rightAlign)(line, columns));
}
/**
 * Dispatch the Z report to the configured printer. The pulse is forced on Z
 * print (bypassing bill-bound `shouldPulseForPayment` and the
 * `cash_drawer_pulse_methods` filter): the Z is the document the merchant
 * prints while counting the drawer.
 */
async function printZReport(z, signal, targetPrinter) {
    try {
        if (signal?.aborted)
            return { ok: false, detail: 'Print cancelled during shutdown' };
        // The route resolves the default receipt printer so it can pick the
        // WebUSB branch server-side (`main/routes/printers.ts:329-331`). The
        // helper's own fallback uses getPrinterConfig() (which excludes webusb,
        // so default lookups never see a WebUSB printer).
        const printer = targetPrinter || getPrinterConfig();
        if (!printer)
            return { ok: false, detail: 'No printer configured' };
        // F3: resolve the printer's profile so `buildZReportBody` can use the
        // right columns and capabilities (58mm/36/42 cols, profile-specific
        // code pages, etc.). Same pattern as `prepareReceipt` (`:1043-1056`).
        const { profile, columns, capabilities } = resolvePrinterContext(printer, false);
        const zWithMarker = { ...z, __isReprint: !!z?.__isReprint };
        // The route carries the resolved Z-report language policy in the snapshot;
        // direct callers retain the English store-language default.
        const warnings = [];
        const baseBody = buildZReportBody(zWithMarker, undefined, { columns, capabilities }, warnings);
        if ((0, warnings_1.hasFinancialPrintWarning)(warnings)) {
            return { ok: false, detail: (0, warnings_1.makeFinancialPrintRefusalMessage)(warnings), warnings };
        }
        const data = (0, formatting_helpers_1.appendCashDrawerPulse)(baseBody);
        let result;
        switch (printer.connection_type) {
            case 'network':
                result = await printViaNetwork(printer.ip_address, printer.port || 9100, data, signal);
                break;
            case 'usb':
                result = await printViaUSB(data, printer.name, signal);
                break;
            case 'webusb':
                // Backend never dispatches WebUSB; return the FULL bytes (including
                // the appended drawer pulse) for the renderer. The route maps this to
                // `bytes: number[]` per the test-page endpoint contract.
                return {
                    ok: true,
                    bytes: data,
                    connection_type: 'webusb',
                    ...(warnings.length > 0 ? { warnings } : {}),
                };
            default:
                result = { ok: false, detail: `Unsupported connection type: ${printer.connection_type}` };
        }
        return {
            ...result,
            bytes: data,
            connection_type: printer.connection_type,
            ...(warnings.length > 0 ? { warnings } : {}),
        };
    }
    catch (error) {
        console.error('[Printer] Z-report dispatch failed:', error);
        return { ok: false, detail: error?.message };
    }
}
/** Convert the command subset emitted by buildEscPos() into a paperless text preview. */
function escPosToText(data) {
    const bytes = Buffer.from(data);
    const text = [];
    const lineBytes = [];
    let activeCodePage = 'utf8';
    const flushLine = () => {
        if (lineBytes.length === 0)
            return;
        text.push(decodeThermalPreviewBytes(lineBytes, activeCodePage));
        lineBytes.length = 0;
    };
    for (let i = 0; i < bytes.length;) {
        const byte = bytes[i];
        if (byte === 0x1b) {
            const command = bytes[i + 1];
            if (command === 0x40) {
                flushLine();
                activeCodePage = 'utf8';
                i += 2;
            }
            else if (command === 0x74) {
                flushLine();
                activeCodePage = THERMAL_CODE_PAGE_BY_ID[bytes[i + 2]] ?? 'utf8';
                i += 3;
            }
            else if (command === 0x21 || command === 0x45 || command === 0x61) {
                i += 3;
            }
            else if (command === 0x64) {
                flushLine();
                const feedLines = bytes[i + 2] || 0;
                for (let line = 0; line < feedLines; line++)
                    text.push('\n');
                i += 3;
            }
            else {
                i += Math.min(2, bytes.length - i);
            }
            continue;
        }
        if (byte === 0x1d && bytes[i + 1] === 0x56) {
            flushLine();
            const mode = bytes[i + 2];
            i += mode === 0x41 || mode === 0x42 ? 4 : 3;
            continue;
        }
        if (byte === 0x1d && bytes[i + 1] === 0x76 && bytes[i + 2] === 0x30) {
            flushLine();
            const widthBytes = bytes[i + 4] | (bytes[i + 5] << 8);
            const heightDots = bytes[i + 6] | (bytes[i + 7] << 8);
            i += 8 + widthBytes * heightDots;
            continue;
        }
        if (byte === 0x0a) {
            flushLine();
            text.push('\n');
            i += 1;
            continue;
        }
        if (byte === 0x0d) {
            i += 1;
            continue;
        }
        lineBytes.push(byte);
        i += 1;
    }
    flushLine();
    return text.join('').replace(/\n+$/, '');
}
const THERMAL_CODE_PAGE_HIGH_HALVES = {
    cp437: 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ',
    cp850: 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´­±‗¾¶§÷¸°¨·¹³²■ ',
    cp858: 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈ€ÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´­±‗¾¶§÷¸°¨·¹³²■ ',
    windows1252: '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜š›œžŸÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿ',
};
const THERMAL_CODE_PAGE_BY_ID = {
    0: 'cp437',
    2: 'cp850',
    16: 'windows1252',
    19: 'cp858',
};
function decodeThermalPreviewBytes(bytes, codePage) {
    if (codePage === 'utf8')
        return Buffer.from(bytes).toString('utf8');
    if (codePage === 'ascii')
        return bytes.map((byte) => String.fromCharCode(byte)).join('');
    const highHalf = THERMAL_CODE_PAGE_HIGH_HALVES[codePage];
    return bytes
        .map((byte) => (byte < 0x80 ? String.fromCharCode(byte) : (highHalf[byte - 0x80] ?? '\uFFFD')))
        .join('');
}
exports.NETWORK_PRINT_CHUNK_SIZE = 4096;
exports.NETWORK_PRINT_CHUNK_DELAY_MS = 10;
async function printViaNetwork(ip, port, data, signal) {
    return new Promise((resolve) => {
        const client = new net.Socket();
        let settled = false;
        let connected = false;
        let timer = null;
        const onAbort = () => {
            if (timer)
                clearTimeout(timer);
            client.destroy();
            finish({ ok: false, detail: 'Print cancelled during shutdown' });
        };
        const finish = (result) => {
            if (settled)
                return;
            settled = true;
            if (timer)
                clearTimeout(timer);
            signal?.removeEventListener('abort', onAbort);
            resolve(result);
        };
        client.connect(port, ip, () => {
            connected = true;
            // For small payloads (typical text receipts <4KB), write directly in a single pass.
            if (data.length <= exports.NETWORK_PRINT_CHUNK_SIZE) {
                client.write(data, () => {
                    client.end();
                    finish({ ok: true });
                });
                return;
            }
            // For large payloads (e.g. raster graphics, multi-language bitmaps), chunk to avoid overrunning
            // small microcontroller receive buffers on budget thermal printers.
            let offset = 0;
            const sendNextChunk = () => {
                if (settled)
                    return;
                if (offset >= data.length) {
                    client.end();
                    finish({ ok: true });
                    return;
                }
                const chunk = data.subarray(offset, offset + exports.NETWORK_PRINT_CHUNK_SIZE);
                offset += chunk.length;
                const scheduleNext = () => {
                    if (settled)
                        return;
                    if (offset < data.length) {
                        timer = setTimeout(sendNextChunk, exports.NETWORK_PRINT_CHUNK_DELAY_MS);
                    }
                    else {
                        client.end();
                        finish({ ok: true });
                    }
                };
                const canContinue = client.write(chunk, () => {
                    if (canContinue) {
                        scheduleNext();
                    }
                });
                if (!canContinue) {
                    client.once('drain', scheduleNext);
                }
            };
            sendNextChunk();
        });
        client.on('error', (err) => {
            console.error(`[Printer] Network error: ${err.message}`);
            client.destroy();
            finish({ ok: false, detail: `Network error: ${err.message}` });
        });
        client.setTimeout(5000, () => {
            client.destroy();
            finish({
                ok: false,
                detail: connected
                    ? `Timed out writing to ${ip}:${port}`
                    : `Timed out connecting to ${ip}:${port}`,
            });
        });
        signal?.addEventListener('abort', onAbort, { once: true });
        if (signal?.aborted)
            onAbort();
    });
}
async function printViaUSB(data, printerName, signal) {
    console.log('[Printer] printViaUSB called, platform:', process.platform, 'printer:', printerName);
    if (process.platform === 'darwin' && isMasRuntime()) {
        return await printViaLocalIpp(data, printerName, signal);
    }
    if (process.platform === 'darwin' || process.platform === 'linux') {
        return await printViaCups(data, printerName, signal);
    }
    if (process.platform === 'win32') {
        return await printViaUSBWindows(data, printerName, signal);
    }
    console.warn('[Printer] Unsupported platform:', process.platform);
    const detail = `Unsupported platform: ${process.platform}`;
    return { ok: false, detail, failureClass: classifyPrintFailure(detail) };
}
// MAS-build counterpart to printViaCups: submits raw bytes to CUPS via local IPP.
async function printViaLocalIpp(data, printerName, signal) {
    if (!printerName) {
        const detail = 'No printer configured';
        return { ok: false, detail, failureClass: classifyPrintFailure(detail) };
    }
    try {
        const attrs = await (0, ipp_client_1.ippGetPrinterAttributes)(printerName, signal);
        if (!attrs.exists && attrs.detail) {
            return {
                ok: false,
                detail: attrs.detail,
                failureClass: classifyPrintFailure(attrs.detail),
            };
        }
        if (attrs.state === 5) {
            const detail = 'print queue is disabled';
            return { ok: false, detail, failureClass: classifyPrintFailure(detail) };
        }
        if (attrs.isAcceptingJobs === false) {
            const detail = 'print queue is not accepting jobs';
            return { ok: false, detail, failureClass: classifyPrintFailure(detail) };
        }
    }
    catch (err) {
        if (signal?.aborted) {
            const detail = 'Print cancelled during shutdown';
            return { ok: false, detail, failureClass: classifyPrintFailure(detail) };
        }
        // Mirrors describeCupsQueueProblem: unreachable queue check does not block print.
        console.log(`[Printer] IPP pre-flight check failed for "${printerName}":`, err);
    }
    try {
        const result = await (0, ipp_client_1.ippPrintRaw)(printerName, data, signal);
        if (!result.ok) {
            const detail = result.detail || `IPP print failed for "${printerName}"`;
            console.error(`[Printer] IPP print failed for "${printerName}": ${detail}`);
            return { ok: false, detail, failureClass: classifyPrintFailure(detail) };
        }
        console.log(`[Printer] IPP print queued for "${printerName}" (job ${result.jobId ?? 'unknown'})`);
        return { ok: true, jobId: result.jobId };
    }
    catch (err) {
        const message = err instanceof Error ? err.message : err;
        const detail = String(message || '').trim() || `IPP print failed for "${printerName}"`;
        console.error(`[Printer] IPP print failed for "${printerName}": ${detail}`);
        return { ok: false, detail, failureClass: classifyPrintFailure(detail) };
    }
}
// Pre-flight check whether CUPS queue is disabled; returns problem description or null.
async function describeCupsQueueProblem(printerName, signal) {
    if (!printerName)
        return null;
    // LC_ALL=C — the state words below are matched in English, and lpstat is localised.
    const opts = {
        encoding: 'utf8',
        timeout: 5000,
        signal,
        env: { ...process.env, LC_ALL: 'C' },
    };
    try {
        const { stdout } = await execFileAsync('lpstat', ['-p', printerName], opts);
        if (/\bdisabled\b/i.test(stdout)) {
            const since = stdout.match(/disabled since [^\n]*/i);
            return since ? since[0].trim().replace(/\s+-\s*$/, '') : 'print queue is disabled';
        }
    }
    catch {
        return null;
    }
    try {
        const { stdout } = await execFileAsync('lpstat', ['-a', printerName], opts);
        if (/not accepting/i.test(stdout))
            return 'print queue is not accepting jobs';
    }
    catch {
        return null;
    }
    return null;
}
async function printViaCups(data, printerName, signal) {
    const label = printerName || 'default';
    const problem = await describeCupsQueueProblem(printerName, signal);
    if (signal?.aborted)
        return { ok: false, detail: 'Print cancelled during shutdown' };
    if (problem) {
        console.error(`[Printer] CUPS print aborted for "${label}": ${problem}`);
        return { ok: false, detail: problem };
    }
    const tmpFile = path.join(os.tmpdir(), `flo_print_${process.pid}_${Date.now()}.bin`);
    try {
        fs.writeFileSync(tmpFile, data);
        const args = printerName ? ['-d', printerName, '-o', 'raw', tmpFile] : ['-o', 'raw', tmpFile];
        const { stdout } = await execFileAsync('lp', args, {
            encoding: 'utf8',
            timeout: 20000,
            signal,
        });
        console.log(`[Printer] CUPS print queued for "${label}" (${stdout.trim()})`);
        return { ok: true };
    }
    catch (err) {
        const detail = String(err.stderr || err.message || '').trim();
        console.error(`[Printer] CUPS print failed for "${label}": ${detail}`);
        return { ok: false, detail: detail || `CUPS print failed for "${label}"` };
    }
    finally {
        try {
            fs.unlinkSync(tmpFile);
        }
        catch { }
    }
}
// Write raw ESC/POS directly to Windows spooler via runtime-compiled C# (Add-Type).
// NOTE: no backslash escapes, backticks, or template expressions allowed in source.
const WINSPOOL_HELPER_SOURCE = `
using System;
using System.Runtime.InteropServices;

public static class FloRawPrinter {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private class DOCINFO {
        [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PRINTER_INFO_2 {
        public IntPtr pServerName;
        public IntPtr pPrinterName;
        public IntPtr pShareName;
        public IntPtr pPortName;
        public IntPtr pDriverName;
        public IntPtr pComment;
        public IntPtr pLocation;
        public IntPtr pDevMode;
        public IntPtr pSepFile;
        public IntPtr pPrintProcessor;
        public IntPtr pDatatype;
        public IntPtr pParameters;
        public IntPtr pSecurityDescriptor;
        public uint Attributes;
        public uint Priority;
        public uint DefaultPriority;
        public uint StartTime;
        public uint UntilTime;
        public uint Status;
        public uint cJobs;
        public uint AveragePPM;
    }

    [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode, ExactSpelling = true)]
    private static extern bool OpenPrinter(string pPrinterName, out IntPtr phPrinter, IntPtr pDefault);

    [DllImport("winspool.drv", EntryPoint = "ClosePrinter", SetLastError = true, ExactSpelling = true)]
    private static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", EntryPoint = "GetPrinterW", SetLastError = true, CharSet = CharSet.Unicode, ExactSpelling = true)]
    private static extern bool GetPrinter(IntPtr hPrinter, int Level, IntPtr pPrinter, uint cbBuf, out uint pcbNeeded);

    [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode, ExactSpelling = true)]
    private static extern uint StartDocPrinter(IntPtr hPrinter, int Level, [In] DOCINFO pDocInfo);

    [DllImport("winspool.drv", EntryPoint = "EndDocPrinter", SetLastError = true, ExactSpelling = true)]
    private static extern bool EndDocPrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", EntryPoint = "StartPagePrinter", SetLastError = true, ExactSpelling = true)]
    private static extern bool StartPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", EntryPoint = "EndPagePrinter", SetLastError = true, ExactSpelling = true)]
    private static extern bool EndPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", EntryPoint = "WritePrinter", SetLastError = true, ExactSpelling = true)]
    private static extern bool WritePrinter(IntPtr hPrinter, byte[] pBytes, int dwCount, out int dwWritten);

    private const uint PRINTER_ATTRIBUTE_WORK_OFFLINE = 0x00000400;

    private static string DescribeBlockingState(uint status, uint attributes) {
        if ((attributes & PRINTER_ATTRIBUTE_WORK_OFFLINE) != 0) return "printer is set to 'Use Printer Offline' in Windows";
        if ((status & 0x00000080) != 0) return "printer is offline";
        if ((status & 0x00001000) != 0) return "printer is not available";
        if ((status & 0x00000010) != 0) return "printer is out of paper";
        if ((status & 0x00000008) != 0) return "printer has a paper jam";
        if ((status & 0x00400000) != 0) return "printer cover is open";
        if ((status & 0x00100000) != 0) return "printer needs attention";
        if ((status & 0x00000002) != 0) return "printer reported an error";
        return null;
    }

    // OpenPrinter succeeds against the queue even when the device is unplugged,
    // so without this the job would silently spool and we would report success.
    private static void EnsureReady(IntPtr hPrinter) {
        uint needed = 0;
        GetPrinter(hPrinter, 2, IntPtr.Zero, 0, out needed);
        if (needed == 0) return;

        IntPtr buf = Marshal.AllocHGlobal((int)needed);
        try {
            uint unused = 0;
            if (!GetPrinter(hPrinter, 2, buf, needed, out unused)) return;
            PRINTER_INFO_2 info = (PRINTER_INFO_2)Marshal.PtrToStructure(buf, typeof(PRINTER_INFO_2));
            string problem = DescribeBlockingState(info.Status, info.Attributes);
            if (problem != null) throw new Exception(problem);
        } finally {
            Marshal.FreeHGlobal(buf);
        }
    }

    public static uint SendRaw(string printerName, byte[] bytes) {
        IntPtr hPrinter = IntPtr.Zero;
        if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero))
            throw new Exception("cannot open printer '" + printerName + "' (Win32 error " + Marshal.GetLastWin32Error() + ")");

        try {
            EnsureReady(hPrinter);

            DOCINFO docInfo = new DOCINFO();
            docInfo.pDocName = "FloCafe Receipt";
            docInfo.pDataType = "RAW";

            uint jobId = StartDocPrinter(hPrinter, 1, docInfo);
            if (jobId == 0)
                throw new Exception("StartDocPrinter failed (Win32 error " + Marshal.GetLastWin32Error() + ")");

            try {
                if (!StartPagePrinter(hPrinter))
                    throw new Exception("StartPagePrinter failed (Win32 error " + Marshal.GetLastWin32Error() + ")");

                int written = 0;
                if (!WritePrinter(hPrinter, bytes, bytes.Length, out written))
                    throw new Exception("WritePrinter failed (Win32 error " + Marshal.GetLastWin32Error() + ")");
                if (written != bytes.Length)
                    throw new Exception("WritePrinter accepted " + written + " of " + bytes.Length + " bytes");

                EndPagePrinter(hPrinter);
            } finally {
                EndDocPrinter(hPrinter);
            }

            return jobId;
        } finally {
            ClosePrinter(hPrinter);
        }
    }
}
`;
// Executed as -EncodedCommand to bypass ExecutionPolicy restrictions on script files.
// Arguments passed via environment variables to avoid script parsing issues.
const WINSPOOL_HELPER_SCRIPT = `
$ErrorActionPreference = 'Stop'
try {
  $name = $env:FLO_PRINTER_NAME
  $file = $env:FLO_PRINT_FILE
  if ([string]::IsNullOrEmpty($name)) { throw 'no printer name supplied' }
  if ([string]::IsNullOrEmpty($file)) { throw 'no payload file supplied' }

  # Best-effort metadata for Tier-2 diagnostics. This is never included in the
  # anonymous telemetry payload and must not prevent the raw print attempt.
  try {
    $printerInfo = Get-CimInstance -ClassName Win32_Printer -Property Name,PrinterStatus,DriverName |
      Where-Object { $_.Name -eq $name } |
      Select-Object -First 1 Name,PrinterStatus,DriverName
    if ($printerInfo) {
      Write-Output ('FLO_PRINTER_INFO=' + ($printerInfo | ConvertTo-Json -Compress))
    }
  } catch { }

  Add-Type -TypeDefinition @'
${WINSPOOL_HELPER_SOURCE}
'@

  $bytes = [System.IO.File]::ReadAllBytes($file)
  $jobId = [FloRawPrinter]::SendRaw($name, $bytes)
  Write-Output ('FLO_JOB_ID=' + $jobId)
  exit 0
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  [Console]::Error.Flush()
  exit 1
}
`;
const execFileAsync = (0, util_1.promisify)(child_process_1.execFile);
function parseWindowsPrintOutput(output) {
    const outputLines = String(output || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    const jobLine = outputLines.find((line) => line.startsWith('FLO_JOB_ID='));
    const infoLine = outputLines.find((line) => line.startsWith('FLO_PRINTER_INFO='));
    const parsed = {};
    if (jobLine) {
        const jobId = Number(jobLine.slice('FLO_JOB_ID='.length));
        if (Number.isSafeInteger(jobId) && jobId > 0)
            parsed.jobId = jobId;
    }
    if (infoLine) {
        try {
            const info = JSON.parse(infoLine.slice('FLO_PRINTER_INFO='.length));
            if (typeof info.DriverName === 'string' && info.DriverName.trim())
                parsed.driverName = info.DriverName.trim();
            if (typeof info.PrinterStatus === 'number')
                parsed.printerStatus = info.PrinterStatus;
        }
        catch {
            /* diagnostics metadata is best-effort */
        }
    }
    return parsed;
}
// Node's execFile error message embeds the complete command line, which for the
// raw-print helper is `powershell ... -EncodedCommand <base64>`. Process-level
// failures (timeout, kill, launch failure) report an empty stderr, so that
// message must never become the printer detail.
const WINDOWS_PRINT_DETAIL_MAX_LENGTH = 400;
const WINDOWS_PRINT_COMMAND_EVIDENCE = /Command failed:|-EncodedCommand/i;
/** Stable classification of a failed Windows PowerShell subprocess. */
function describeWindowsPrintProcessFailure(error) {
    const failure = (error || {});
    if (failure.name === 'AbortError' || failure.code === 'ABORT_ERR')
        return 'Windows print command was cancelled';
    if (failure.killed === true || failure.code === 'ETIMEDOUT')
        return 'Windows print command timed out';
    // Spawn-level failures report an errno string instead of an exit status.
    if (typeof failure.code === 'string')
        return 'Could not start the Windows print helper';
    if (typeof failure.signal === 'string' && failure.signal)
        return `Windows print helper was terminated (${failure.signal})`;
    if (typeof failure.code === 'number')
        return `Windows print helper exited with code ${failure.code}`;
    return 'Windows raw print failed';
}
function redactWindowsPrintPayloadPath(detail, payloadPath) {
    if (!detail || !payloadPath)
        return detail;
    return detail
        .split(payloadPath)
        .join('<payload file>')
        .split(path.dirname(payloadPath))
        .join('<temp directory>');
}
const WINDOWS_PRINT_TRUNCATION_SUFFIX = ' [truncated]';
function capWindowsPrintDetail(detail) {
    if (detail.length <= WINDOWS_PRINT_DETAIL_MAX_LENGTH)
        return detail;
    const maxContentLength = Math.max(0, WINDOWS_PRINT_DETAIL_MAX_LENGTH - WINDOWS_PRINT_TRUNCATION_SUFFIX.length);
    return `${detail.slice(0, maxContentLength).trimEnd()}${WINDOWS_PRINT_TRUNCATION_SUFFIX}`;
}
/** Bounded, leak-free diagnostic for a failed Windows raw-print subprocess. */
function describeWindowsRawPrintFailure(error, options) {
    const cleanStderr = sanitizePowerShellStderr(String(error?.stderr || '').trim());
    const detail = cleanStderr && !WINDOWS_PRINT_COMMAND_EVIDENCE.test(cleanStderr)
        ? cleanStderr
        : describeWindowsPrintProcessFailure(error);
    const redacted = redactWindowsPrintPayloadPath(detail, options.payloadPath).trim();
    return (capWindowsPrintDetail(redacted) ||
        `Windows raw print failed for "${options.printerName || 'printer'}"`);
}
async function printViaUSBWindows(data, printerName, signal) {
    if (!printerName) {
        const detail = 'No Windows printer configured; refusing to guess a target';
        console.error(`[Printer] ${detail}`);
        return { ok: false, detail };
    }
    // %TEMP%, not C:\Windows\Temp — the latter is not writable by a standard user.
    const tmpFile = path.join(os.tmpdir(), `flo_print_${process.pid}_${Date.now()}.bin`);
    try {
        fs.writeFileSync(tmpFile, data);
        const { stdout } = await execFileAsync('powershell', windowsPowerShellCommandArgs(WINSPOOL_HELPER_SCRIPT), {
            encoding: 'utf8',
            timeout: 20000,
            signal,
            windowsHide: true,
            env: { ...process.env, FLO_PRINTER_NAME: printerName, FLO_PRINT_FILE: tmpFile },
        });
        const metadata = parseWindowsPrintOutput(stdout);
        console.log(`[Printer] Windows raw print accepted for "${printerName}" (${String(stdout).trim()})`);
        return { ok: true, ...metadata };
    }
    catch (err) {
        const detail = describeWindowsRawPrintFailure(err, { payloadPath: tmpFile, printerName });
        console.error(`[Printer] Windows raw print failed for "${printerName}": ${detail}`);
        return {
            ok: false,
            detail,
            failureClass: classifyPrintFailure(detail),
            platformErrorCode: extractPlatformErrorCode(detail),
            ...parseWindowsPrintOutput(err.stdout),
        };
    }
    finally {
        try {
            fs.unlinkSync(tmpFile);
        }
        catch { }
    }
}
function getPrinterStatus() {
    const printer = getPrinterConfig();
    return { connected: !!printer, printer };
}
//# sourceMappingURL=thermal.js.map