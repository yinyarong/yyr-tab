# YYR Tab

A custom Chrome new tab extension that replaces the default new tab page with a personal dashboard — quick-access shortcuts at the top and a live view of all your open tabs below.

Built with vanilla HTML, CSS, and JavaScript. No frameworks, no build tools.
<img width="1310" height="751" alt="image" src="https://github.com/user-attachments/assets/1d70a2bd-95b6-4b1d-b0af-52af55b64f30" />

<img width="1310" height="751" alt="image" src="https://github.com/user-attachments/assets/7e060933-fae4-484e-98ce-a09c2f1abb75" />

---

## Features

### Chrome Utils Bar
- 6 color-coded quick-access buttons for Chrome built-in pages: **Settings**, **Flags**, **Extensions**, **Bookmarks**, **History**, **Downloads**
- Styled with subtle colors and brightness-on-hover effects
- Positioned at the bottom of the new tab page for easy access

### Keyboard Shortcut
- Press **Cmd+B** (Mac) or **Ctrl+B** (Windows/Linux/ChromeOS) to focus an existing YYR Tab or open a new one
- If multiple YYR Tabs are open in the current window, the shortcut focuses one and closes duplicates
- To change the shortcut key, visit `chrome://extensions/shortcuts` and find "Focus existing New Tab or open a new one"

### Shortcuts Grid
- 12 customisable shortcut slots arranged in a 6 × 2 grid
- Each slot displays the site's favicon and name inside a circular button, matching Chrome's default new tab style
- Click any filled slot to open the site in a new tab
- Click an empty slot to add a shortcut — enter a name and URL directly on the page (no popups)
- Right-click a filled slot to **Edit** or **Remove** it
- All shortcuts are saved locally using `chrome.storage.local` and persist across browser restarts

### Bookmarks Bar
- Mirrors your Chrome bookmarks bar directly below the shortcuts grid
- Click a bookmark to open it in a new tab; click a folder to open a dropdown listing its contents
- Dropdowns support drill-down into sub-folders, with a back button to return
- Right-click any bookmark or folder to **Edit** (rename / change URL) or **Delete**
- **Drag-and-drop** to reorganise: drag any item inside a dropdown and drop it at a different position to reorder, or drop it into another folder to move it
  - Hovering a top-level folder button while dragging auto-opens that folder's dropdown after ~400ms
  - Hovering a sub-folder row inside a dropdown drills into it the same way, so you can drop into deeply nested folders
  - A blue insertion line shows exactly where the item will land
- All changes are persisted via the Chrome bookmarks API, so they stay in sync with the browser's native bookmarks

### Tab Dashboard
- Shows every open Chrome window as a full-width row
- Tabs within each window are displayed as compact horizontal chips (favicon + title)
- Chips are automatically grouped by category with category labels separating the groups:
  - **Bookmark-folder categories** (derived from your bookmarks) appear first, sorted alphabetically
  - Standard categories — **Video**, **Social**, **AI**, **Dev** — follow in order
  - **Other** (unmatched tabs) appears last
  - Categories are determined by matching open tab URLs against your bookmarks; if a tab's URL matches a bookmarked URL inside a named folder, that folder name becomes the tab's category
- Multiple tabs in the same category stack vertically within their group
- Click a chip to switch to that tab and bring its window to the front
- Hover over a chip to reveal a × button that closes the tab
- The dashboard updates live as tabs open, close, move, or change title — no manual refresh needed

### Search
- A search box above the dashboard filters tabs in real time by title or URL
- Windows with no matching tabs are hidden automatically
- Search state is preserved across live re-renders

---

## Installation

### From Source (Manual Setup)

No build step is required. The extension runs directly from the project folder.

1. **Clone or download** this repository to your local machine:
   ```bash
   git clone https://github.com/your-username/yyr-tab.git
   ```
   Or download and unzip the repository as a folder.

2. **Open Chrome** and navigate to:
   ```
   chrome://extensions/
   ```

3. **Enable Developer mode** using the toggle in the top-right corner.

4. Click **Load unpacked** and select the `yyr-tab` folder.

5. Open a new tab — the dashboard will appear immediately.

### After Any Code Change

Go to `chrome://extensions/`, click the **reload icon** (↺) on the YYR Tab card, then open a new tab to see the updated version.

---

## File Structure

```
yyr-tab/
├── manifest.json   # Extension config (Manifest V3)
├── background.js   # Service worker for keyboard shortcut handling
├── newtab.html     # Page shell
├── newtab.css      # All styles
└── newtab.js       # All runtime logic (UI, tab dashboard, bookmarks)
```

---

## Permissions Used

| Permission | Purpose |
|---|---|
| `tabs` | Read tab titles, URLs, and favicons; switch and close tabs |
| `windows` | Get the current window ID and focus windows for the keyboard shortcut handler |
| `storage` | Save shortcuts locally via `chrome.storage.local` |
| `bookmarks` | Read, edit, move, and delete Chrome bookmarks for the bookmarks bar and tab categorization |

---

## License

MIT License

Copyright (c) 2025 Yarong Yin

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
