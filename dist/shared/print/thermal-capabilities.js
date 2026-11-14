"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LATIN_THERMAL_CAPABILITIES = exports.GENERIC_THERMAL_CAPABILITIES = void 0;
exports.normalizeThermalText = normalizeThermalText;
exports.hasArabicScript = hasArabicScript;
exports.isArabicShapingSafeLine = isArabicShapingSafeLine;
exports.selectThermalCodePage = selectThermalCodePage;
exports.isThermalTextRepresentable = isThermalTextRepresentable;
exports.thermalTextFallback = thermalTextFallback;
exports.shouldUseOrderTypeFallback = shouldUseOrderTypeFallback;
exports.escPosCodePageId = escPosCodePageId;
exports.mergeThermalCapabilities = mergeThermalCapabilities;
const currency_1 = require("./currency");
exports.GENERIC_THERMAL_CAPABILITIES = {
    encoding: { codePages: ['ascii'], preferredCodePage: 'ascii' },
    shaping: { arabic: false },
    representability: { scripts: ['ascii'] },
    transliteration: { enabled: true },
    warnings: { unsupportedText: 'skip', financialText: 'refuse', orderTypeFallback: 'ascii' },
    raster: { enabled: false, widthDots: 0, maxBandHeight: 0, modes: [] },
};
exports.LATIN_THERMAL_CAPABILITIES = {
    ...exports.GENERIC_THERMAL_CAPABILITIES,
    encoding: {
        codePages: ['cp437', 'cp850', 'cp858', 'windows1252', 'ascii'],
        preferredCodePage: 'cp437',
    },
    representability: { scripts: ['ascii', 'latin'] },
    transliteration: { enabled: true },
};
// The shipped fallback preserves established German and Albanian thermal
// transliteration without claiming quality coverage for every accented locale.
const LATIN_ASCII_MAP = {
    Ä: 'AE',
    Ö: 'OE',
    Ü: 'UE',
    ä: 'ae',
    ö: 'oe',
    ü: 'ue',
    ß: 'ss',
    Ç: 'C',
    ç: 'c',
    Ë: 'E',
    ë: 'e',
};
const CODE_PAGE_CHARACTERS = {
    cp437: 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ',
    cp850: 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´­±‗¾¶§÷¸°¨·¹³²■ ',
    cp858: 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈ€ÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´­±‗¾¶§÷¸°¨·¹³²■ ',
    windows1252: '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜š›œžŸÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿ',
};
const ARABIC_SCRIPT_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
const ARABIC_SCRIPT_GLOBAL_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/g;
const SHAPING_ALLOWED_GLOBAL_RE = /[\u200C\u200D\u200F\u2026]/g;
const THERMAL_CURRENCY_TOKEN_RE = new RegExp(`(?:${currency_1.CURRENCY_TOKEN_PATTERN})`, 'g');
const LATIN_LETTER_RE = /\p{Script=Latin}/u;
const LETTER_RE = /\p{Letter}/u;
function codePageCanRepresent(text, codePage) {
    if (codePage === 'ascii')
        return !/[^\x00-\x7F]/.test(text);
    const characters = CODE_PAGE_CHARACTERS[codePage];
    return [...text].every((character) => character <= '\x7F' || characters.includes(character));
}
function normalizeThermalText(text, capabilities) {
    if (!capabilities.transliteration.enabled)
        return text;
    if (capabilities.representability.scripts.includes('latin')) {
        const hasNativeCodePage = capabilities.encoding.codePages.some((codePage) => codePage !== 'ascii' && codePageCanRepresent(text, codePage));
        if (hasNativeCodePage)
            return text;
    }
    return text.replace(/[À-ÿ]/g, (character) => LATIN_ASCII_MAP[character] ?? character);
}
function hasArabicScript(text) {
    return ARABIC_SCRIPT_RE.test(text);
}
function isArabicShapingSafeLine(text) {
    if (!hasArabicScript(text))
        return false;
    const textWithoutCurrency = text.replace(THERMAL_CURRENCY_TOKEN_RE, '');
    return !/[^\x00-\x7F]/.test(textWithoutCurrency.replace(ARABIC_SCRIPT_GLOBAL_RE, '').replace(SHAPING_ALLOWED_GLOBAL_RE, ''));
}
function selectThermalCodePage(text, capabilities) {
    const normalized = normalizeThermalText(text, capabilities);
    for (const codePage of capabilities.encoding.codePages) {
        if (codePageCanRepresent(normalized, codePage))
            return codePage;
    }
    return null;
}
function isThermalTextRepresentable(text, capabilities) {
    const normalized = normalizeThermalText(text, capabilities);
    if (capabilities.shaping.arabic && isArabicShapingSafeLine(normalized))
        return true;
    if (hasArabicScript(normalized))
        return false;
    if (capabilities.representability.scripts.includes('latin') &&
        [...normalized].some((character) => LETTER_RE.test(character) && !LATIN_LETTER_RE.test(character))) {
        return false;
    }
    return (selectThermalCodePage(normalized, capabilities) !== null &&
        capabilities.representability.scripts.includes('ascii') &&
        (!/[^\x00-\x7F]/.test(normalized) || capabilities.representability.scripts.includes('latin')));
}
function thermalTextFallback(value, fallback, capabilities) {
    const normalized = normalizeThermalText(value, capabilities);
    return isThermalTextRepresentable(normalized, capabilities) ? normalized : fallback;
}
function shouldUseOrderTypeFallback(localizedText, capabilities) {
    if (capabilities.warnings.orderTypeFallback !== 'ascii')
        return false;
    const nativeCapabilities = capabilities.transliteration.enabled
        ? { ...capabilities, transliteration: { enabled: false } }
        : capabilities;
    return !isThermalTextRepresentable(localizedText, nativeCapabilities);
}
function escPosCodePageId(codePage) {
    // ESC/POS values are the Epson-compatible IDs used by the shipped profiles.
    return { ascii: 0, cp437: 0, cp850: 2, cp858: 19, windows1252: 16 }[codePage];
}
function mergeThermalCapabilities(capabilities, arabicShapingOverride) {
    const base = capabilities ?? exports.GENERIC_THERMAL_CAPABILITIES;
    if (typeof arabicShapingOverride !== 'boolean')
        return base;
    return { ...base, shaping: { ...base.shaping, arabic: arabicShapingOverride } };
}
//# sourceMappingURL=thermal-capabilities.js.map