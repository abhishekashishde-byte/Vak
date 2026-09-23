# Ana Browser Extension (v0.2 internal)

Manifest V3 companion extension for Chrome/Edge 116+.

## What it does

- Toolbar opens Ana in the browser Side Panel.
- Select text on a normal webpage and right-click for:
  - Translate
  - Correct
  - Shorter
  - Friendly
  - Formal
  - German **du**
  - German **Sie**
  - Explain
  - Write reply
- You can also capture the current selection from the side panel.
- Optional **Project context** is passed to Ana so matching Project glossary rules can apply.
- The extension does **not** call AI providers directly and does not run AI in the background.
- Selected text is transferred to the Ana web app in the URL fragment (`#...`). URL fragments are not included in the HTTP request to the web server. Ana reads the fragment locally and clears it from the address bar.
- Once Ana opens, the signed-in Ana account, glossary and privacy settings—including Privacy Shield—handle the request.

## Install locally

1. Open `chrome://extensions` or `edge://extensions`.
2. Turn on **Developer mode**.
3. Choose **Load unpacked**.
4. Select this `browser-extension` folder.
5. Open the Ana side panel and enter the production Ana web app URL once.
6. Optionally set the Project context you are currently working in.

## Permissions

- `sidePanel` — Ana companion UI beside the webpage.
- `contextMenus` — explicit right-click actions for selected text.
- `storage` — stores the Ana app URL, optional project context, and one pending selection during the current browser session.
- `activeTab` + `scripting` — reads the current selection only after the user clicks **Capture selection**.

There are no broad host permissions and no persistent content script.
