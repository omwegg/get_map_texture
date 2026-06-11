import urllib.request
import os
import io
from PIL import Image

TILE_TYPES = {
    "1": ("seamlessphoto", "jpg", "空中写真（シームレス）"),
    "2": ("std",           "png", "標準地図"),
    "3": ("pale",          "png", "淡色地図"),
    "4": ("blank",         "png", "白地図"),
    "5": ("english",       "png", "英語地図"),
    "6": ("relief",        "png", "色別標高図"),
}

TILE_SIZE = 256


def select_tile_type() -> tuple[str, str]:
    print("\n利用可能なタイルの種類:")
    for k, (name, ext, label) in TILE_TYPES.items():
        print(f"  {k}: {label}  ({name})")
    key = input("\nタイルの種類を選択 [デフォルト: 1 (空中写真)] : ").strip() or "1"
    if key not in TILE_TYPES:
        print("無効な選択です。空中写真を使用します。")
        key = "1"
    name, ext, label = TILE_TYPES[key]
    print(f"選択: {label}")
    return name, ext


def get_inputs() -> tuple[int, int, int, int, str, str, str]:
    print("=== 地理院タイル取得ツール ===")
    tile_type, tile_ext = select_tile_type()

    x_start     = int(input("\n左上のタイルのx座標を入力 : "))
    y_start     = int(input("左上のタイルのy座標を入力 : "))
    count_x     = int(input("横方向のタイル数 : "))
    raw_y       = input(f"縦方向のタイル数 [Enter で横と同じ ({count_x})] : ").strip()
    count_y     = int(raw_y) if raw_y else count_x
    zoom        = input("ズームレベル (1〜18) [デフォルト: 15] : ").strip() or "15"

    return x_start, y_start, count_x, count_y, zoom, tile_type, tile_ext


def download_tile(tile_type: str, zoom: str, x: int, y: int, ext: str) -> Image.Image:
    url = f"https://cyberjapandata.gsi.go.jp/xyz/{tile_type}/{zoom}/{x}/{y}.{ext}"
    try:
        with urllib.request.urlopen(url, timeout=15) as resp:
            return Image.open(io.BytesIO(resp.read())).convert("RGB")
    except Exception as e:
        print(f"\n  警告: タイル ({x}, {y}) の取得に失敗しました — {e}")
        return Image.new("RGB", (TILE_SIZE, TILE_SIZE), color=(180, 180, 180))


def main() -> None:
    x_start, y_start, count_x, count_y, zoom, tile_type, tile_ext = get_inputs()

    total  = count_x * count_y
    canvas = Image.new("RGB", (TILE_SIZE * count_x, TILE_SIZE * count_y))

    print(f"\n{total} 枚のタイルをダウンロードしています...")

    for row, y in enumerate(range(y_start, y_start + count_y)):
        for col, x in enumerate(range(x_start, x_start + count_x)):
            idx = row * count_x + col + 1
            print(f"\r  [{idx:>{len(str(total))}}/{total}] タイル ({x}, {y}) ...", end="", flush=True)
            tile = download_tile(tile_type, zoom, x, y, tile_ext)
            canvas.paste(tile, (col * TILE_SIZE, row * TILE_SIZE))

    print("\nダウンロード完了!")

    export_dir = "export"
    os.makedirs(export_dir, exist_ok=True)
    filename   = f"{tile_type}_{zoom}_{x_start}_{y_start}_{count_x}x{count_y}.jpg"
    out_path   = os.path.join(export_dir, filename)
    canvas.save(out_path, quality=95)

    print(f"保存先   : {out_path}")
    print(f"画像サイズ: {canvas.width} x {canvas.height} px")


if __name__ == "__main__":
    main()
