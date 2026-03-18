import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import fs from 'fs';
import path from 'path';
import os from 'os';

const SCOPES = [
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/spreadsheets.readonly',
];

const CONFIG_DIR = process.env.GDRIVE_CONFIG_DIR ?? path.join(os.homedir(), '.config', 'mcp-gdrive');
const ACTIVE_ACCOUNT_FILE = path.join(CONFIG_DIR, 'active-account');

// --- Account management ---

interface ADCCredentials {
    client_id: string;
    client_secret: string;
    refresh_token: string;
    type: string;
    quota_project_id?: string;
}

interface Account {
    name: string;
    filePath: string;
    credentials: ADCCredentials;
}

let accounts: Account[] | null = null;

function loadAccounts(): Account[] {
    if (accounts) return accounts;

    const adcFiles = process.env.GOOGLE_ADC_FILES;
    if (adcFiles) {
        accounts = adcFiles.split(',').map(filePath => {
            const trimmed = filePath.trim();
            const creds: ADCCredentials = JSON.parse(fs.readFileSync(trimmed, 'utf-8'));
            const name = path.basename(trimmed, '.json').replace(/^adc-/, '');
            return { name, filePath: trimmed, credentials: creds };
        });
    } else {
        // Default: use standard ADC file
        const defaultPath = path.join(os.homedir(), '.config', 'gcloud', 'application_default_credentials.json');
        if (!fs.existsSync(defaultPath)) {
            throw new Error('No ADC credentials found. Run: gcloud auth application-default login');
        }
        const creds: ADCCredentials = JSON.parse(fs.readFileSync(defaultPath, 'utf-8'));
        accounts = [{ name: 'default', filePath: defaultPath, credentials: creds }];
    }

    return accounts;
}

function getActiveAccountName(): string | null {
    try {
        return fs.readFileSync(ACTIVE_ACCOUNT_FILE, 'utf-8').trim();
    } catch {
        return null;
    }
}

function saveActiveAccountName(name: string): void {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(ACTIVE_ACCOUNT_FILE, name, { mode: 0o600 });
}

function getActiveAccount(): Account {
    const all = loadAccounts();
    const activeName = getActiveAccountName();
    const account = activeName ? all.find(a => a.name === activeName) : undefined;
    return account ?? all[0];
}

function createClient(account: Account): OAuth2Client {
    const client = new OAuth2Client(account.credentials.client_id, account.credentials.client_secret);
    client.setCredentials({ refresh_token: account.credentials.refresh_token });
    return client;
}

export interface AccountInfo {
    name: string;
    active: boolean;
    file: string;
}

export function getAccounts(): AccountInfo[] {
    const all = loadAccounts();
    const activeName = getActiveAccountName() ?? all[0]?.name;
    return all.map(a => ({ name: a.name, active: a.name === activeName, file: a.filePath }));
}

export function switchAccount(name: string): AccountInfo {
    const all = loadAccounts();
    const account = all.find(a => a.name === name);
    if (!account) {
        const available = all.map(a => a.name).join(', ');
        throw new Error(`Account "${name}" not found. Available: ${available}`);
    }
    saveActiveAccountName(name);
    cachedClient = null; // reset cached client
    return { name: account.name, active: true, file: account.filePath };
}

// --- Auth ---

let cachedClient: OAuth2Client | null = null;

async function ensureAuth(): Promise<void> {
    if (!cachedClient) {
        const account = getActiveAccount();
        cachedClient = createClient(account);
    }
    google.options({ auth: cachedClient });
}

function isPermissionError(error: any): boolean {
    const code = error?.code ?? error?.response?.status;
    return code === 403 || code === 404;
}

function permissionErrorMessage(error: any): string {
    const account = getActiveAccount();
    const all = loadAccounts();
    const others = all.filter(a => a.name !== account.name).map(a => a.name);
    let msg = `Permission denied using account "${account.name}". ${error.message}`;
    if (others.length > 0) {
        msg += `\n\nTry switching to another account: ${others.join(', ')}`;
        msg += `\nCLI: gdrive-cli account <name>`;
    }
    return msg;
}

// --- API functions ---

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

    try {
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
    } catch (error: any) {
        if (isPermissionError(error)) throw new Error(permissionErrorMessage(error));
        throw error;
    }
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

    try {
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
    } catch (error: any) {
        if (isPermissionError(error)) throw new Error(permissionErrorMessage(error));
        throw error;
    }
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

    try {
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
    } catch (error: any) {
        if (isPermissionError(error)) throw new Error(permissionErrorMessage(error));
        throw error;
    }
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

    try {
        let response;

        if (ranges) {
            response = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges });
        } else if (sheetId !== undefined) {
            const metadata = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties' });
            const sheet = metadata.data.sheets?.find(s => s.properties?.sheetId === sheetId);
            if (!sheet?.properties?.title) throw new Error(`Sheet ID ${sheetId} not found`);
            response = await sheets.spreadsheets.values.get({ spreadsheetId, range: sheet.properties.title });
        } else {
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
    } catch (error: any) {
        if (isPermissionError(error)) throw new Error(permissionErrorMessage(error));
        throw error;
    }
}

