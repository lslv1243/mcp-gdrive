import { google } from 'googleapis';
import { GoogleAuth } from 'google-auth-library';

const SCOPES = [
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/spreadsheets',
];

let cachedAuth: GoogleAuth | null = null;

async function ensureAuth(): Promise<void> {
    if (!cachedAuth) {
        cachedAuth = new GoogleAuth({ scopes: SCOPES });
    }
    const client = await cachedAuth.getClient();
    google.options({ auth: client as any });
}

export interface SearchResult {
    files: Array<{ id: string; name: string; mimeType: string; modifiedTime?: string }>;
    nextPageToken?: string;
}

export async function searchFiles(query: string, pageSize = 10, pageToken?: string): Promise<SearchResult> {
    await ensureAuth();
    const drive = google.drive('v3');

    const trimmed = query.trim();
    let searchQuery: string;

    if (!trimmed) {
        searchQuery = 'trashed = false';
    } else {
        const escaped = trimmed.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        const conditions = [`name contains '${escaped}'`];
        if (trimmed.toLowerCase().includes('sheet')) {
            conditions.push("mimeType = 'application/vnd.google-apps.spreadsheet'");
        }
        searchQuery = `(${conditions.join(' or ')}) and trashed = false`;
    }

    const res = await drive.files.list({
        q: searchQuery,
        pageSize,
        pageToken,
        orderBy: 'modifiedTime desc',
        fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, size)',
    });

    return {
        files: (res.data.files ?? []).map(f => ({
            id: f.id!,
            name: f.name!,
            mimeType: f.mimeType!,
            modifiedTime: f.modifiedTime ?? undefined,
        })),
        nextPageToken: res.data.nextPageToken ?? undefined,
    };
}

export interface FileContent {
    name: string;
    mimeType: string;
    text?: string;
    blob?: string;
}

export async function readFile(fileId: string): Promise<FileContent> {
    await ensureAuth();
    const drive = google.drive('v3');

    const file = await drive.files.get({ fileId, fields: 'mimeType,name' });
    const name = file.data.name ?? fileId;
    const mimeType = file.data.mimeType ?? 'application/octet-stream';

    if (mimeType.startsWith('application/vnd.google-apps')) {
        let exportMimeType: string;
        switch (mimeType) {
            case 'application/vnd.google-apps.document': exportMimeType = 'text/markdown'; break;
            case 'application/vnd.google-apps.spreadsheet': exportMimeType = 'text/csv'; break;
            case 'application/vnd.google-apps.presentation': exportMimeType = 'text/plain'; break;
            default: exportMimeType = 'text/plain';
        }

        const res = await drive.files.export({ fileId, mimeType: exportMimeType }, { responseType: 'text' });
        return { name, mimeType: exportMimeType, text: res.data as string };
    }

    const res = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' });
    const content = Buffer.from(res.data as ArrayBuffer);
    const isText = mimeType.startsWith('text/') || mimeType === 'application/json';

    return {
        name,
        mimeType,
        ...(isText ? { text: content.toString('utf-8') } : { blob: content.toString('base64') }),
    };
}

export interface SheetInfo {
    sheetId: number;
    title: string;
    rowCount: number;
    columnCount: number;
}

export async function listSheets(spreadsheetId: string): Promise<{ title: string; sheets: SheetInfo[] }> {
    await ensureAuth();
    const sheets = google.sheets('v4');

    const metadata = await sheets.spreadsheets.get({ spreadsheetId, fields: 'properties.title,sheets.properties' });

    return {
        title: metadata.data.properties?.title ?? 'Unknown',
        sheets: (metadata.data.sheets ?? []).map(s => ({
            sheetId: s.properties?.sheetId ?? 0,
            title: s.properties?.title ?? 'Unknown',
            rowCount: s.properties?.gridProperties?.rowCount ?? 0,
            columnCount: s.properties?.gridProperties?.columnCount ?? 0,
        })),
    };
}

export interface SheetData {
    sheetName: string;
    headers: string[];
    rows: Record<string, string>[][];
    totalRows: number;
}

export async function readSheet(spreadsheetId: string, ranges?: string[], sheetId?: number): Promise<SheetData[]> {
    await ensureAuth();
    const sheets = google.sheets('v4');

    let response;

    if (ranges) {
        response = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges });
    } else if (sheetId !== undefined) {
        const metadata = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties' });
        const sheet = metadata.data.sheets?.find(s => s.properties?.sheetId === sheetId);
        if (!sheet?.properties?.title) throw new Error(`Sheet ID ${sheetId} not found`);
        response = await sheets.spreadsheets.values.get({ spreadsheetId, range: sheet.properties.title });
    } else {
        // Read ALL sheets, not just the first one
        const metadata = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties' });
        const sheetNames = (metadata.data.sheets ?? []).map(s => s.properties?.title).filter(Boolean) as string[];
        if (sheetNames.length === 0) return [];
        response = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: sheetNames });
    }

    const valueRanges = (response.data as any).valueRanges ?? [response.data];
    const results: SheetData[] = [];

    for (const range of valueRanges) {
        const values: string[][] = range.values ?? [];
        if (values.length === 0) continue;

        const sheetName = range.range?.split('!')[0]?.replace(/'/g, '') ?? 'Sheet1';
        const headers = values[0];
        const rows = values.slice(1).map(row =>
            row.map((cell, i) => ({ [headers[i] ?? `col_${i}`]: cell }))
        );

        results.push({ sheetName, headers, rows, totalRows: values.length });
    }

    return results;
}

export interface UpdateResult {
    range: string;
    value: string;
}

export async function updateCell(spreadsheetId: string, range: string, value: string): Promise<UpdateResult> {
    await ensureAuth();
    const sheets = google.sheets('v4');

    await sheets.spreadsheets.values.update({
        spreadsheetId,
        range,
        valueInputOption: 'RAW',
        requestBody: { values: [[value]] },
    });

    return { range, value };
}
