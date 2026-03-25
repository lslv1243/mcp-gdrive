---
name: gdrive
description: Use when the user asks about Google Drive files, Google Docs, or Google Sheets. Auto-invoked for Drive/Sheets tasks.
user-invocable: false
---

# Google Drive CLI

Use `gdrive-cli` to search and read Google Drive files and Sheets.

## Commands

```
gdrive-cli accounts                                     List configured Google accounts (shows active)
gdrive-cli account <name>                               Switch active account
gdrive-cli search <query> [--limit=N]                   Search files (default limit: 10, max: 100)
gdrive-cli read <fileId>                                Read file contents (Docs->markdown, Sheets->CSV)
gdrive-cli sheets <spreadsheetId>                       List all sheets/tabs in a spreadsheet
gdrive-cli sheet <spreadsheetId> [--ranges=A1:B10] [--sheet-id=0]  Read spreadsheet data
```

## Notes

- On permission errors, try switching account with `gdrive-cli account <name>`
- **File exports**: Google Docs -> Markdown, Sheets -> CSV, Presentations -> plain text
- `--ranges` uses A1 notation (e.g. `Sheet1!A1:B10`)
- `--sheet-id` targets a specific tab by numeric ID
- All commands support `--json` for raw JSON output
