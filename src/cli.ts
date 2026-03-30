#!/usr/bin/env node

import { searchFiles, readFile, listSheets, readSheet, getAccounts, switchAccount } from './gdrive-client.js';

const HELP = `
gdrive-cli — Google Drive & Sheets from the command line using ADC

Usage: gdrive-cli <command> [options]

Commands:
  accounts                                      List configured accounts
  account <name>                                Switch active account
  search <query> [--limit=N]                    Search files in Drive
  read <fileId>                                 Read file contents
  sheets <spreadsheetId>                        List all sheets/tabs in a spreadsheet
  sheet <spreadsheetId> [--ranges=A1:B10]       Read spreadsheet data (all tabs by default)
  sheet <spreadsheetId> [--sheet-id=0]          Read specific sheet by ID
  help                                          Show this help

Options:
  --json       Output raw JSON instead of formatted text
  --limit=N    Number of results (default: 10)

Examples:
  gdrive-cli search "quarterly report"
  gdrive-cli read 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms
  gdrive-cli sheets 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms
  gdrive-cli sheet 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms
  gdrive-cli sheet 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms --ranges=Sheet1!A1:D10
`.trim();

const args = process.argv.slice(2);
const command = args[0];
const rawJson = args.includes('--json');

function getFlag(name: string): string | undefined {
    const flag = args.find(a => a.startsWith(`--${name}=`));
    return flag?.split('=')[1];
}

function parseGoogleUrl(input: string): { id: string; sheetId?: number } {
    try {
        const url = new URL(input);
        const sheetsMatch = url.pathname.match(/\/spreadsheets\/d\/([^/]+)/);
        if (sheetsMatch) {
            const gid = url.searchParams.get('gid');
            return { id: sheetsMatch[1], sheetId: gid ? parseInt(gid, 10) : undefined };
        }
        const docsMatch = url.pathname.match(/\/d\/([^/]+)/);
        if (docsMatch) return { id: docsMatch[1] };
    } catch {
        // Not a URL — treat as raw ID
    }
    return { id: input };
}

function print(data: any): void {
    console.log(JSON.stringify(data, null, 2));
}

function formatSearchResults(data: Awaited<ReturnType<typeof searchFiles>>): void {
    if (rawJson) { print(data); return; }

    console.log(`Found ${data.files.length} files:\n`);
    for (const f of data.files) {
        console.log(`  ${f.name}`);
        console.log(`    ID: ${f.id}  Type: ${f.mimeType}  Modified: ${f.modifiedTime ?? 'unknown'}`);
    }
    if (data.nextPageToken) {
        console.log(`\nMore results available (pageToken: ${data.nextPageToken})`);
    }
}

function formatFileContent(data: Awaited<ReturnType<typeof readFile>>): void {
    if (rawJson) { print(data); return; }

    console.log(`File: ${data.name} (${data.mimeType})\n`);
    if (data.text) {
        console.log(data.text);
    } else if (data.blob) {
        console.log(`[Binary content, ${data.blob.length} bytes base64]`);
    }
}

function formatSheetData(data: Awaited<ReturnType<typeof readSheet>>): void {
    if (rawJson) { print(data); return; }

    for (const sheet of data) {
        console.log(`Sheet: ${sheet.sheetName} (${sheet.totalRows} rows)\n`);
        console.log(`  ${sheet.headers.join('\t')}`);
        console.log(`  ${'—'.repeat(sheet.headers.join('\t').length)}`);
        for (const row of sheet.rows) {
            const values = sheet.headers.map((h, i) => row[i]?.[h] ?? '');
            console.log(`  ${values.join('\t')}`);
        }
        console.log();
    }
}

async function main(): Promise<void> {
    if (!command || command === 'help' || command === '--help') {
        console.log(HELP);
        return;
    }

    switch (command) {
        case 'accounts': {
            const accs = getAccounts();
            if (rawJson) { print(accs); } else {
                console.log('Configured accounts:\n');
                for (const a of accs) {
                    const marker = a.active ? '* ' : '  ';
                    console.log(`${marker}${a.name} (${a.file})`);
                }
            }
            break;
        }

        case 'account': {
            const name = args[1];
            if (!name) {
                console.error('Usage: gdrive-cli account <name>');
                process.exit(1);
            }
            const result = switchAccount(name);
            if (rawJson) { print(result); } else { console.log(`Switched to account: ${result.name}`); }
            break;
        }

        case 'search': {
            const query = args.slice(1).filter(a => !a.startsWith('--')).join(' ');
            const limit = parseInt(getFlag('limit') ?? '10', 10);
            const data = await searchFiles(query, limit);
            formatSearchResults(data);
            break;
        }

        case 'read': {
            const rawFileId = args[1];
            if (!rawFileId) {
                console.error('Usage: gdrive-cli read <fileId|url>');
                process.exit(1);
            }
            const { id: fileId } = parseGoogleUrl(rawFileId);
            const data = await readFile(fileId);
            formatFileContent(data);
            break;
        }

        case 'sheets': {
            const rawSheetsId = args[1];
            if (!rawSheetsId) {
                console.error('Usage: gdrive-cli sheets <spreadsheetId|url>');
                process.exit(1);
            }
            const { id: spreadsheetId } = parseGoogleUrl(rawSheetsId);
            const info = await listSheets(spreadsheetId);
            if (rawJson) { print(info); } else {
                console.log(`Spreadsheet: ${info.title}\n`);
                for (const s of info.sheets) {
                    console.log(`  ${s.title} (id: ${s.sheetId}, ${s.rowCount} rows, ${s.columnCount} cols)`);
                }
            }
            break;
        }

        case 'sheet': {
            const rawSheetId = args[1];
            if (!rawSheetId) {
                console.error('Usage: gdrive-cli sheet <spreadsheetId|url> [--ranges=...] [--sheet-id=...]');
                process.exit(1);
            }
            const parsed = parseGoogleUrl(rawSheetId);
            const rangesFlag = getFlag('ranges');
            const sheetIdFlag = getFlag('sheet-id');
            const ranges = rangesFlag ? rangesFlag.split(',') : undefined;
            const sheetId = sheetIdFlag ? parseInt(sheetIdFlag, 10) : parsed.sheetId;
            const data = await readSheet(parsed.id, ranges, sheetId);
            formatSheetData(data);
            break;
        }

        default:
            console.error(`Unknown command: ${command}\n`);
            console.log(HELP);
            process.exit(1);
    }
}

main().catch(error => {
    console.error('Error:', error.message);
    process.exit(1);
});
