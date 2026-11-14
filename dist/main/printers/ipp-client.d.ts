export declare const DEFAULT_CUPS_SOCKET_PATH = "/private/var/run/cupsd";
export declare const DEFAULT_CUPS_HOST = "127.0.0.1";
export declare const DEFAULT_CUPS_PORT = 631;
export declare const CUPS_RAW_DOCUMENT_FORMAT = "application/vnd.cups-raw";
export declare const OP_PRINT_JOB = 2;
export declare const OP_GET_PRINTER_ATTRIBUTES = 11;
export declare const OP_CUPS_GET_DEFAULT = 16385;
export declare const OP_CUPS_GET_PRINTERS = 16386;
export declare const TAG_OPERATION_ATTRIBUTES = 1;
export declare const TAG_JOB_ATTRIBUTES = 2;
export declare const TAG_END_OF_ATTRIBUTES = 3;
export declare const TAG_PRINTER_ATTRIBUTES = 4;
export declare const VALUE_TAG: {
    readonly integer: 33;
    readonly boolean: 34;
    readonly enum: 35;
    readonly textWithLanguage: 53;
    readonly nameWithLanguage: 54;
    readonly textWithoutLanguage: 65;
    readonly nameWithoutLanguage: 66;
    readonly keyword: 68;
    readonly uri: 69;
    readonly charset: 71;
    readonly naturalLanguage: 72;
    readonly mimeMediaType: 73;
};
export declare const IPP_STATUS_OK_MAX = 255;
export declare const IPP_STATUS_CLIENT_ERROR_NOT_FOUND = 1030;
export declare const IPP_STATUS_SERVER_ERROR_NOT_ACCEPTING_JOBS = 1286;
export declare const IPP_STATUS_SERVER_ERROR_BUSY = 1287;
export declare const IPP_STATUS_SERVER_ERROR_JOB_CANCELED = 1288;
export interface IppEndpointConfig {
    socketPath?: string | null;
    host?: string;
    port?: number;
}
export declare function setIppEndpointForTesting(config: IppEndpointConfig | null): void;
export type IppValue = string | number | boolean;
export type IppAttributeGroup = Record<string, IppValue[]>;
export interface IppAttribute {
    tag: number;
    name: string;
    values: IppValue[];
}
export interface IppResponse {
    statusCode: number;
    operationAttributes: IppAttributeGroup;
    /** One entry per printer-attributes-tag group (or per job-attributes-tag group). */
    groups: IppAttributeGroup[];
}
export declare function buildIppRequest(operationId: number, operationAttributes: IppAttribute[], body?: Buffer): Buffer;
export declare function parseIppResponse(buf: Buffer): IppResponse;
export declare function formatIppStatusError(statusCode: number, printerName: string, statusMessage?: string): string;
/** Enumerates every printer CUPS knows about (queues for USB and network printers alike). */
export declare function ippGetPrinters(signal?: AbortSignal): Promise<IppAttributeGroup[]>;
/** Returns the CUPS-configured default printer's name, or null if none is set. */
export declare function ippGetDefaultPrinterName(signal?: AbortSignal): Promise<string | null>;
export interface IppPrinterAttributes {
    exists: boolean;
    statusCode: number;
    state?: number;
    isAcceptingJobs?: boolean;
    stateReasons?: string[];
    detail?: string;
}
/** Pre-flight check mirroring thermal.ts's describeCupsQueueProblem for the lp path. */
export declare function ippGetPrinterAttributes(printerName: string, signal?: AbortSignal): Promise<IppPrinterAttributes>;
export interface IppPrintResult {
    ok: boolean;
    statusCode: number;
    jobId?: number;
    detail?: string;
}
/** Submits raw bytes (ESC/POS) as a Print-Job with document-format application/vnd.cups-raw - the IPP equivalent of `lp -o raw`. */
export declare function ippPrintRaw(printerName: string, data: Buffer, signal?: AbortSignal): Promise<IppPrintResult>;
//# sourceMappingURL=ipp-client.d.ts.map