# mcp-gdrive

Google Drive & Sheets MCP server and CLI. Uses [Application Default Credentials](https://cloud.google.com/docs/authentication/application-default-credentials) — no GCP project or OAuth Client ID needed.

Fork of [isaacphi/mcp-gdrive](https://github.com/isaacphi/mcp-gdrive) with security fixes and simplified auth.

## Setup

### 1. Authenticate with Google

```bash
gcloud auth application-default login \
  --scopes="https://www.googleapis.com/auth/cloud-platform,https://www.googleapis.com/auth/drive.readonly,https://www.googleapis.com/auth/spreadsheets"
```

If using Google Workspace, set a quota project:

```bash
gcloud auth application-default set-quota-project <your-gcp-project>
```

### 2. Build

```bash
npm install && npm run build
```

## CLI usage

```
gdrive-cli <command> [options]

Commands:
  search <query> [--limit=N]                    Search files in Drive
  read <fileId>                                 Read file contents
  sheet <spreadsheetId> [--ranges=A1:B10]       Read spreadsheet data
  sheet <spreadsheetId> [--sheet-id=0]          Read specific sheet by ID
  update <spreadsheetId> <range> <value>        Update a cell value

Options:
  --json       Output raw JSON
  --limit=N    Number of results (default: 10)
```

Examples:

```bash
gdrive-cli search "quarterly report"
gdrive-cli read 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms
gdrive-cli sheet 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms
gdrive-cli sheet 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms --ranges=Sheet1!A1:D10
gdrive-cli update 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms Sheet1!A1 "Hello"
```

## MCP server

Add to your Claude Code config:

```json
{
  "mcpServers": {
    "gdrive": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/mcp-gdrive/dist/mcp-server.js"]
    }
  }
}
```

### Tools

| MCP tool | Description | CLI equivalent |
|----------|-------------|----------------|
| `gdrive_search` | Search files in Google Drive | `gdrive-cli search <query>` |
| `gdrive_read_file` | Read file contents | `gdrive-cli read <fileId>` |
| `gsheets_list` | List all sheets/tabs in a spreadsheet | `gdrive-cli sheets <id>` |
| `gsheets_read` | Read spreadsheet data (all tabs by default) | `gdrive-cli sheet <id>` |
| `gsheets_update_cell` | Update a cell value | `gdrive-cli update <id> <range> <value>` |

## License

MIT
