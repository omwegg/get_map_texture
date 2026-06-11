# CLAUDE.md

このファイルは Claude Code (claude.ai/code) がこのリポジトリで作業する際のガイドです。

## プロジェクト概要

地図タイルを複数のソース（地理院・ESRI・Mapbox・Google）から取得し、1枚の画像に合成して保存するツール。CLI / GUI / Chrome 拡張の 3 形態があり、すべて同じコア処理（バウンディングボックス → タイル座標変換 → 256×256 タイルのグリッドダウンロード → キャンバスへの合成）を共有している。

## 現在のバージョンと状態

- **最新リリース**: v2.1.0（2026-06-11）
- **リポジトリ**: https://github.com/omwegg/get_map_texture
- **配布**: GitHub Releases で Chrome 拡張 ZIP を配布
- **ブランチ**: main のみ

## ファイル構成

```
get_map_texture/
├── CLAUDE.md                     # このファイル
├── README.md                     # ユーザー向けドキュメント（日本語）
├── .gitignore                    # export/, *.exe, __pycache__, .claude/
├── get_map_texture.py            # CLI（対話形式・地理院タイルのみ）
├── get_map_texture_gui.py        # GUI（tkinter・地理院タイルのみ）
├── get_map_texture.exe           # 旧バイナリ（レガシー、gitignore 対象外だが非推奨）
├── chrome_extension/             # Chrome 拡張（メイン開発対象）
│   ├── manifest.json             # Manifest V3、v2.1.0
│   ├── content.js                # メインロジック（約700行）
│   ├── content.css               # パネル・オーバーレイのスタイル
│   ├── background.js             # CORS プロキシ（最小限）
│   └── icons/                    # 16/48/128px アイコン
├── export/                       # 出力先（gitignore 済み）
└── .claude/                      # Claude Code 設定（gitignore 済み）
    └── settings.local.json       # ローカル権限設定
```

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

### 3 形態の処理フロー

すべて同じパイプラインに従う：

1. **入力** — バウンディングボックス（緯度経度 2 点 or タイル座標）＋ズームレベル＋タイルソースを指定
2. **座標変換** — `latlng_to_tile(lat, lng, zoom)` で緯度経度を Web Mercator のタイル XY に変換。Python (`math`) と JS (`Math`) でそれぞれ独立実装
3. **タイル取得** — 各 256×256 タイルを `{source_url}/{z}/{x}/{y}.{ext}` から HTTP 取得。失敗時はグレーのプレースホルダーで代替
4. **結合** — `(col * 256, row * 256)` の位置にタイルを貼り付け。Python は `PIL.Image.paste()`、Chrome 拡張は `<canvas>.drawImage()`
5. **出力** — JPEG（quality 95）で保存

### タイルソース一覧と URL パターン

ソースごとにパラメータの順序が異なるので注意：

| ソース | URL パターン | 注意点 |
|---|---|---|
| **地理院 (GSI)** | `/{z}/{x}/{y}.{ext}` | 標準 XYZ |
| **ESRI** | `/tile/{z}/{y}/{x}` | **Y が X の前**、拡張子なし |
| **Mapbox** | `/v4/mapbox.satellite/{z}/{x}/{y}.jpg90?access_token=TOKEN` | 標準 XYZ、トークン必須 |
| **Google** | `?x={x}&y={y}&z={z}` | クエリパラメータ、`mt0`〜`mt3` に負荷分散 |

### 利用規約上の制約（重要）

| ソース | 商用利用 | 一括 DL | 備考 |
|---|---|---|---|
| 地理院タイル | ✅ 可 | ✅ 可 | 出典表記が必要 |
| Mapbox | ✅ 可 | ✅ API 利用 OK | 月 75 万リクエスト無料 |
| ESRI | ⚠️ 非商用のみ | ❌ 禁止 | 商用は別途有償契約 |
| Google | ❌ 規約違反 | ❌ 禁止 | スクレイピング禁止。警告を表示している |

## Chrome 拡張の詳細 (`chrome_extension/`)

Manifest V3。4 ファイル構成。**開発の主対象**。

### content.js（約 700 行・メインファイル）

- **TILE_SOURCES 配列** — 8 ソース。各エントリーに `label`（UI 表示名）、`fileId`（ASCII ファイル名用）、`group`、`maxZoom`、`getUrl(z,x,y)` を持つ。`needsToken`（Mapbox 用）、`warnGoogle`（Google 警告用）のフラグもある
- **Mapbox トークン管理** — `getMapboxToken()` / `saveMapboxToken()` で `localStorage` に保存・読み込み。キー名は `gsi-mapbox-token`
- **parseMapUrl(url)** — Google Maps URL を 3 パターンでパース。`@lat,lng,Xz`（ズーム）、`@lat,lng,Xm`（メートル）、`@lat,lng,Xa`（3D アングル）。メートル/アングル形式は経験的な変換式 `zoom ≈ 25.6 - log₂(値)` を使用
- **URL ポーリング** — 1 秒間隔で `location.href` を監視。`cachedMapState` にフォールバック
- **範囲選択** — オーバーレイ → 2 クリック → マーカー + 矩形 → タイル範囲計算。キャンセル方法: ボタン再押下 / 右クリック / Escape キー
- **ダウンロード** — background.js プロキシ経由でタイル取得 → canvas 結合 → Blob JPEG で保存
- **ファイル名** — `{fileId}_z{zoom}_{xMin}_{yMin}_{cx}x{cy}.jpg`（ASCII のみ）

