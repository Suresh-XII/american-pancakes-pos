export declare const MAX_PDF_HTML_BYTES: number;
export type PdfPageSize = 'A4' | 'Letter';
type HtmlToPdfRenderer = (input: {
    html: string;
    pageSize: PdfPageSize;
}) => Promise<Buffer>;
export declare function setHtmlToPdfRendererForTests(renderer: HtmlToPdfRenderer | null): void;
export declare function isAllowedPdfStagingRequestUrl(requestUrl: string, htmlPath: string): boolean;
export declare function renderHtmlToPdfBuffer(input: {
    html: string;
    pageSize?: unknown;
}): Promise<Buffer>;
export {};
//# sourceMappingURL=html-to-pdf.d.ts.map