# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A custom Chrome new tab extension (Manifest V3), built with vanilla HTML/CSS/JS — no build tools, no frameworks. Features a live tab dashboard, bookmarks bar, shortcut slots, theme switcher, chrome utils bar, and canvas firework effects.

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

- `manifest.json` — MV3 config; permissions: `tabs`, `storage`, `bookmarks`, `windows`; registers the `Cmd+B`/`Ctrl+B` command
- `background.js` — service worker; handles the `focus-or-open-newtab` command (focuses an existing new tab or opens one)
- `newtab.html` — page shell with all UI regions pre-declared; no inline JS or CSS
- `newtab.js` — all runtime logic (~1500 lines); organized in sections (see below)
- `newtab.css` — all styles; dark/light theming via `[data-theme]` on `<html>`

### newtab.js sections (in order)

1. **Shortcuts** — 12-slot grid stored in `chrome.storage.local`; empty/filled/editing slot builders; FLIP-animated pointer drag-and-drop to reorder slots; cross-tab sync via `chrome.storage.onChanged`
2. **Click firework** — canvas particle system (`#click-fx`); single rAF loop shared across all bursts; spawned on every non-interactive click
3. **Tab dashboard** — reads all windows/tabs via `chrome.windows.getAll({ populate: true })`; debounced re-render (100 ms) on tab/window Chrome events; tab search; cross-window drag-and-drop via HTML5 drag API
4. **Category classification** — assigns tabs to categories using: (1) bookmark folder name (priority), (2) URL pattern fallback. Results displayed as labeled groups inside each window row. `cachedBookmarkMap` is invalidated on any `chrome.bookmarks.*` change event.
5. **Bookmarks bar** — mirrors Chrome's Bookmarks Bar folder; folder items open a drill-down dropdown; bookmark drag-and-drop reorders via `chrome.bookmarks.move`; right-click context menu for edit/delete
6. **Theme switcher** — three modes: `day`, `night`, `system`; day and night each store a separate accent color; persisted to `chrome.storage.local`; cross-tab sync via `chrome.storage.onChanged`
7. **Chrome utils bar** — six static buttons (Settings, Flags, Extensions, Bookmarks, History, Downloads) that open Chrome internal pages via `chrome.tabs.create`
8. **Boot** — `DOMContentLoaded` handler wires all event listeners, then loads theme → shortcut → bookmarks bar → tab grid in sequence

### Key cross-cutting patterns

- **Cross-tab sync**: `chrome.storage.onChanged` is the single broadcast channel for theme and shortcut changes across all open new-tab pages. Bookmark events (`onCreated`, `onChanged`, `onMoved`, `onRemoved`, `onChildrenReordered`) serve the same role for the bookmarks bar.
- **Mutation pattern for shortcuts**: update in-memory state → `chrome.storage.local.set` → `renderShortcuts()` (idempotent). The storage write triggers the sync listener, which calls `applyShortcuts` in all tabs.
- **Two drag systems**: shortcuts use pointer events + FLIP animation; tab chips and bookmark items use HTML5 drag events (`dragstart`/`dragover`/`drop`). These are independent and must not be confused.
- **Favicon**: Google's favicon service (`https://www.google.com/s2/favicons?domain=…&sz=32`) for shortcuts; `sz=16` for bookmarks bar. `FALLBACK_FAVICON` is an inline SVG used on `img.error`.
