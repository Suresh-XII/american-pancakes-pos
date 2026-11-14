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
exports.resolveBuildIdentity = resolveBuildIdentity;
exports.resolveOfficialRelease = resolveOfficialRelease;
exports.resolveBuildPostHogSettings = resolveBuildPostHogSettings;
exports.readBuildPostHogSettings = readBuildPostHogSettings;
exports.isOfficialReleaseBuild = isOfficialReleaseBuild;
exports.getBuildIdentity = getBuildIdentity;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
function resolveBuildIdentity(metadata, packaged) {
    if (!packaged)
        return 'dev';
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata))
        return 'unknown';
    const value = metadata;
    if (value.schema_version !== 1 || typeof value.build_id !== 'string')
        return 'unknown';
    if (value.build_id === 'custom' || value.build_id === 'unknown')
        return value.build_id;
    if (!/^[0-9a-f]{40}$/i.test(value.build_id) || value.source_commit !== value.build_id)
        return 'unknown';
    return value.build_id;
}
function packagedRuntime() {
    try {
        return require('electron').app?.isPackaged === true;
    }
    catch {
        return false;
    }
}
/** A packaged release-workflow build. Local packages and CI test packages are not. */
function resolveOfficialRelease(metadata, packaged) {
    if (!packaged || !metadata || typeof metadata !== 'object')
        return false;
    return metadata.official_release === true;
}
function readMetadata() {
    return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'build-identity.json'), 'utf8'));
}
/** The PostHog project a release workflow stamped into the build, if any. */
function resolveBuildPostHogSettings(metadata) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata))
        return {};
    const value = metadata;
    const text = (field) => typeof field === 'string' && field.trim() ? field.trim() : undefined;
    return { token: text(value.posthog_project_token), host: text(value.posthog_host) };
}
function readBuildPostHogSettings() {
    try {
        return resolveBuildPostHogSettings(readMetadata());
    }
    catch {
        return {};
    }
}
function isOfficialReleaseBuild() {
    try {
        return resolveOfficialRelease(readMetadata(), packagedRuntime());
    }
    catch {
        return false;
    }
}
function getBuildIdentity() {
    const packaged = packagedRuntime();
    if (!packaged)
        return 'dev';
    try {
        return resolveBuildIdentity(readMetadata(), true);
    }
    catch {
        return 'unknown';
    }
}
//# sourceMappingURL=build-identity.js.map