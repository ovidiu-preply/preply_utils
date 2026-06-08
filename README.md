# Session Copier Chrome Extension

Chrome extension (Manifest V3) that copies `sessionid` cookie from one eligible tab to current tab and reloads current tab.

## What it does

- Adds page context menu: `Bring session id from`
- Shows source-tab submenu from open tabs matching:
  - `*.preply.com`
  - `*.preply.org`
  - `localhost`
  - `127.0.0.1`
- Copies `sessionid` cookie from selected source tab to current tab domain context
- Reloads current tab with cache bypass after successful cookie write

## Load unpacked extension

1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select this folder: `preply_utils`

## Usage

1. Open at least two eligible tabs (source + target).
2. Right-click inside target page.
3. Open `Bring session id from`.
4. Pick source tab from submenu.
5. Target tab reloads automatically on success.

## Manual verification checklist

1. **Menu visibility**
   - On non-eligible domain, menu hidden.
   - On eligible domain, menu visible.

2. **Submenu population**
   - Source list includes only eligible tabs.
   - Current tab excluded.

3. **Successful transfer**
   - Source tab has `sessionid`.
   - Selecting source reloads current tab.
   - Current tab becomes logged as source user.

4. **Failure cases**
   - Source has no `sessionid`: no reload, warning in extension service-worker console.
   - Incompatible domain/protocol for cookie set: no reload, warning in console.

## Notes

- Extension logs warnings/errors in service worker console (`chrome://extensions` -> extension -> `service worker` inspect).
- No popup UI in v1; all interactions done through page context menu.
