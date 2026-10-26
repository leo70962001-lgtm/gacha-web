// 複製到剪貼簿（使用者 2026-10-26：「複製編碼的時候要把編碼複製起來 直接可以貼上」）
//   先用 Clipboard API；被擋（claude.ai artifact 的 iframe、沒權限、舊瀏覽器）→ 隱藏的 textarea＋execCommand('copy')
//   兩個都不行回傳 false，呼叫的地方把內容秀出來讓人手動複製
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    /* 下面用舊方法 */
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none';
  document.body.append(ta);
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch (e) {
    ok = false;
  }
  ta.remove();
  return ok;
}
