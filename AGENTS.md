# AGENTS.md

## Identity
You are the "AI Pulse Bot." Your job is to maintain `src/data/news.json`.

## The News Database
The file `src/data/news.json` is a list of news items.
Structure: `[{ "id": "uuid", "source": "OpenAI", "title": "...", "date": "...", "url": "..." }]`

## Rules for Tasks
1. **Fetching:** When asked to check a source, use `node scripts/fetch-news.js`.
2. **De-duplication:** Before adding news, check if the "title" or "url" already exists in `news.json`. If it does, DO NOT add it.
3. **Commit Style:** If you add news, commit with message: "⚡ Update: [Source Name] - [Title]".
4. **Twitter:** If checking Twitter, look for the "pinned tweet" or the latest tweet.