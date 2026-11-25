# Changelog

## Application improvements — 2026-11

- Shared navigation and consistent layouts across browsing, search, detail, player and sign-in pages.
- Continuous movie and series catalogues, five-card rows, genre navigation and expanding trailer previews.
- Featured recommendations, movie and series previews, and full-picture banner trailers.
- Search keyboard, genre shortcuts, result counts, clear-search and retry controls.
- Saved-list and Continue Watching presentation, with improved resume reporting.
- Collection cards, numbered release-order browsing and collection artwork support.
- Episode runtimes, remaining-time labels, and clearer playback menus.

The optional `tools/scan-aspect-ratios.py` script estimates picture ratios using
FFmpeg without modifying movies or playback. Its results are estimates, are not
shown automatically in the app, and are not applied as cropping instructions.
See `tools/ASPECT-RATIOS.md`.

For local viewing, use a production build (`npm run build`, then `npm run start`)
with your own environment configuration. Stop the local server before rebuilding.
Use `npm run dev` when editing source.
