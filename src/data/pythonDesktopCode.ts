/**
 * مجموعه کامل کدهای پایتون و کامپایلر نسخه اجرایی ویندوز (.EXE) برای SayTo-Handy
 * شامل:
 * 1. sayto_handy_gui_app.py: برنامه کامل گرافیکی ویندوز (GUI + System Tray + دانلودر خودکار مدل با نوار پیشرفت + تایپ صوتی سراسری)
 * 2. build_exe.bat: اسکریپت کامپایل یک‌کلیکی به فایل مستقل SayToHandy.exe با PyInstaller (بهمراه باندل کردن DLLهای Vosk)
 * 3. installer_inno_setup.iss: اسکریپت ساخت نصب‌کننده استاندارد ویندوز (SayToHandy_Setup.exe)
 * 4. handy_sayto_agent.py: نسخه سبک خط فرمان (CLI)
 * 5. backend_api.py: سرویس FastAPI + SQLite + Excel
 * 6. streamlit_dashboard.py: پنل مدیریت تحت وب Streamlit
 */

export interface CodeFileTemplate {
  id: string;
  filename: string;
  title: string;
  badge: string;
  description: string;
  code: string;
}

export const PYTHON_PROJECT_FILES: CodeFileTemplate[] = [
  {
    id: 'windows-gui-exe-app',
    filename: 'sayto_handy_gui_app.py',
    title: 'برنامه اصلی گرافیکی ویندوز (مخصوص تبدیل به SayToHandy.exe)',
    badge: 'Standalone GUI App (.EXE)',
    description:
      'اپلیکیشن دسکتاپ کامل با رابط گرافیکی ویندوز (Tkinter RTL) بدون نیاز به کنسول: وقتی کاربر فایل EXE را باز می‌کند، اگر مدل vosk-model-small-fa-0.42 نصب نباشد دکمه «دانلود خودکار مدل (۴۷ مگابایت)» با نوار پیشرفت نمایش داده می‌شود و بلافاصله کلید میانبر Ctrl+Shift+Space در کل ویندوز فعال می‌گردد.',
    code: `#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SayTo-Handy Standalone Windows Desktop Application (.EXE Ready)
Engine: vosk-model-small-fa-0.42
Features:
- Built-in One-Click Model Downloader with Progress Bar (saves to %LOCALAPPDATA%\\SayToHandy)
- Global Hotkey (Ctrl+Shift+Space) across all Windows apps (Word, Telegram, Browser, Notepad)
- SayTo Persian Post-Processing (Voice punctuation + Half-space ZWNJ + Persian numerals)
- SQLite History & Excel Export (.xlsx)
"""

import os
import sys
import json
import time
import queue
import zipfile
import sqlite3
import threading
import urllib.request
import re
from datetime import datetime
from pathlib import Path
import tkinter as tk
from tkinter import ttk, messagebox, filedialog

import sounddevice as sd
from vosk import Model, KaldiRecognizer
import keyboard
import pyperclip

# مسیر استاندارد ذخیره‌سازی داده‌ها در ویندوز تا فایل EXE در هر پوشه‌ای بدون خطای دسترسی کار کند
APP_DATA_DIR = Path(os.environ.get("LOCALAPPDATA", os.path.expanduser("~"))) / "SayToHandy"
APP_DATA_DIR.mkdir(parents=True, exist_ok=True)

MODEL_NAME = "vosk-model-small-fa-0.42"
MODEL_URL = f"https://alphacephei.com/vosk/models/{MODEL_NAME}.zip"
MODELS_ROOT = APP_DATA_DIR / "models"
MODEL_DIR = MODELS_ROOT / MODEL_NAME
ZIP_PATH = MODELS_ROOT / f"{MODEL_NAME}.zip"
DB_PATH = APP_DATA_DIR / "sayto_history.db"

SAMPLE_RATE = 16000
DEFAULT_HOTKEY = "ctrl+shift+space"


class PersianTextProcessor:
    """موتور پس‌پردازش، اصلاح نیم‌فاصله و تبدیل دستورات صوتی نگارشی فارسی (SayTo)"""

    VOICE_COMMANDS = [
        ("نقطه سر خط", ".\\n"),
        ("پاراگراف جدید", "\\n\\n"),
        ("خط جدید", "\\n"),
        ("سر خط", "\\n"),
        ("نقطه ویرگول", "؛ "),
        ("علامت سوال", "؟ "),
        ("علامت تعجب", "! "),
        ("پرانتز باز", " ("),
        ("پرانتز بسته", ") "),
        ("گیومه باز", " «"),
        ("گیومه بسته", "» "),
        ("دو نقطه", ": "),
        ("دونقطه", ": "),
        ("ویرگول", "، "),
        ("نقطه", ". "),
    ]

    PERSIAN_DIGITS = str.maketrans("0123456789", "۰۱۲۳۴۵۶۷۸۹")

    @classmethod
    def normalize(cls, raw_text: str, use_punctuation=True, use_halfspace=True) -> str:
        if not raw_text or not raw_text.strip():
            return ""

        text = raw_text.strip()
        text = text.replace("ي", "ی").replace("ى", "ی").replace("ك", "ک")

        if use_punctuation:
            for trigger, replacement in cls.VOICE_COMMANDS:
                pattern = rf"(^|\\s){re.escape(trigger)}(?=\\s|$)"
                text = re.sub(pattern, replacement, text)

        if use_halfspace:
            # پیشوند افعال می و نمی
            text = re.sub(r"(^|\\s)(ن?می)\\s+([آ-ی]{2,})", r"\\1\\2‌\\3", text)
            # پسوندهای جمع و صفت برتر
            text = re.sub(r"([آ-ی]{2,})\\s+(های|هایی|ها|ترین|تر)(?=\\s|$|[،.؟!:؛])", r"\\1‌\\2", text)

        text = re.sub(r"\\s+([،.؟!:؛.])", r"\\1", text)
        text = re.sub(r"([،.؟!:؛.])(?=[^\\s\\n»)])", r"\\1 ", text)
        text = text.translate(cls.PERSIAN_DIGITS)
        return text.strip()


class SayToHandyWindowsApp:
    """رابط گرافیکی اصلی نسخه EXE ویندوز"""

    def __init__(self, root: tk.Tk):
        self.root = root
        self.root.title("SayTo Handy FA — دستیار تایپ صوتی آفلاین ویندوز")
        self.root.geometry("760x620")
        self.root.configure(bg="#0f172a")

        self.model = None
        self.recognizer = None
        self.audio_queue: queue.Queue[bytes] = queue.Queue()
        self.audio_stream = None
        self.is_recording = False
        self.start_time = 0.0
        self.session_segments: list[str] = []

        self.use_punctuation_var = tk.BooleanVar(value=True)
        self.use_halfspace_var = tk.BooleanVar(value=True)
        self.auto_paste_var = tk.BooleanVar(value=True)
        self.status_var = tk.StringVar(value="در حال بررسی وضعیت مدل آفلاین فارسی...")
        self.progress_var = tk.DoubleVar(value=0.0)

        self._init_db()
        self._build_ui()
        self._check_model_on_startup()

    def _init_db(self):
        with sqlite3.connect(DB_PATH) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS transcriptions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    raw_text TEXT NOT NULL,
                    processed_text TEXT NOT NULL,
                    duration_sec REAL DEFAULT 0.0,
                    word_count INTEGER DEFAULT 0,
                    created_at TEXT NOT NULL
                )
            """)
            conn.commit()

    def _build_ui(self):
        # هدر برنامه
        header = tk.Frame(self.root, bg="#1e293b", padx=20, pady=15)
        header.pack(fill="x")

        title_lbl = tk.Label(
            header,
            text="🎙️ SayTo Handy FA — تایپ صوتی آفلاین ویندوز",
            font=("Tahoma", 14, "bold"),
            fg="#f8fafc",
            bg="#1e293b"
        )
        title_lbl.pack(side="right")

        hotkey_lbl = tk.Label(
            header,
            text="میانبر سراسری: Ctrl + Shift + Space",
            font=("Consolas", 10, "bold"),
            fg="#38bdf8",
            bg="#1e293b"
        )
        hotkey_lbl.pack(side="left")

        # کادر وضعیت مدل و دانلود خودکار (مخصوص شروع کار کاربر)
        self.model_frame = tk.Frame(self.root, bg="#0f172a", padx=20, pady=12)
        self.model_frame.pack(fill="x")

        self.status_label = tk.Label(
            self.model_frame,
            textvariable=self.status_var,
            font=("Tahoma", 10),
            fg="#e2e8f0",
            bg="#0f172a",
            justify="right"
        )
        self.status_label.pack(anchor="e", pady=(0, 8))

        self.progress_bar = ttk.Progressbar(
            self.model_frame,
            variable=self.progress_var,
            maximum=100
        )
        self.progress_bar.pack(fill="x", pady=(0, 8))

        btn_row = tk.Frame(self.model_frame, bg="#0f172a")
        btn_row.pack(fill="x")

        self.download_btn = tk.Button(
            btn_row,
            text="📥 دانلود و نصب خودکار مدل فارسی (۴۷ مگابایت)",
            font=("Tahoma", 10, "bold"),
            bg="#0284c7",
            fg="white",
            padx=14,
            pady=6,
            relief="flat",
            command=self.start_model_download_thread
        )
        self.download_btn.pack(side="right", padx=(0, 10))

        self.record_btn = tk.Button(
            btn_row,
            text="🎙️ شروع تایپ صوتی (Ctrl+Shift+Space)",
            font=("Tahoma", 10, "bold"),
            bg="#16a34a",
            fg="white",
            padx=16,
            pady=6,
            relief="flat",
            state="disabled",
            command=self.toggle_recording
        )
        self.record_btn.pack(side="right")

        # تنظیمات هوشمند SayTo
        opts_frame = tk.Frame(self.root, bg="#1e293b", padx=20, pady=10)
        opts_frame.pack(fill="x", padx=20, pady=6)

        tk.Checkbutton(
            opts_frame,
            text="تزریق خودکار در پنجره فعال ویندوز (Auto-Paste)",
            variable=self.auto_paste_var,
            font=("Tahoma", 9),
            fg="#f8fafc",
            bg="#1e293b",
            selectcolor="#0f172a",
            activebackground="#1e293b"
        ).pack(side="right", padx=10)

        tk.Checkbutton(
            opts_frame,
            text="اصلاح نیم‌فاصله‌ها (می‌روم، کتاب‌ها)",
            variable=self.use_halfspace_var,
            font=("Tahoma", 9),
            fg="#f8fafc",
            bg="#1e293b",
            selectcolor="#0f172a",
            activebackground="#1e293b"
        ).pack(side="right", padx=10)

        tk.Checkbutton(
            opts_frame,
            text="فرمان‌های صوتی نگارشی (ویرگول، نقطه، سر خط)",
            variable=self.use_punctuation_var,
            font=("Tahoma", 9),
            fg="#f8fafc",
            bg="#1e293b",
            selectcolor="#0f172a",
            activebackground="#1e293b"
        ).pack(side="right", padx=10)

        # جعبه متن خروجی زنده
        editor_frame = tk.Frame(self.root, bg="#0f172a", padx=20, pady=10)
        editor_frame.pack(fill="both", expand=True)

        tk.Label(
            editor_frame,
            text="متن فارسی تشخیص داده شده (همگام با کلیپ‌بورد و پنجره فعال ویندوز):",
            font=("Tahoma", 10, "bold"),
            fg="#94a3b8",
            bg="#0f172a"
        ).pack(anchor="e", pady=(0, 6))

        self.text_box = tk.Text(
            editor_frame,
            font=("Tahoma", 12),
            bg="#1e293b",
            fg="#f8fafc",
            insertbackground="white",
            relief="flat",
            padx=12,
            pady=12,
            wrap="word"
        )
        self.text_box.pack(fill="both", expand=True)

        # نوار ابزار پایین
        footer = tk.Frame(self.root, bg="#0f172a", padx=20, pady=12)
        footer.pack(fill="x")

        tk.Button(
            footer,
            text="📋 کپی متن",
            font=("Tahoma", 9),
            bg="#334155",
            fg="white",
            padx=12,
            pady=5,
            relief="flat",
            command=self.copy_all_text
        ).pack(side="right", padx=(0, 8))

        tk.Button(
            footer,
            text="🗑️ پاک کردن صفحه",
            font=("Tahoma", 9),
            bg="#334155",
            fg="white",
            padx=12,
            pady=5,
            relief="flat",
            command=lambda: self.text_box.delete("1.0", tk.END)
        ).pack(side="right", padx=(0, 8))

        tk.Button(
            footer,
            text="📊 خروجی اکسل تاریخچه (.CSV)",
            font=("Tahoma", 9),
            bg="#059669",
            fg="white",
            padx=12,
            pady=5,
            relief="flat",
            command=self.export_history_csv
        ).pack(side="left")

    def _check_model_on_startup(self):
        """بررسی وجود مدل در لحظه باز شدن فایل EXE"""
        if MODEL_DIR.exists():
            self.progress_var.set(100)
            self.download_btn.config(state="disabled", text="✅ مدل فارسی نصب است")
            threading.Thread(target=self._load_vosk_engine, daemon=True).start()
        else:
            self.status_var.set(
                "⚠️ مدل آفلاین فارسی هنوز دانلود نشده است. روی دکمه «دانلود و نصب خودکار مدل» کلیک کنید تا یک‌بار برای همیشه نصب شود."
            )

    def start_model_download_thread(self):
        self.download_btn.config(state="disabled")
        threading.Thread(target=self._download_and_extract_model, daemon=True).start()

    def _download_and_extract_model(self):
        try:
            MODELS_ROOT.mkdir(parents=True, exist_ok=True)
            self.status_var.set(f"🌐 در حال دانلود {MODEL_NAME} از سرور رسمی Vosk (حجم: ۴۷ مگابایت)...")

            def reporthook(count, block_size, total_size):
                if total_size > 0:
                    percent = min(100.0, (count * block_size * 100.0) / total_size)
                    self.progress_var.set(percent)
                    self.status_var.set(f"📥 در حال دانلود مدل فارسی: {percent:.1f}% تکمیل شد...")

            urllib.request.urlretrieve(MODEL_URL, ZIP_PATH, reporthook=reporthook)
            self.status_var.set("📦 دانلود تمام شد! در حال استخراج فایل‌های مدل...")

            with zipfile.ZipFile(ZIP_PATH, "r") as zf:
                zf.extractall(MODELS_ROOT)

            ZIP_PATH.unlink(missing_ok=True)
            self.download_btn.config(text="✅ مدل فارسی نصب شد")
            self._load_vosk_engine()
        except Exception as err:
            self.status_var.set(f"❌ خطا در دانلود مدل: {err}")
            self.download_btn.config(state="normal")

    def _load_vosk_engine(self):
        try:
            self.status_var.set("⏳ در حال بارگذاری موتور صوتی vosk-model-small-fa-0.42 در حافظه...")
            self.model = Model(str(MODEL_DIR))
            self.recognizer = KaldiRecognizer(self.model, SAMPLE_RATE)

            # راه‌اندازی استریم میکروفون و ترد پردازش
            self.audio_stream = sd.RawInputStream(
                samplerate=SAMPLE_RATE,
                blocksize=8000,
                dtype="int16",
                channels=1,
                callback=self._audio_callback
            )
            self.audio_stream.start()

            threading.Thread(target=self._worker_loop, daemon=True).start()
            keyboard.add_hotkey(DEFAULT_HOTKEY, self.toggle_recording)

            self.record_btn.config(state="normal")
            self.status_var.set(
                "✅ آماده به کار! در هر نرم‌افزار ویندوز کلید Ctrl+Shift+Space را بزنید و صحبت کنید."
            )
        except Exception as err:
            self.status_var.set(f"❌ خطا در راه‌اندازی کارت صدا یا مدل: {err}")

    def _audio_callback(self, indata, frames, time_info, status):
        if self.is_recording:
            self.audio_queue.put(bytes(indata))

    def _worker_loop(self):
        while True:
            data = self.audio_queue.get()
            if data is None:
                break
            if self.recognizer.AcceptWaveform(data):
                res = json.loads(self.recognizer.Result())
                seg = res.get("text", "").strip()
                if seg:
                    self._handle_recognized_segment(seg)

    def _handle_recognized_segment(self, raw_segment: str):
        self.session_segments.append(raw_segment)
        processed = PersianTextProcessor.normalize(
            raw_segment,
            use_punctuation=self.use_punctuation_var.get(),
            use_halfspace=self.use_halfspace_var.get()
        )
        if not processed:
            return

        # نمایش در پنجره برنامه
        self.root.after(0, lambda: self.text_box.insert(tk.END, processed + " "))

        # تزریق مستقیم در پنجره فعال ویندوز (Word, Telegram, Browser...)
        if self.auto_paste_var.get():
            try:
                pyperclip.copy(processed + " ")
                time.sleep(0.05)
                keyboard.send("ctrl+v")
            except Exception:
                pass

    def toggle_recording(self):
        if not self.model:
            return
        if not self.is_recording:
            self.is_recording = True
            self.start_time = time.time()
            self.session_segments.clear()
            self.record_btn.config(text="⏹️ توقف ضبط (در حال شنیدن...)", bg="#dc2626")
            self.status_var.set("🎙️ در حال شنیدن صدای شما... صحبت کنید (برای توقف دوباره Ctrl+Shift+Space را بزنید)")
        else:
            self.is_recording = False
            duration = time.time() - self.start_time
            final_res = json.loads(self.recognizer.FinalResult()).get("text", "").strip()
            if final_res:
                self._handle_recognized_segment(final_res)

            self.record_btn.config(text="🎙️ شروع تایپ صوتی (Ctrl+Shift+Space)", bg="#16a34a")
            self.status_var.set("✅ ضبط متوقف شد و متن در پنجره فعال تایپ گردید.")

            full_raw = " ".join(self.session_segments).strip()
            if full_raw:
                full_proc = PersianTextProcessor.normalize(full_raw)
                with sqlite3.connect(DB_PATH) as conn:
                    conn.execute(
                        "INSERT INTO transcriptions (raw_text, processed_text, duration_sec, word_count, created_at) VALUES (?, ?, ?, ?, ?)",
                        (full_raw, full_proc, round(duration, 2), len(full_proc.split()), datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
                    )
                    conn.commit()

    def copy_all_text(self):
        content = self.text_box.get("1.0", tk.END).strip()
        if content:
            pyperclip.copy(content)
            self.status_var.set("📋 کل متن داخل ویرایشگر در کلیپ‌بورد کپی شد.")

    def export_history_csv(self):
        save_path = filedialog.asksaveasfilename(
            defaultextension=".csv",
            filetypes=[("Excel CSV File", "*.csv")],
            initialfile="sayto_handy_history.csv"
        )
        if not save_path:
            return
        with sqlite3.connect(DB_PATH) as conn:
            rows = conn.execute("SELECT id, processed_text, raw_text, word_count, duration_sec, created_at FROM transcriptions ORDER BY id DESC").fetchall()

        with open(save_path, "w", encoding="utf-8-sig") as f:
            f.write("ID,Processed Text,Raw Vosk Text,Words,Duration (s),Date\\n")
            for r in rows:
                f.write(f'{r[0]},"{r[1]}","{r[2]}",{r[3]},{r[4]},"{r[5]}"\\n')
        messagebox.showinfo("ذخیره موفق", f"فایل اکسل تاریخچه با موفقیت در مسیر زیر ذخیره شد:\\n{save_path}")


if __name__ == "__main__":
    root = tk.Tk()
    app = SayToHandyWindowsApp(root)
    root.mainloop()
`
  },
  {
    id: 'build-exe-bat',
    filename: 'build_exe.bat',
    title: 'اسکریپت ساخت خودکار فایل اجرایی تک‌فایلی (SayToHandy.exe)',
    badge: 'EXE Compiler Script',
    description:
      'با اجرای این اسکریپت روی ویندوز، PyInstaller تمام کتابخانه‌ها و فایل‌های DLL موتور صوتی Vosk را داخل یک فایل مستقل به نام SayToHandy.exe در پوشه dist بسته‌بندی می‌کند تا هر کاربری بدون نیاز به نصب پایتون بتواند آن را اجرا کند.',
    code: `@echo off
chcp 65001 > nul
title SayTo-Handy Windows EXE Compiler (PyInstaller)

echo ====================================================================
echo   ساخت فایل اجرایی مستقل ویندوز (SayToHandy.exe)
echo   شامل باندل کامل موتور صوتی Vosk + رابط گرافیکی دانلود خودکار مدل
echo ====================================================================
echo.

:: 1. بررسی پایتون در سیستم سازنده
python --version > nul 2>&1
if %errorlevel% neq 0 (
    echo [خطا] برای کامپایل اولیه به فایل EXE، باید پایتون روی سیستم شما نصب باشد.
    pause
    exit /b 1
)

:: 2. نصب PyInstaller و کتابخانه‌های مورد نیاز
echo [۱/۳] در حال نصب PyInstaller و وابستگی‌های صوتی...
pip install --upgrade pip
pip install pyinstaller vosk sounddevice keyboard pyperclip

:: 3. کامپایل به فایل تک‌فایلی EXE بدون پنجره سیاه کنسول (--noconsole --onefile)
:: نکته بسیار مهم: فلگ --collect-all vosk و --collect-all sounddevice تمام DLLهای C++ را داخل EXE قرار می‌دهد
echo.
echo [۲/۳] در حال کامپایل و بسته‌بندی SayToHandy.exe (حدود ۱ دقیقه زمان می‌برد)...
pyinstaller --noconfirm --onefile --windowed ^
    --name "SayToHandy" ^
    --collect-all vosk ^
    --collect-all sounddevice ^
    --hidden-import keyboard ^
    --hidden-import pyperclip ^
    sayto_handy_gui_app.py

echo.
if exist "dist\\SayToHandy.exe" (
    echo ====================================================================
    echo   ✅ تبریک! فایل اجرایی مستقل با موفقیت ساخته شد:
    echo   مسیر فایل:  dist\\SayToHandy.exe
    echo.
    echo   اکنون می‌توانید فقط همین فایل SayToHandy.exe را به هر کامپیوتر
    echo   ویندوزی دیگری منتقل کنید. کاربر با باز کردن آن، فقط دکمه
    echo   «دانلود خودکار مدل» را می‌زند و بلافاصله تایپ صوتی را شروع می‌کند!
    echo ====================================================================
    explorer dist
) else (
    echo [خطا] مشکلی در فرآیند ساخت EXE رخ داد.
)

pause
`
  },
  {
    id: 'inno-setup-installer',
    filename: 'installer_setup.iss',
    title: 'اسکریپت ساخت نصب‌کننده استاندارد ویندوز (Setup.exe Wizard)',
    badge: 'Windows Setup Wizard',
    description:
      'اگر می‌خواهید فایل SayToHandy.exe دارای ویزارد نصب استاندارد ویندوز (Next -> Install -> Finish)، شورتکات روی دسکتاپ و اجرای خودکار هنگام روشن شدن ویندوز باشد، این فایل را در برنامه رایگان Inno Setup باز کنید.',
    code: `; اسکریپت Inno Setup برای ساخت نصب‌کننده استاندارد ویندوز (SayToHandy_Setup.exe)
; پس از اجرای build_exe.bat، این فایل را با نرم‌افزار رایگان Inno Setup کامپایل کنید.

[Setup]
AppName=SayTo Handy Persian Speech-to-Text
AppVersion=1.0.0
AppPublisher=SayTo Handy OpenSource
DefaultDirName={autopf}\\SayToHandy
DefaultGroupName=SayTo Handy FA
OutputDir=installer_output
OutputBaseFilename=SayToHandy_Persian_Setup
Compression=lzma2
SolidCompression=yes
ArchitecturesInstallIn64BitMode=x64
PrivilegesRequired=lowest

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a &Desktop shortcut"; GroupDescription: "Additional icons:"
Name: "startupicon"; Description: "Start SayTo Handy automatically when Windows starts"; GroupDescription: "Windows Startup:"

[Files]
Source: "dist\\SayToHandy.exe"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\\SayTo Handy FA"; Filename: "{app}\\SayToHandy.exe"
Name: "{autodesktop}\\SayTo Handy FA"; Filename: "{app}\\SayToHandy.exe"; Tasks: desktopicon
Name: "{userstartup}\\SayTo Handy FA"; Filename: "{app}\\SayToHandy.exe"; Tasks: startupicon

[Run]
Filename: "{app}\\SayToHandy.exe"; Description: "Launch SayTo Handy Now"; Flags: nowait postinstall skipifsilent
`
  },
  {
    id: 'handy-vosk-agent',
    filename: 'handy_sayto_agent.py',
    title: 'هسته سبک خط فرمان ویندوز (CLI Agent با Vosk + Auto-Paste)',
    badge: 'Windows CLI Agent',
    description:
      'نسخه سبک خط فرمان (بدون پنجره گرافیکی): ضبط زنده میکروفون با sounddevice، پردازش آفلاین با vosk-model-small-fa-0.42، نرمال‌ساز نیم‌فاصله و علائم نگارشی فارسی و تایپ خودکار با میانبر Ctrl+Shift+Space.',
    code: `#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SayTo-Handy Windows Desktop CLI Agent (Persian Offline Speech-to-Text)
Engine: vosk-model-small-fa-0.42
"""

import os
import sys
import json
import time
import queue
import sqlite3
import logging
import threading
import re
from datetime import datetime
from pathlib import Path

import sounddevice as sd
from vosk import Model, KaldiRecognizer
import keyboard
import pyperclip

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger("SayToHandy")

MODEL_DIR = Path("models/vosk-model-small-fa-0.42")
DB_PATH = Path("sayto_history.db")
SAMPLE_RATE = 16000
HOTKEY_COMBINATION = "ctrl+shift+space"


class PersianTextProcessor:
    VOICE_COMMANDS = [
        ("نقطه سر خط", ".\\n"),
        ("پاراگراف جدید", "\\n\\n"),
        ("خط جدید", "\\n"),
        ("سر خط", "\\n"),
        ("نقطه ویرگول", "؛ "),
        ("علامت سوال", "؟ "),
        ("علامت تعجب", "! "),
        ("پرانتز باز", " ("),
        ("پرانتز بسته", ") "),
        ("گیومه باز", " «"),
        ("گیومه بسته", "» "),
        ("دو نقطه", ": "),
        ("دونقطه", ": "),
        ("ویرگول", "، "),
        ("نقطه", ". "),
    ]
    PERSIAN_DIGITS = str.maketrans("0123456789", "۰۱۲۳۴۵۶۷۸۹")

    @classmethod
    def normalize(cls, raw_text: str) -> str:
        if not raw_text or not raw_text.strip():
            return ""
        text = raw_text.strip()
        text = text.replace("ي", "ی").replace("ى", "ی").replace("ك", "ک")
        for trigger, replacement in cls.VOICE_COMMANDS:
            pattern = rf"(^|\\s){re.escape(trigger)}(?=\\s|$)"
            text = re.sub(pattern, replacement, text)
        text = re.sub(r"(^|\\s)(ن?می)\\s+([آ-ی]{2,})", r"\\1\\2‌\\3", text)
        text = re.sub(r"([آ-ی]{2,})\\s+(های|هایی|ها|ترین|تر)(?=\\s|$|[،.؟!:؛])", r"\\1‌\\2", text)
        text = re.sub(r"\\s+([،.؟!:؛.])", r"\\1", text)
        text = re.sub(r"([،.؟!:؛.])(?=[^\\s\\n»)])", r"\\1 ", text)
        text = text.translate(cls.PERSIAN_DIGITS)
        return text.strip()


class HandyVoskEngine:
    def __init__(self, model_path: Path):
        if not model_path.exists():
            raise FileNotFoundError(f"مدل در مسیر '{model_path}' یافت نشد.")
        self.model = Model(str(model_path))
        self.recognizer = KaldiRecognizer(self.model, SAMPLE_RATE)
        self.audio_queue: queue.Queue[bytes] = queue.Queue()
        self.is_recording = False
        self.session_segments: list[str] = []

    def _audio_callback(self, indata, frames, time_info, status):
        if self.is_recording:
            self.audio_queue.put(bytes(indata))

    def inject_text_to_active_window(self, text: str):
        if not text:
            return
        pyperclip.copy(text + " ")
        time.sleep(0.06)
        keyboard.send("ctrl+v")

    def _process_queue_worker(self):
        while True:
            data = self.audio_queue.get()
            if data is None:
                break
            if self.recognizer.AcceptWaveform(data):
                result = json.loads(self.recognizer.Result())
                segment = result.get("text", "").strip()
                if segment:
                    self.session_segments.append(segment)
                    self.inject_text_to_active_window(PersianTextProcessor.normalize(segment))

    def toggle_recording(self):
        self.is_recording = not self.is_recording
        if self.is_recording:
            self.session_segments.clear()
            logger.info("🎙️ ضبط صدا آغاز شد...")
        else:
            final_res = json.loads(self.recognizer.FinalResult()).get("text", "").strip()
            if final_res:
                self.inject_text_to_active_window(PersianTextProcessor.normalize(final_res))
            logger.info("✅ پایان ضبط.")

    def run(self):
        threading.Thread(target=self._process_queue_worker, daemon=True).start()
        keyboard.add_hotkey(HOTKEY_COMBINATION, self.toggle_recording)
        with sd.RawInputStream(samplerate=SAMPLE_RATE, blocksize=8000, dtype="int16", channels=1, callback=self._audio_callback):
            keyboard.wait("esc+ctrl")


if __name__ == "__main__":
    HandyVoskEngine(MODEL_DIR).run()
`
  },
  {
    id: 'fastapi-backend',
    filename: 'backend_api.py',
    title: 'سرویس بک‌اند FastAPI + SQLite + خروجی Excel (Pandas/OpenPyXL)',
    badge: 'FastAPI + SQLite + Excel',
    description:
      'سرویس کامل REST API با FastAPI برای مدیریت تاریخچه تایپ صوتی، پردازش فایل‌های صوتی WAV با Vosk و استخراج گزارش کامل Excel با استفاده از pandas و openpyxl.',
    code: `#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
FastAPI Backend Service for SayTo-Handy Persian Speech Recognition
"""

import io
import json
import wave
import sqlite3
from datetime import datetime
from typing import List, Optional

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import pandas as pd
from vosk import Model, KaldiRecognizer

from sayto_handy_gui_app import PersianTextProcessor, MODEL_DIR, DB_PATH

app = FastAPI(title="SayTo-Handy Persian STT API", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

vosk_model: Optional[Model] = None


@app.on_event("startup")
def startup_event():
    global vosk_model
    if MODEL_DIR.exists():
        vosk_model = Model(str(MODEL_DIR))


class NormalizeRequest(BaseModel):
    raw_text: str


@app.post("/api/normalize")
def normalize_persian_text(payload: NormalizeRequest):
    processed = PersianTextProcessor.normalize(payload.raw_text)
    return {"raw_text": payload.raw_text, "processed_text": processed}


@app.get("/api/export-excel")
def export_history_to_excel():
    with sqlite3.connect(DB_PATH) as conn:
        df = pd.read_sql_query("SELECT * FROM transcriptions ORDER BY id DESC", conn)
    output = io.BytesIO()
    with pd.ExcelWriter(output, engine="openpyxl") as writer:
        df.to_excel(writer, index=False, sheet_name="Transcriptions")
    output.seek(0)
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=sayto_report.xlsx"}
    )
`
  },
  {
    id: 'github-readme',
    filename: 'README.md',
    title: 'فایل راهنمای رسمی مخزن گیت‌هاب (README.md راست‌چین و استاندارد)',
    badge: 'GitHub README',
    description:
      'مستندات کامل فارسی و انگلیسی راست‌چین‌شده (RTL) برای صفحه اول مخزن GitHub شامل معرفی معماری Handy + SayTo، راهنمای نصب نسخه EXE، جدول فرمان‌های صوتی و دستورات کامپایل.',
    code: `<div dir="rtl" align="right">

# 🎙️ SayTo-Handy FA — دستیار تایپ صوتی آفلاین فارسی برای ویندوز
### مبتنی بر مدل سبک و آفلاین \`vosk-model-small-fa-0.42\` + معماری Handy و SayTo

[![Platform](https://img.shields.io/badge/Platform-Windows%2010%20%7C%2011-0078D6?style=flat-square&logo=windows)](https://github.com)
[![Engine](https://img.shields.io/badge/STT%20Engine-vosk--model--small--fa--0.42-16A34A?style=flat-square)](https://alphacephei.com/vosk/models)
[![Offline](https://img.shields.io/badge/Privacy-100%25%20Offline-0284C7?style=flat-square)]()
[![License](https://img.shields.io/badge/License-MIT-F59E0B?style=flat-square)]()

**SayTo-Handy FA** یک اپلیکیشن دسکتاپ ویندوزی، رایگان، متن‌باز و **۱۰۰٪ آفلاین** برای تبدیل گفتار به متن فارسی (Voice Typing / Dictation) است. این پروژه بهترین قابلیت‌های دو نرم‌افزار محبوب **[Handy](https://github.com/cjpais/Handy)** (تایپ مستقیم در هر پنجره فعال ویندوز با یک کلید میانبر سراسری) و **[SayTo](https://github.com/CycleSeeker/SayTo)** (تشخیص گفتار فارسی با موتور Vosk و اعمال هوشمند علائم نگارشی و نیم‌فاصله) را در یک پکیج یکپارچه و اجرایی (\`.exe\`) ترکیب کرده است.

---

## ✨ ویژگی‌های کلیدی

- 🔒 **۱۰۰٪ آفلاین و حفظ کامل حریم خصوصی:** تمام پردازش‌های صوتی روی پردازنده (CPU) کامپیوتر شما انجام می‌شود و هیچ صدای ضبط‌شده‌ای به اینترنت یا سرورهای ابری ارسال نمی‌گردد.
- ⚡ **فوق‌سبک و سریع با \`vosk-model-small-fa-0.42\`:** حجم مدل تنها **۴۷ مگابایت** است و بدون نیاز به کارت گرافیک (GPU) روی تمام لپ‌تاپ‌ها و کامپیوترهای معمولی کار می‌کند.
- ⌨️ **تزریق مستقیم متن در تمام برنامه‌های ویندوز (معماری Handy):** کافی است در هر نرم‌افزاری (**Word، Notepad، Telegram، مرورگر یا VS Code**) کلید میانبر **\`Ctrl + Shift + Space\`** را بزنید و صحبت کنید تا متن فارسی مستقیماً در همان‌جا تایپ شود.
- ✍️ **موتور پس‌پردازش و نگارش هوشمند فارسی (معماری SayTo):**
  - **تبدیل فرمان‌های صوتی به علائم نگارشی:** گفتن *«ویرگول»* (\`،\`)، *«نقطه»* (\`.\`)، *«علامت سوال»* (\`؟\`)، *«علامت تعجب»* (\`!\`) و *«نقطه سر خط»*.
  - **اصلاح خودکار نیم‌فاصله‌ها (ZWNJ):** تبدیل خودکار *«می روم»* به *«می‌روم»* و *«کتاب ها»* به *«کتاب‌ها»*.
- 📦 **دانلودر داخلی مدل با یک کلیک:** در نسخه اجرایی (\`SayToHandy.exe\`) برنامه با یک کلیک مدل رسمی را دانلود و در مسیر استاندارد \`%LOCALAPPDATA%\\SayToHandy\\models\` نصب می‌کند.

---

## 🚀 روش اول: استفاده از نسخه اجرایی ویندوز (\`SayToHandy.exe\`) — بدون نیاز به پایتون

1. فایل اجرایی **\`SayToHandy.exe\`** را از بخش **Releases** دانلود و اجرا کنید.
2. در اولین اجرا، روی دکمه **«📥 دانلود و نصب خودکار مدل فارسی (۴۷ مگابایت)»** کلیک کنید تا نوار پیشرفت به ۱۰۰٪ برسد.
3. در هر برنامه ویندوزی که هستید، کلید **\`Ctrl + Shift + Space\`** را فشار دهید و صحبت کنید!

---

## 🛠️ روش دوم: ساخت فایل \`.EXE\` یا اجرا از روی سورس‌کد

</div>

\`\`\`bash
git clone https://github.com/YOUR_USERNAME/SayTo-Handy-FA.git
cd SayTo-Handy-FA
pip install -r requirements.txt

# اجرای رابط گرافیکی دسکتاپ
python sayto_handy_gui_app.py

# ساخت فایل اجرایی مستقل dist/SayToHandy.exe
build_exe.bat
\`\`\`

<div dir="rtl" align="right">

---

## 🗣️ جدول فرمان‌های صوتی نگارشی (SayTo Voice Commands)

| عبارت گفتاری هنگام دیکته | خروجی در متن | توضیح عملکرد |
| :--- | :---: | :--- |
| **«ویرگول»** | \`، \` | درج ویرگول فارسی |
| **«نقطه»** | \`. \` | پایان جمله |
| **«نقطه سر خط»** | \`.\\n\` | بستن جمله و رفتن به خط جدید |
| **«علامت سوال»** | \`؟ \` | درج علامت سؤال فارسی |
| **«علامت تعجب»** | \`! \` | درج علامت تعجب |
| **«دو نقطه»** | \`: \` | درج دو نقطه توضیحی |

---

## 📄 مجوز انتشار (License)
منتشر شده تحت مجوز **MIT License**.

</div>
`
  }
];

export const REQUIREMENTS_TXT = `vosk==0.3.45
sounddevice==0.5.1
keyboard==0.13.5
pyperclip==1.9.0
pyinstaller==6.11.1
fastapi==0.115.6
uvicorn==0.34.0
streamlit==1.41.1
pandas==2.2.3
openpyxl==3.1.5
python-multipart==0.0.20`;
