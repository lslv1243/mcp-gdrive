import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { searchFiles, readFile, listSheets, readSheet, getAccounts, switchAccount } from './gdrive-client.js';

export function registerTools(server: McpServer): void {
    const errorResult = (message: string) => ({
        content: [{ type: 'text' as const, text: message }],
    });

    const jsonResult = (data: any) => ({
        content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
    });

    server.tool(
        'gdrive_list_accounts',
        'List configured Google accounts and show which is active. CLI: gdrive-cli accounts',
        {},
        async () => {
            try {
                const data = getAccounts();
                return jsonResult(data);
            } catch (e: any) {
                return errorResult(e.message);
            }
        },
    );

    server.tool(
        'gdrive_switch_account',
        'Switch the active Google account. Use this when you get permission errors. CLI: gdrive-cli account <name>',
        {
            name: z.string().describe('Account name to switch to'),
        },
        async ({ name }) => {
            try {
                const data = switchAccount(name);
                return jsonResult(data);
            } catch (e: any) {
                return errorResult(e.message);
            }
        },
    );

    server.tool(
        'gdrive_search',
        'Search for files in Google Drive. CLI: gdrive-cli search <query>',
        {
            query: z.string().describe('Search query'),
            pageSize: z.number().optional().default(10).describe('Number of results (max 100)'),
            pageToken: z.string().optional().describe('Token for next page of results'),
        },
        async ({ query, pageSize, pageToken }) => {
            try {
                const data = await searchFiles(query, pageSize, pageToken);
                return jsonResult(data);
            } catch (e: any) {
                return errorResult(e.message);
            }
        },
    );

    server.tool(
        'gdrive_read_file',
        'Read contents of a file from Google Drive. CLI: gdrive-cli read <fileId>',
        {
            fileId: z.string().describe('ID of the file to read'),
        },
        async ({ fileId }) => {
            try {
                const data = await readFile(fileId);
                return jsonResult(data);
            } catch (e: any) {
                return errorResult(e.message);
            }
        },
    );

    server.tool(
        'gsheets_list',
        'List all sheets/tabs in a Google Spreadsheet. CLI: gdrive-cli sheets <spreadsheetId>',
        {
            spreadsheetId: z.string().describe('The ID of the spreadsheet'),
        },
        async ({ spreadsheetId }) => {
            try {
                const data = await listSheets(spreadsheetId);
                return jsonResult(data);
            } catch (e: any) {
                return errorResult(e.message);
            }
        },
    );

    server.tool(
        'gsheets_read',
        'Read data from a Google Spreadsheet. CLI: gdrive-cli sheet <spreadsheetId> [--ranges=A1:B10] [--sheet-id=0]',
        {
            spreadsheetId: z.string().describe('The ID of the spreadsheet'),
            ranges: z.array(z.string()).optional().describe("A1 notation ranges like ['Sheet1!A1:B10']"),
            sheetId: z.number().optional().describe('Specific sheet ID to read'),
        },
        async ({ spreadsheetId, ranges, sheetId }) => {
            try {
                const data = await readSheet(spreadsheetId, ranges, sheetId);
                return jsonResult(data);
            } catch (e: any) {
                return errorResult(e.message);
            }
        },
    );

}
