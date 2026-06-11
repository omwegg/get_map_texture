# get_map_texture

地図タイルを範囲指定でダウンロードし、1枚の画像に合成するツール。  
CLI / GUI / Chrome 拡張の 3 形態で利用可能。

## 対応ソース

| ソース | 最大ズーム | 備考 |
|---|---|---|
| ESRI 衛星画像 | 19 | 高解像度・グローバル |
| Google 衛星画像 | 21 | 最高解像度 |
| 地理院タイル 空中写真 | 18 | 日本国内 |
| 地理院タイル 標準地図 | 18 | 日本国内 |
| 地理院タイル 淡色地図 / 白地図 / 色別標高図 | 14〜18 | 日本国内 |

## 使い方

### CLI (`get_map_texture.py`)

```bash
pip install pillow
python get_map_texture.py
```

対話形式でタイル種類・緯度経度・タイル数・ズームレベルを入力。  
`export/` フォルダに合成画像が出力される。

### GUI (`get_map_texture_gui.py`)

```bash
pip install pillow
python get_map_texture_gui.py
```

- Google Maps で右クリック → 座標をコピー
- 「左上」「右下」にそれぞれ貼り付け
- タイル数が自動計算され、プレビュー付きでダウンロード

### Chrome 拡張 (`chrome_extension/`)

1. Chrome で `chrome://extensions` を開く
2. 「デベロッパー モード」を ON
3. 「パッケージ化されていない拡張機能を読み込む」→ `chrome_extension` フォルダを選択
4. Google Maps を開くと右下に 🗺️ ボタンが表示される

操作:
1. パネルで画像ソース・ズームレベルを選択
2. 「📍 範囲を選択」→ 地図上で左上・右下をクリック
3. タイル枚数を確認して「ダウンロード」

## タイルの仕組み

- タイルは 256×256 px の画像データ
- ズームレベル 0 が世界全体、1 上がるごとに解像度が縦横 2 倍
- PLATEAU の 3 次メッシュは地理院タイルのズームレベル 15 に対応

## ライセンス

- 地理院タイル: [国土地理院の利用規約](https://www.gsi.go.jp/kikakuchousei/kikakuchousei40182.html)
- ESRI World Imagery: [Esri の利用規約](https://www.esri.com/en-us/legal/terms/full-master-agreement)
- Google 衛星画像: [Google Maps Platform 利用規約](https://cloud.google.com/maps-platform/terms)

## Ref

- [PLATEAU の DEM ファイルに空中写真のテクスチャを貼りたい](https://qiita.com/yoshikawa-hiroyuki/items/6935a9705b3144774fd1)
