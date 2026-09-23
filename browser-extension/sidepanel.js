const selection = document.getElementById('selection')
const count = document.getElementById('count')
const source = document.getElementById('source')
const status = document.getElementById('status')
const appUrl = document.getElementById('appUrl')
const projectContext = document.getElementById('projectContext')
const settingsBody = document.getElementById('settingsBody')

function setStatus(message, type = '') {
  status.textContent = message
  status.dataset.type = type
}
function updateCount() { count.textContent = `${selection.value.length.toLocaleString()} characters` }
function validAppUrl(value) {
  try {
    const url = new URL(value)
    return /^https?:$/.test(url.protocol) ? url : null
  } catch { return null }
}
async function loadSettings() {
  const saved = await chrome.storage.sync.get(['anaAppUrl', 'anaGlossaryContext'])
  appUrl.value = saved.anaAppUrl || ''
  projectContext.value = saved.anaGlossaryContext || ''
  if (!saved.anaAppUrl) settingsBody.hidden = false
}
async function loadPendingSelection() {
  const saved = await chrome.storage.session.get('anaPendingSelection')
  const pending = saved.anaPendingSelection
  if (!pending?.text) return
  selection.value = pending.text
  source.textContent = pending.sourceTitle || ''
  updateCount()
  await chrome.storage.session.remove('anaPendingSelection')
  if (pending.action) document.querySelector(`[data-action="${pending.action}"]`)?.focus()
}
async function captureSelection() {
  setStatus('')
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) throw new Error('No active tab')
    const [{ result = '' } = {}] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => String(window.getSelection?.()?.toString?.() || '').trim(),
    })
    if (!result) return setStatus('Select some text on the page first.', 'warn')
    selection.value = result.slice(0, 8000)
    source.textContent = tab.title || ''
    updateCount()
  } catch {
    setStatus('Chrome does not allow selection capture on this page.', 'warn')
  }
}
async function openInAna(action) {
  const text = selection.value.trim().slice(0, 8000)
  if (!text) return setStatus('Select or paste some text first.', 'warn')
  const stored = await chrome.storage.sync.get(['anaAppUrl', 'anaGlossaryContext'])
  const url = validAppUrl(stored.anaAppUrl)
  if (!url) {
    settingsBody.hidden = false
    appUrl.focus()
    return setStatus('Set your Ana web app address once, then try again.', 'warn')
  }
  const payload = encodeURIComponent(JSON.stringify({
    version: 2,
    action,
    text,
    glossaryContext: String(stored.anaGlossaryContext || '').trim().slice(0, 120),
    sourceTitle: source.textContent || '',
  }))
  url.hash = `anaExt=${payload}`
  await chrome.tabs.create({ url: url.toString() })
  setStatus('Opened in Ana. Your Ana privacy and glossary settings apply.', 'ok')
}

selection.addEventListener('input', updateCount)
document.getElementById('capture').addEventListener('click', captureSelection)
document.getElementById('toggleSettings').addEventListener('click', () => { settingsBody.hidden = !settingsBody.hidden })
document.getElementById('saveUrl').addEventListener('click', async () => {
  const url = validAppUrl(appUrl.value.trim())
  if (!url) return setStatus('Enter a valid http or https Ana address.', 'warn')
  url.hash = ''
  url.search = ''
  await chrome.storage.sync.set({
    anaAppUrl: url.toString().replace(/\/$/, ''),
    anaGlossaryContext: projectContext.value.trim().slice(0, 120),
  })
  setStatus('Saved.', 'ok')
  settingsBody.hidden = true
})
document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => openInAna(button.dataset.action)))
Promise.all([loadSettings(), loadPendingSelection()]).catch(() => {})
