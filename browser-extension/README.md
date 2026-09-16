# Ana Browser Extension (internal MVP)

Manifest V3 companion extension for Chrome 116+.

## What it does

- Toolbar opens Ana in Chrome's Side Panel.
- Select text on any normal webpage and right-click for:
  - Translate with Ana
  - Rewrite with Ana
  - Explain with Ana
  - Reply with Ana
- You can also capture the current selection from the side panel.
- The extension does **not** call Ana's API directly and does not run AI in the background.
- Selected text is transferred to the Ana web app in the URL fragment (`#...`). URL fragments are not included in HTTP requests to the server. Ana reads it locally and immediately clears the fragment from the address bar.

## Install locally

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Choose **Load unpacked**.
4. Select this `browser-extension` folder.
5. Open the Ana side panel and enter the production Ana web app URL once.

## Permissions

- `sidePanel` — Ana companion UI beside the webpage.
- `contextMenus` — explicit right-click actions for selected text.
- `storage` — stores only the Ana app URL and one pending selection during the current browser session.
- `activeTab` + `scripting` — reads the current selection only after the user clicks **Capture selection**.

There are no broad host permissions and no persistent content script.
