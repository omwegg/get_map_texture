// ── タイル画像の取得プロキシ (CORS バイパス) ──────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action !== "fetchTile") return false;

  fetch(msg.url)
    .then((res) => {
      if (!res.ok) throw new Error(res.status);
      return res.blob();
    })
    .then(
      (blob) =>
        new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.readAsDataURL(blob);
        })
    )
    .then((dataUrl) => sendResponse({ dataUrl }))
    .catch((err) => sendResponse({ error: err.message }));

  return true; // 非同期レスポンス
});
