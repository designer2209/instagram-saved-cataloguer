# Contributing

Thanks for your interest in improving the Instagram Saved Cataloguer. This is a small personal project, but contributions, bug reports, and ideas are genuinely welcome.

## Reporting a bug

Open an [issue](../../issues) and include:

- What you were doing (finding posts, processing, exporting, etc.).
- What you expected to happen and what actually happened.
- Your browser and version.
- Which AI provider and model you were using.
- Any message shown in the extension's status box, or errors from `chrome://extensions` → the extension's **service worker** → **Inspect** console.

Please **do not** include your API key or any personal information in an issue.

## Suggesting an idea

Open an issue describing the problem you are trying to solve, not just the feature. "I couldn't tell which posts still needed reviewing" is more useful than "add a button here."

## Making a change

1. Fork the repository and create a branch for your change.
2. Keep changes focused — one improvement per pull request.
3. Test it manually: load the unpacked extension, run it against a real Saved page, and confirm the flow still works end to end.
4. Open a pull request describing what changed and why.

## Where things live

- `extension/manifest.json` — permissions and extension metadata.
- `extension/popup.html` / `popup.js` — the settings and control panel.
- `extension/content.js` — the core logic: finding posts, reading them, batching, sounds. **The selectors at the top marked `CALIBRATION` are the most likely thing to break when Instagram changes its page layout** — that's the first place to look if finding or captions stop working.
- `extension/background.js` — network calls to Instagram's images and to the AI provider.

## A note on responsible use

This tool automates access to your own saved data in your own logged-in session. Please keep it that way: don't use it to bulk-scrape other people's content, and respect Instagram's rate limits (the extension already paces itself for this reason).