### content.css

- 全セレクタに `gsi-` プレフィックス（Google Maps との競合回避）
- 主要要素: `#gsi-panel`, `#gsi-overlay`, `.gsi-marker`, `.gsi-rect`, `#gsi-toggle`
- `#gsi-mapbox-token-area` — Mapbox 選択時のみ表示
- `#gsi-google-warn` — Google 選択時のみ表示（赤い警告バナー）
- `#gsi-license-note` — パネル下部の黄色い注意バナー（常時表示）

### background.js（最小限の CORS プロキシ）

- `{action: "fetchTile", url}` メッセージを受け取り、fetch → FileReader → data URL で返す
- `return true` で非同期レスポンス対応

### manifest.json

- `host_permissions`: `cyberjapandata.gsi.go.jp`, `server.arcgisonline.com`, `api.mapbox.com`, `mt0-3.google.com`
- 新しいタイルソース追加時は必ずドメインを追加すること

## GUI (`get_map_texture_gui.py`)

単一ファイルの tkinter アプリ。地理院タイルのみ対応。

- ダウンロードはデーモンスレッドで実行、GUI 更新は `self.after(0, callback)` でメインスレッドにディスパッチ
- `_preview_ref` 属性は `ImageTk.PhotoImage` の GC 防止のためだけに存在
- `TILE_WARN_THRESHOLD = 100` 枚超で確認ダイアログ

## CLI (`get_map_texture.py`)

単一ファイルの対話式スクリプト。地理院タイルのみ対応。`urllib.request` を直接使用（`requests` 依存なし）。

## 座標変換の重複実装

Web Mercator のタイル座標変換式は Python と JS に重複して実装されている。**変更時は両方を更新すること**：

```
tile_x = floor((lng + 180) / 360 * 2^zoom)
tile_y = floor((1 - asinh(tan(lat_rad)) / π) / 2 * 2^zoom)
```

Chrome 拡張にはさらに**逆変換**（ピクセル → 緯度経度）も実装されている。Google Maps 上でのクリック座標変換に使用し、地図コンテナの中心座標と寸法から算出する。

## タイルソースの追加手順

1. **Chrome 拡張**: `content.js` の `TILE_SOURCES` 配列に `label`・`fileId`・`group`・`maxZoom`・`getUrl(z, x, y)` を持つエントリーを追加。認証が必要なら `needsToken` のようなフラグとトークン管理を追加。`manifest.json` の `host_permissions` にドメインを追加
2. **GUI**: `get_map_texture_gui.py` の `TILE_TYPES` リストにエントリーを追加。現在は地理院のみ — Chrome 拡張の `getUrl` パターンと同様の URL リファクタリングが必要
3. **CLI**: `get_map_texture.py` の `TILE_TYPES` 辞書にエントリーを追加。GUI と同じ地理院限定の制約あり

## リリース手順

1. `manifest.json` の `version` を更新
2. README の ZIP ファイル名が `tile-downloader-chrome.zip` になっていることを確認
3. `git commit` & `git push`
4. Python で ZIP 作成: `zipfile.ZipFile('tile-downloader-chrome.zip', 'w')` で `chrome_extension/` を圧縮
5. `gh release create vX.Y.Z tile-downloader-chrome.zip -t "タイトル" -n "リリースノート"`
6. ZIP ファイルを削除

## 言語・コミット規約

- UI テキスト、コメントはすべて**日本語**
- 変数名は英語（キャメルケース）
- コミットメッセージは `[add]`、`[update]`、`[fix]` のような括弧プレフィックス + 日本語
- 例: `[add] Mapbox 衛星画像ソースを追加`、`[fix] ファイル名を ASCII のみに変更`

## 既知の制約・今後の改善候補

- **GUI / CLI は地理院タイルのみ** — Chrome 拡張と比べてソース対応が遅れている。ESRI / Mapbox 対応を入れるなら URL パターンのリファクタリングが必要
- **get_map_texture.exe** — 4 年前のレガシーバイナリ。削除を検討（現状 gitignore 対象外）
- **Google 衛星画像** — 規約違反のため、将来的に削除も検討。現状は警告付きで残している
- **Mapbox トークンのセキュリティ** — localStorage 保存のため、他のスクリプトからアクセス可能。Chrome 拡張の storage API に移行する余地あり
- **並列ダウンロード** — 現状はタイルを1枚ずつ順次取得。並列化で高速化可能
