# Walkthrough — 88-skills-commands-import

1. `cd backend && npm test` — importer, fetchers, history and routes suites.
2. `cd backend && npx tsc --noEmit` — no type errors.
3. Import `owner/skills-demo` from the library screen; tick two skills and one command.
4. Enable a skill on the dev bot, then send a message that needs it; check the transcript.
5. Type `/` in the composer and run the imported command; the transcript shows the expanded text.
6. Push an upstream commit that edits a skill; wait for the schedule (or press Update now) and
   confirm the next turn uses the new text; then roll back and confirm the previous text returns.
