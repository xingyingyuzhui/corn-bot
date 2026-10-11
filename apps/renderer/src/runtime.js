const status = document.getElementById('status')
async function refresh() {
  try {
    const view = await window.corn.runtimeStatus()
    status.textContent = view.message
  } catch {
    status.textContent = '运行时状态暂不可用。'
  }
}
void refresh()
setInterval(refresh, 800)
