# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A custom Chrome new tab extension (Manifest V3), built incrementally with vanilla HTML/CSS/JS — no build tools, no frameworks. Chrome APIs (storage, bookmarks, topSites) are added as features require.

## After Any Code Change

Reload the extension: open `chrome://extensions/`, click the reload icon on the extension card, then open a new tab to verify.

## Code Conventions

- No inline scripts or styles — CSP restriction in MV3 requires separate files.
- `const` over `let`; never `var`.
- `async/await` over `.then()` chains.
- 2-space indentation.
- No inline event handlers (`onclick="..."`) in HTML.

## Architecture

Single-page extension with no build step:

- `manifest.json` — declares the MV3 extension, maps the `newtab` override to `newtab.html`, and lists any required Chrome API permissions
- `newtab.html` — page shell; links CSS and JS (never inline either)
- `newtab.js` — all runtime logic; currently updates `#clock` every second
- `newtab.css` — full-viewport flex centering, dark theme
- `options.html` / `options.js` — settings page (planned, not yet added)
- `assets/` — images and icons (planned)

## Context

- Current MVP: greeting + live clock.
- Next planned feature: bookmarks grid.
- User is learning full-stack development — explain new Chrome APIs and non-obvious concepts when introducing them.
- Don't add build tools (webpack, vite) or frameworks (React, Vue) unless explicitly asked.
