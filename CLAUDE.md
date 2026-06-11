# CLAUDE.md

このファイルは Claude Code (claude.ai/code) がこのリポジトリで作業する際のガイドです。

## プロジェクト概要

地図タイルを複数のソース（地理院・ESRI・Google）から取得し、1枚の画像に合成して保存するツール。CLI / GUI / Chrome 拡張の3形態があり、すべて同じコア処理（バウンディングボックス → タイル座標変換 → 256×256 タイルのグリッドダウンロード → キャンバスへの合成）を共有している。

## 実行方法

```bash
# CLI（対話形式）
pip install pillow
python get_map_texture.py

# GUI（tkinter）
python get_map_texture_gui.py

# Chrome 拡張 — chrome://extensions で chrome_extension/ を読み込む
```

出力先は `export/`（gitignore 済み）。

## アーキテクチャ

### 3つのエントリーポイント、1つのパイプライン

3形態すべてが同じ処理フローに従う：

1. **入力** — バウンディングボックス（緯度経度2点 or タイル座標）＋ズームレベル＋タイルソースを指定
2. **座標変換** — `latlng_to_tile(lat, lng, zoom)` で緯度経度を Web Mercator のタイル XY に変換。Python (`math`) と JS (`Math`) でそれぞれ独立実装。
3. **タイル取得** — 各 256×256 タイルを `{source_url}/{z}/{x}/{y}.{ext}` から HTTP 取得。失敗時はグレーのプレースホルダーで代替。
4. **結合** — `(col * 256, row * 256)` の位置にタイルを貼り付け。Python は `PIL.Image.paste()`、Chrome 拡張は `<canvas>.drawImage()`。
5. **出力** — JPEG（quality 95）で保存。

### タイルソースの URL パターン

ソースごとにパラメータの順序が異なるので注意：
- **地理院 (GSI)**: `/{z}/{x}/{y}.{ext}` — 標準 XYZ
- **ESRI**: `/tile/{z}/{y}/{x}` — **Y が X の前**、拡張子なし
- **Google**: `?x={x}&y={y}&z={z}` — クエリパラメータ、`mt0`〜`mt3` に負荷分散

### Chrome 拡張 (`chrome_extension/`)

Manifest V3。4ファイル構成：
- **content.js** — Google Maps ページに注入。UI（フローティングパネル・オーバーレイ・マーカー・矩形）、座標変換、キャンバス結合をすべて含むメインファイル（約600行）。
- **content.css** — パネルとオーバーレイのスタイル。Google Maps との競合を避けるため全セレクタに `gsi-` プレフィックス。
- **background.js** — 最小限のサービスワーカー。唯一の役割は CORS 回避のためのタイル取得プロキシ。content script が `{action: "fetchTile", url}` を送り、background が fetch して data URL を返す。
- **manifest.json** — `host_permissions` にすべてのタイルソースドメインを含める必要がある。

**content.js の要注意ポイント**: Google Maps URL のパース（`parseMapUrl`）。URL はビューポート状態を3つの形式でエンコードする — `@lat,lng,Xz`（ズーム）、`@lat,lng,Xm`（メートル）、`@lat,lng,Xa`（3Dアングル）。メートル/アングル形式は経験的な変換式 `zoom ≈ 25.6 - log₂(値)` を使用。1秒間隔のポーリングで最後にパース成功した状態をキャッシュしてフォールバックに使う。

### GUI (`get_map_texture_gui.py`)

単一ファイルの tkinter アプリ。ダウンロードはデーモンスレッドで実行し、GUI 更新は `self.after(0, callback)` でメインスレッドにディスパッチ。`_preview_ref` 属性は `ImageTk.PhotoImage` の GC 防止のためだけに存在する。

### CLI (`get_map_texture.py`)

単一ファイルの対話式スクリプト。地理院タイルのみ対応（ESRI/Google なし）。`urllib.request` を直接使用 — `requests` 依存なし。

## 座標変換

Web Mercator のタイル座標変換式は Python と JS に重複して実装されている。変更時は両方を更新すること：

```
tile_x = floor((lng + 180) / 360 * 2^zoom)
tile_y = floor((1 - asinh(tan(lat_rad)) / π) / 2 * 2^zoom)
```

Chrome 拡張にはさらに**逆変換**（ピクセル → 緯度経度）も実装されている。Google Maps 上でのクリック座標変換に使用し、地図コンテナの中心座標と寸法から算出する。

## タイルソースの追加方法

1. **Chrome 拡張**: `content.js` の `TILE_SOURCES` 配列に `label`・`group`・`maxZoom`・`getUrl(z, x, y)` を持つエントリーを追加。`manifest.json` の `host_permissions` にドメインを追加。
2. **GUI**: `get_map_texture_gui.py` の `TILE_TYPES` リストにエントリーを追加。現在は地理院のみ — Chrome 拡張の `getUrl` パターンと同様の URL リファクタリングが必要。
3. **CLI**: `get_map_texture.py` の `TILE_TYPES` 辞書にエントリーを追加。GUI と同じ地理院限定の制約あり。

## 言語・コミット規約

UI テキスト、コメント、変数名はすべて日本語。コミットメッセージは `[add]`、`[update]` のような日本語括弧プレフィックスを使う。
