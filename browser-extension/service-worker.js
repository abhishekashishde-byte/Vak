const MENU = [
  ['ana-translate', 'Translate with Ana', 'translate'],
  ['ana-correct', 'Correct with Ana', 'correct'],
  ['ana-shorter', 'Make shorter with Ana', 'shorter'],
  ['ana-friendly', 'Make friendly with Ana', 'friendly'],
  ['ana-formal', 'Make formal with Ana', 'formal'],
  ['ana-du', 'German: use du', 'du'],
  ['ana-sie', 'German: use Sie', 'sie'],
  ['ana-explain', 'Explain with Ana', 'explain'],
  ['ana-reply', 'Reply with Ana', 'reply'],
]

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    for (const [id, title] of MENU) chrome.contextMenus.create({ id, title, contexts: ['selection'] })
  })
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {})
})

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const item = MENU.find(([id]) => id === info.menuItemId)
  if (!item || !tab?.id) return
  const text = String(info.selectionText || '').trim().slice(0, 8000)
  if (!text) return

  await chrome.storage.session.set({
    anaPendingSelection: {
      action: item[2],
      text,
      sourceTitle: tab.title || '',
      capturedAt: Date.now(),
    },
  })

  try { await chrome.sidePanel.open({ tabId: tab.id }) } catch {}
})
