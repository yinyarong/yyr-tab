# YYR Tab

A custom Chrome new tab extension that replaces the default new tab page with a personal dashboard — quick-access shortcuts at the top and a live view of all your open tabs below.

Built with vanilla HTML, CSS, and JavaScript. No frameworks, no build tools.

<img width="1470" height="833" alt="Screenshot 2026-04-19 at 05 49 59" src="https://github.com/user-attachments/assets/2c834178-61ff-479a-b21d-ae4c8f390a97" />
<img width="1470" height="833" alt="Screenshot 2026-04-19 at 05 51 52" src="https://github.com/user-attachments/assets/2d3d5764-dd90-4d31-858f-707b73ce0bb6" />


---

## Features

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
- Chips are automatically grouped by category — **Video**, **Social**, **AI**, **Dev**, and **Other** — with category labels separating the groups
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
├── newtab.html     # Page shell
├── newtab.css      # All styles
└── newtab.js       # All runtime logic
```

---

## Permissions Used

| Permission | Purpose |
|---|---|
| `tabs` | Read tab titles, URLs, and favicons; switch and close tabs |
| `storage` | Save shortcuts locally via `chrome.storage.local` |
| `bookmarks` | Read, edit, move, and delete Chrome bookmarks for the bookmarks bar |

---

## License

MIT License

Copyright (c) 2025 Yarong Yin

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
