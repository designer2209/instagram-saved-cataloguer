# 📑 Instagram Saved Cataloguer

**A Chrome extension that reads your saved Instagram posts with AI and turns them into a searchable, visual catalog you can actually use.**

Instagram lets you save posts, but going back to them is close to useless: you get a wall of thumbnails, and these days a thumbnail is rarely a still from the actual post. So a carousel full of genuinely useful information ends up hiding behind a random cover image, and three months later you have no idea what any of it was. This extension fixes that.

It scrolls through your saved posts, looks at each one with an AI vision model, reads what the post is actually about, and produces a clean **HTML page** (and a spreadsheet) where every post has a title, a category, a short description, and a direct link back to the original.

> **Note:** This is an unofficial personal-use tool. It is not affiliated with, endorsed by, or connected to Instagram or Meta.

---

## Why this exists

If you use Instagram to save educational or reference content, you have probably felt this:

- You save something useful "for later."
- Later arrives. You open your Saved tab.
- You are staring at a grid of thumbnails that tell you nothing — because the cover image is often a meme, a face, or an unrelated hook, not the content itself.
- You give up and never look at 90% of what you saved.

Instagram's saved-posts interface stopped being useful the moment creators started designing thumbnails for clicks instead of clarity. This tool reads the *content*, not just the cover, so your saved posts become an actual, searchable library instead of a graveyard.

## What you can do with the result

The extension gives you a downloadable HTML file. What you do with it is up to you:

- **Remember and revisit** — scan titles and descriptions instead of guessing from thumbnails, and click straight through to any post.
- **Clean up your account** — use it as a checklist to finally unsave the posts you no longer need.
- **Organize** — filter by category, mark the ones worth a second look, and build your own reference system.

---

## How it works

1. **Find** — it scrolls your Saved grid and collects the list of saved posts.
2. **Read** — for each post it fetches the cover image and caption, and sends them to a vision AI model, which writes a title, category, and description based on what is actually shown.
3. **Catalog** — results are saved as you go and exported as an HTML page or a CSV spreadsheet.

It works in **batches**, remembers what it has already done (so re-running only handles new saves), and paces itself to stay gentle on Instagram.

---

## Requirements

You need **your own AI API key**. There is no way around this, and getting one is the least beginner-friendly part — but the extension works with several providers, including ones with a free tier:

- **Google Gemini** (recommended, free) — get a key at [Google AI Studio](https://aistudio.google.com). Use the model `gemini-3.5-flash-lite`, which allows around 500 posts per day for free. (Avoid the regular Flash models — Google caps those at only 20 free requests per day.)
- **Groq**, **OpenRouter**, **OpenAI**, **Together**, **Cerebras**, or any other provider with an OpenAI-compatible endpoint also work — just pick the provider and paste your key.

Whichever you choose, the model **must be able to read images**. Your key is stored only on your own device and is sent only to the provider you pick.

---

## Installation

1. Download this repository (green **Code** button → **Download ZIP**) and unzip it.
2. Open Chrome and go to `chrome://extensions`.
3. Turn on **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the **`extension`** folder inside this project.
5. Pin the extension (puzzle-piece icon → pin) so its button is easy to reach.

## Setup

Click the extension icon and, in the popup:

1. **Provider** — pick one (e.g. Google Gemini). It fills in the web address automatically.
2. **API key** — paste your own key.
3. **Model** — leave the recommended `gemini-3.5-flash-lite`, or type another vision-capable model.
4. Click **Check my settings** to confirm everything works, then **Save**.

## Usage

On a desktop browser, go to Instagram → your profile → **Saved** → **All posts**, then use the popup:

1. **Find my saved posts** — optionally set how many to find, or leave it blank for all. You can pause finding at any time.
2. **Try the first 20** to trial it, then **Do the next 20** / **Do the rest** to process in batches. It pauses and resumes without losing progress, and it re-runs later only for new saves.
3. **Open visual page** (HTML) or **Download spreadsheet** (CSV) to get your catalog.

A small status box appears on the Instagram page while it runs, so you can see progress even with the popup closed. Click it once to enable sound (a cheerful chime when a batch finishes, a lower tone if it stalls) and to keep it running at full speed in the background.

---

## Tips

- **Instagram limits how fast anyone can request data.** If you push too hard, Instagram may temporarily slow you down or ask you to confirm your account. The extension paces itself and will stop and warn you if it detects this — if that happens, just wait a few hours and continue. Your progress is saved.
- **Big libraries:** with the free Gemini limit of ~500/day, a very large collection may take a couple of days. It resumes where it left off, so you can run it in sittings.
- **Import into Airtable:** the CSV imports cleanly into [Airtable](https://airtable.com) for a filterable database. The free plan holds 1,000 rows per base, so split a larger catalog across two bases.

## Limitations (being honest)

- It reads each post's **cover image and caption**. It does not yet open carousels to read slides 2+, and it cannot watch a reel's video or listen to its audio. For most posts the cover and caption are enough; for the rest, the link is right there so you can open the original.
- Captions on Instagram are often keyword-stuffed for reach, so the AI treats the image as the main source of truth and the caption as supporting context.
- This relies on Instagram's current page structure. If Instagram changes its layout, parts may need small updates (see `content.js`).

## Privacy

- Your API key stays on your device and is only sent to the AI provider you choose.
- Your catalog lives in your browser until you export it. Nothing is sent anywhere else.
- The extension only ever reads your *own* saved posts, in your *own* logged-in session.

---

## How this came to be

This started as a personal mini-project. The maker had well over a thousand saved Instagram posts — mostly genuinely useful educational content — and no realistic way to ever revisit them, because the saved grid is just thumbnails and modern thumbnails rarely reflect what a post is about. After ruling out manual sorting (impossible at that scale) and simple scripts (Instagram's captions are unreliable and the real content lives in the images), the answer became: let an AI actually *look* at each post. It went through many iterations, adding batch processing, pause and resume, multi-provider support, background running, and a visual catalog, before landing here.

## Contributing

Contributions and ideas are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Please also read the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

Released under the [MIT License](LICENSE).
