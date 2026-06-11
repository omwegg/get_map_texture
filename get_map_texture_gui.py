import tkinter as tk
from tkinter import ttk, messagebox
import urllib.request
import os
import io
import math
import threading
from PIL import Image, ImageTk

# ── 定数 ────────────────────────────────────────────────

TILE_TYPES = [
    ("空中写真（シームレス）", "seamlessphoto", "jpg"),
    ("標準地図",             "std",           "png"),
    ("淡色地図",             "pale",          "png"),
    ("白地図",               "blank",         "png"),
    ("英語地図",             "english",       "png"),
    ("色別標高図",           "relief",        "png"),
]

TILE_SIZE = 256
ZOOM_LEVELS = [str(i) for i in range(1, 19)]
PREVIEW_MAX = 480
TILE_WARN_THRESHOLD = 100   # この枚数を超えたら確認ダイアログ


# ── 座標変換 ────────────────────────────────────────────

def latlng_to_tile(lat: float, lng: float, zoom: int) -> tuple[int, int]:
    """緯度経度 → タイル座標"""
    n = 2 ** zoom
    x = int((lng + 180.0) / 360.0 * n)
    lat_rad = math.radians(lat)
    y = int((1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n)
    return x, y


def parse_latlng(text: str) -> tuple[float, float] | None:
    """'35.6812, 139.7671' 形式の文字列をパースして (lat, lng) を返す"""
    parts = [s.strip() for s in text.replace("　", " ").split(",")]
    if len(parts) != 2:
        return None
    try:
        lat, lng = float(parts[0]), float(parts[1])
    except ValueError:
        return None
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        return None
    return lat, lng


# ── アプリケーション ────────────────────────────────────

class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("地理院タイル取得ツール")
        self.resizable(False, False)
        self._downloading = False
        self._preview_ref = None
        self._build_ui()

    # ── UI 構築 ─────────────────────────────────────────

    def _build_ui(self):
        pad = {"padx": 10, "pady": 5}

        # --- タイル種類 ---
        frm_type = ttk.LabelFrame(self, text="タイルの種類")
        frm_type.grid(row=0, column=0, sticky="ew", **pad)

        self.var_type = tk.StringVar(value=TILE_TYPES[0][0])
        ttk.Combobox(
            frm_type,
            textvariable=self.var_type,
            values=[t[0] for t in TILE_TYPES],
            state="readonly",
            width=30,
        ).pack(padx=10, pady=8)

        # --- ズームレベル ---
        frm_zoom = ttk.LabelFrame(self, text="ズームレベル (1〜18)")
        frm_zoom.grid(row=1, column=0, sticky="ew", **pad)

        self.var_zoom = tk.StringVar(value="15")
        ttk.Combobox(
            frm_zoom,
            textvariable=self.var_zoom,
            values=ZOOM_LEVELS,
            state="readonly",
            width=6,
        ).pack(padx=10, pady=8, anchor="w")
        self.var_zoom.trace_add("write", lambda *_: self._recalc())

        # --- 範囲指定 ---
        frm_area = ttk.LabelFrame(self, text="範囲指定（Google Maps の座標を貼り付け）")
        frm_area.grid(row=2, column=0, sticky="ew", **pad)

        ttk.Label(frm_area, text="左上:").grid(
            row=0, column=0, padx=(10, 4), pady=(10, 4), sticky="w"
        )
        self.var_tl = tk.StringVar(value="35.6812, 139.7671")
        ttk.Entry(frm_area, textvariable=self.var_tl, width=30).grid(
            row=0, column=1, padx=(4, 10), pady=(10, 4), sticky="w"
        )

        ttk.Label(frm_area, text="右下:").grid(
            row=1, column=0, padx=(10, 4), pady=4, sticky="w"
        )
        self.var_br = tk.StringVar(value="35.6600, 139.7900")
        ttk.Entry(frm_area, textvariable=self.var_br, width=30).grid(
            row=1, column=1, padx=(4, 10), pady=4, sticky="w"
        )

        ttk.Label(
            frm_area,
            text="💡 Google Maps で右クリック → 座標をコピー → 貼り付け",
            foreground="gray",
        ).grid(row=2, column=0, columnspan=2, padx=10, pady=(2, 4), sticky="w")

        # タイル情報の表示
        self.var_info = tk.StringVar(value="")
        ttk.Label(frm_area, textvariable=self.var_info, foreground="blue").grid(
            row=3, column=0, columnspan=2, padx=10, pady=(0, 8), sticky="w"
        )

        self.var_tl.trace_add("write", lambda *_: self._recalc())
        self.var_br.trace_add("write", lambda *_: self._recalc())

        # 初期計算
        self._recalc()

        # --- プログレスバー ---
        self.progress = ttk.Progressbar(self, orient="horizontal", mode="determinate")
        self.progress.grid(row=3, column=0, sticky="ew", **pad)

        # --- ボタン ---
        frm_btn = ttk.Frame(self)
        frm_btn.grid(row=4, column=0, pady=6)

        self.btn_start = ttk.Button(
            frm_btn, text="ダウンロード開始", command=self._start
        )
        self.btn_start.pack(side="left", padx=6)

        self.btn_open = ttk.Button(
            frm_btn, text="出力フォルダを開く", command=self._open_folder, state="disabled"
        )
        self.btn_open.pack(side="left", padx=6)

        # --- ステータス ---
        self.var_status = tk.StringVar(value="待機中")
        ttk.Label(self, textvariable=self.var_status, foreground="gray").grid(
            row=5, column=0, sticky="w", **pad
        )

        # --- プレビュー ---
        self.lbl_preview = ttk.Label(self)
        self.lbl_preview.grid(row=6, column=0, **pad)

    # ── 範囲計算 ───────────────────────────────────────

    def _recalc(self):
        """左上・右下の座標からタイル範囲を計算して表示"""
        tl = parse_latlng(self.var_tl.get())
        br = parse_latlng(self.var_br.get())
        if tl is None or br is None:
            self.var_info.set("座標を正しく入力してください  (例: 35.6812, 139.7671)")
            return

        try:
            zoom = int(self.var_zoom.get())
        except ValueError:
            return

        lat_tl, lng_tl = tl
        lat_br, lng_br = br

        x1, y1 = latlng_to_tile(lat_tl, lng_tl, zoom)
        x2, y2 = latlng_to_tile(lat_br, lng_br, zoom)

        # 左上・右下が逆でも正しく処理
        x_min, x_max = min(x1, x2), max(x1, x2)
        y_min, y_max = min(y1, y2), max(y1, y2)

        cx = x_max - x_min + 1
        cy = y_max - y_min + 1
        total = cx * cy

        self.var_info.set(
            f"→ タイル X: {x_min}〜{x_max},  Y: {y_min}〜{y_max}"
            f"    ({cx} × {cy} = {total} 枚)"
        )

    def _get_tile_range(self) -> tuple[int, int, int, int, int] | None:
        """左上・右下の座標からタイル範囲を返す。無効な場合は None"""
        tl = parse_latlng(self.var_tl.get())
        br = parse_latlng(self.var_br.get())
        if tl is None:
            messagebox.showerror("入力エラー", "左上の座標を正しく入力してください。\n例: 35.6812, 139.7671")
            return None
        if br is None:
            messagebox.showerror("入力エラー", "右下の座標を正しく入力してください。\n例: 35.6600, 139.7900")
            return None

        zoom = int(self.var_zoom.get())
        x1, y1 = latlng_to_tile(tl[0], tl[1], zoom)
        x2, y2 = latlng_to_tile(br[0], br[1], zoom)

        x_min, x_max = min(x1, x2), max(x1, x2)
        y_min, y_max = min(y1, y2), max(y1, y2)

        cx = x_max - x_min + 1
        cy = y_max - y_min + 1
        total = cx * cy

        if total > TILE_WARN_THRESHOLD:
            ok = messagebox.askyesno(
                "タイル数の確認",
                f"ダウンロードするタイル数が {total} 枚 ({cx} × {cy}) です。\n\n"
                f"続行しますか？",
            )
            if not ok:
                return None

        return x_min, y_min, cx, cy, zoom

    def _tile_info(self):
        label = self.var_type.get()
        for lbl, name, ext in TILE_TYPES:
            if lbl == label:
                return name, ext
        return TILE_TYPES[0][1], TILE_TYPES[0][2]

    # ── ダウンロード制御 ────────────────────────────────

    def _start(self):
        if self._downloading:
            return

        result = self._get_tile_range()
        if result is None:
            return
        x0, y0, cx, cy, zoom = result
        tile_type, tile_ext = self._tile_info()

        self._downloading = True
        self.btn_start.config(state="disabled")
        self.btn_open.config(state="disabled")
        self.progress["value"] = 0
        self.lbl_preview.config(image="")
        self._preview_ref = None

        threading.Thread(
            target=self._download_worker,
            args=(x0, y0, cx, cy, str(zoom), tile_type, tile_ext),
            daemon=True,
        ).start()

    def _download_worker(self, x0, y0, cx, cy, zoom, tile_type, tile_ext):
        total = cx * cy
        canvas = Image.new("RGB", (TILE_SIZE * cx, TILE_SIZE * cy))
        failed = 0

        for row, y in enumerate(range(y0, y0 + cy)):
            for col, x in enumerate(range(x0, x0 + cx)):
                idx = row * cx + col + 1
                self.after(
                    0, self._set_status,
                    f"ダウンロード中 [{idx}/{total}] — タイル ({x}, {y})",
                )

                tile = self._fetch_tile(tile_type, zoom, x, y, tile_ext)
                if tile is None:
                    failed += 1
                    tile = Image.new("RGB", (TILE_SIZE, TILE_SIZE), (180, 180, 180))
                canvas.paste(tile, (col * TILE_SIZE, row * TILE_SIZE))

                self.after(0, self._set_progress, idx / total * 100)

        # 保存
        export_dir = "export"
        os.makedirs(export_dir, exist_ok=True)
        filename = f"{tile_type}_{zoom}_{x0}_{y0}_{cx}x{cy}.jpg"
        out_path = os.path.join(export_dir, filename)
        canvas.save(out_path, quality=95)

        self.after(0, self._on_done, out_path, canvas, failed)

    @staticmethod
    def _fetch_tile(tile_type, zoom, x, y, ext):
        url = f"https://cyberjapandata.gsi.go.jp/xyz/{tile_type}/{zoom}/{x}/{y}.{ext}"
        try:
            with urllib.request.urlopen(url, timeout=15) as resp:
                return Image.open(io.BytesIO(resp.read())).convert("RGB")
        except Exception:
            return None

    # ── GUI コールバック (メインスレッド) ────────────────

    def _set_status(self, text):
        self.var_status.set(text)

    def _set_progress(self, value):
        self.progress["value"] = value

    def _on_done(self, out_path, canvas, failed):
        self._downloading = False
        self.btn_start.config(state="normal")
        self.btn_open.config(state="normal")
        self.progress["value"] = 100

        msg = f"完了 — {out_path}  ({canvas.width}x{canvas.height} px)"
        if failed:
            msg += f"  ⚠ 失敗: {failed} 枚"
        self.var_status.set(msg)

        preview = canvas.copy()
        preview.thumbnail((PREVIEW_MAX, PREVIEW_MAX))
        self._preview_ref = ImageTk.PhotoImage(preview)
        self.lbl_preview.config(image=self._preview_ref)

    def _open_folder(self):
        path = os.path.abspath("export")
        if os.path.isdir(path):
            os.startfile(path)


# ── エントリーポイント ──────────────────────────────────

if __name__ == "__main__":
    App().mainloop()
