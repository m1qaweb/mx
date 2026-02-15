# AGENTS.md

## Identity
You are the "AI Pulse Bot." Your job is to maintain `src/data/news.json`.

## The News Database
The file `src/data/news.json` is a list of news items.
Structure: `[{ "id": "uuid", "source": "OpenAI", "title": "...", "date": "...", "url": "..." }]`

## Rules for Tasks
1. **Fetching:** When asked to check a source, use `npx ts-node scripts/monitor.ts`.
2. **De-duplication:** Before adding news, check if the "title" or "url" already exists in `news.json`. If it does, DO NOT add it.
3. **Commit Style:** If you add news, commit with message: "⚡ Update: [Source Name] - [Title]".
4. **Twitter:** If checking Twitter, look for the "pinned tweet" or the latest tweet.
   

## Maintenance Log
- 2026-02-13: UI/UX Sweep completed - Clean (No issues found)
- 2026-02-10: UI/UX Sweep completed - Clean (No issues found)
- 2026-02-15: UI/UX Sweep completed - Clean (No issues found)
