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
    title: 'برنامه اصلی گرافیکی ویندوز با ظاهر مدرن Handy (CustomTkinter + Floating Pill Overlay)',
    badge: 'Modern Handy UI (.EXE)',
    description:
      'رابط گرافیکی کاملاً مدرن ویندوز ۱۱ با CustomTkinter دقیقاً مشابه نرم‌افزار Handy: شامل نوار کناری (Sidebar)، کارت‌های لبه‌گرد (Rounded Cards)، کلیدهای سوییچ مدرن (Pill Switches)، انتخابگر میکروفون، مدیریت مدل‌ها و «کپسول شناور ضبط صدا» (Floating Recording Pill Overlay) در پایین صفحه ویندوز با اکولایزر زنده.',
    code: `#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SayTo-Handy Modern Windows Desktop Application (.EXE Ready)
UI Framework: CustomTkinter (Modern Dark UI + Floating Recording Overlay Pill)
Engine: vosk-model-small-fa-0.42
Inspired directly by Handy (cjpais/Handy) & SayTo
"""

import os
import sys
import json
import time
import queue
import ctypes
import zipfile
import sqlite3
import traceback
import threading
import urllib.request
import re
from datetime import datetime
from pathlib import Path
import tkinter as tk
from tkinter import messagebox, filedialog

# ==============================================================================
# 1. PyInstaller _MEIPASS DLL Resolver & DPI Awareness for Crisp Windows 11 Font
# ==============================================================================
if sys.platform == "win32":
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(2)
    except Exception:
        try:
            ctypes.windll.user32.SetProcessDPIAware()
        except Exception:
            pass

if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
    base_meipass = Path(sys._MEIPASS)
    candidate_dll_dirs = [
        base_meipass,
        base_meipass / "vosk",
        base_meipass / "_sounddevice_data" / "portaudio-binaries",
    ]
    for dll_dir in candidate_dll_dirs:
        if dll_dir.exists():
            os.environ["PATH"] = str(dll_dir) + os.pathsep + os.environ.get("PATH", "")
            if hasattr(os, "add_dll_directory"):
                try:
                    os.add_dll_directory(str(dll_dir))
                except Exception:
                    pass

if getattr(sys, "frozen", False) and sys.platform == "win32":
    try:
        hwnd = ctypes.windll.kernel32.GetConsoleWindow()
        if hwnd:
            ctypes.windll.user32.ShowWindow(hwnd, 0)
    except Exception:
        pass

import customtkinter as ctk

# تنظیم تم تاریک مدرن مشابه Handy
ctk.set_appearance_mode("Dark")
ctk.set_default_color_theme("blue")

APP_DATA_DIR = Path(os.environ.get("LOCALAPPDATA", os.path.expanduser("~"))) / "SayToHandy"
APP_DATA_DIR.mkdir(parents=True, exist_ok=True)
LOG_FILE = APP_DATA_DIR / "sayto_error.log"

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
            text = re.sub(r"(^|\\s)(ن?می)\\s+([آ-ی]{2,})", r"\\1\\2‌\\3", text)
            text = re.sub(r"([آ-ی]{2,})\\s+(های|هایی|ها|ترین|تر)(?=\\s|$|[،.؟!:؛])", r"\\1‌\\2", text)

        text = re.sub(r"\\s+([،.؟!:؛.])", r"\\1", text)
        text = re.sub(r"([،.؟!:؛.])(?=[^\\s\\n»)])", r"\\1 ", text)
        text = text.translate(cls.PERSIAN_DIGITS)
        return text.strip()


class HandyFloatingOverlay(ctk.CTkToplevel):
    """
    کپسول شناور ضبط صدا (Handy Floating Overlay Bar)
    این پنجره کوچک بدون کادر در پایین صفحه ویندوز (Always on Top) ظاهر می‌شود
    و هنگام فشردن Ctrl+Shift+Space موج صدای زنده و متن در حال تشخیص را نشان می‌دهد.
    """

    def __init__(self, master, on_toggle_callback):
        super().__init__(master)
        self.on_toggle_callback = on_toggle_callback
        self.overrideredirect(True)
        self.attributes("-topmost", True)
        self.configure(fg_color="#090d16")

        # قرارگیری در پایین-مرکز صفحه نمایش ویندوز (دقیقاً مشابه Handy)
        pill_w, pill_h = 380, 56
        screen_w = self.winfo_screenwidth()
        screen_h = self.winfo_screenheight()
        pos_x = (screen_w - pill_w) // 2
        pos_y = screen_h - 125
        self.geometry(f"{pill_w}x{pill_h}+{pos_x}+{pos_y}")

        self.container = ctk.CTkFrame(
            self,
            fg_color="#111827",
            corner_radius=26,
            border_width=1,
            border_color="#334155"
        )
        self.container.pack(fill="both", expand=True, padx=2, pady=2)

        # دکمه دایره‌ای میکروفون / توقف
        self.mic_btn = ctk.CTkButton(
            self.container,
            text="🎙️",
            width=38,
            height=38,
            corner_radius=19,
            fg_color="#2563eb",
            hover_color="#1d4ed8",
            font=("Segoe UI Emoji", 14),
            command=self.on_toggle_callback
        )
        self.mic_btn.pack(side="left", padx=(10, 8), pady=8)

        # بوم اکولایزر صوتی زنده
        self.wave_canvas = tk.Canvas(
            self.container,
            width=120,
            height=28,
            bg="#111827",
            highlightthickness=0
        )
        self.wave_canvas.pack(side="left", padx=4)
        self.bars = []
        for i in range(16):
            x0 = i * 7 + 4
            bar = self.wave_canvas.create_rectangle(x0, 10, x0 + 4, 18, fill="#38bdf8", outline="")
            self.bars.append(bar)

        # وضعیت متن زنده داخل کپسول
        self.status_lbl = ctk.CTkLabel(
            self.container,
            text="آماده (Ctrl+Shift+Space)",
            font=("Segoe UI", 12, "bold"),
            text_color="#e2e8f0"
        )
        self.status_lbl.pack(side="right", padx=(6, 14))

        # قابلیت جابجایی کپسول با کشیدن ماوس
        self.container.bind("<ButtonPress-1>", self._start_move)
        self.container.bind("<B1-Motion>", self._on_move)
        self._drag_x = 0
        self._drag_y = 0

    def _start_move(self, event):
        self._drag_x = event.x
        self._drag_y = event.y

    def _on_move(self, event):
        x = self.winfo_x() + event.x - self._drag_x
        y = self.winfo_y() + event.y - self._drag_y
        self.geometry(f"+{x}+{y}")

    def set_recording_state(self, is_rec: bool, text_preview: str = ""):
        if is_rec:
            self.container.configure(border_color="#ef4444")
            self.mic_btn.configure(fg_color="#dc2626", hover_color="#b91c1c", text="⏹")
            display_txt = text_preview[-22:] if text_preview else "در حال شنیدن..."
            self.status_lbl.configure(text=display_txt, text_color="#fca5a5")
        else:
            self.container.configure(border_color="#334155")
            self.mic_btn.configure(fg_color="#2563eb", hover_color="#1d4ed8", text="🎙️")
            self.status_lbl.configure(text="آماده (Ctrl+Shift+Space)", text_color="#e2e8f0")
            self.update_waveform([4] * 16, active=False)

    def update_waveform(self, levels, active=True):
        color = "#38bdf8" if active else "#475569"
        for i, bar in enumerate(self.bars):
            val = levels[i % len(levels)]
            half = max(2, min(13, int(val)))
            x0 = i * 7 + 4
            self.wave_canvas.coords(bar, x0, 14 - half, x0 + 4, 14 + half)
            self.wave_canvas.itemconfig(bar, fill=color)


class SayToHandyModernApp(ctk.CTk):
    """پنجره اصلی تنظیمات و میز کار با طراحی مدرن Handy"""

    def __init__(self):
        super().__init__()
        self.title("Handy SayTo — Persian Offline Voice Typing")
        self.geometry("940x640")
        self.minsize(860, 580)
        self.configure(fg_color="#090d16")

        self.lift()
        self.attributes("-topmost", True)
        self.after(500, lambda: self.attributes("-topmost", False))

        # ماژول‌های صوتی
        self.sd = None
        self.vosk_module = None
        self.keyboard_module = None
        self.pyperclip_module = None

        self.model = None
        self.recognizer = None
        self.audio_queue: queue.Queue[bytes] = queue.Queue()
        self.audio_stream = None
        self.is_recording = False
        self.start_time = 0.0
        self.session_segments: list[str] = []

        # متغیرهای تنظیمات مدرن
        self.auto_paste_var = ctk.BooleanVar(value=True)
        self.use_halfspace_var = ctk.BooleanVar(value=True)
        self.use_punctuation_var = ctk.BooleanVar(value=True)
        self.show_overlay_var = ctk.BooleanVar(value=True)
        self.status_var = ctk.StringVar(value="در حال راه‌اندازی هسته صوتی...")
        self.hotkey_var = ctk.StringVar(value="ctrl+shift+space")

        self._init_db()
        self._build_layout()

        # ایجاد کپسول شناور Handy در پایین صفحه ویندوز
        self.overlay = HandyFloatingOverlay(self, self.toggle_recording)

        self.after(200, self._initialize_libraries_and_model)

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

    def _build_layout(self):
        self.grid_columnconfigure(0, weight=1)
        self.grid_columnconfigure(1, weight=0)
        self.grid_rowconfigure(0, weight=1)

        # ۱. نوار کناری سمت راست (Sidebar مشابه Handy)
        self.sidebar = ctk.CTkFrame(
            self,
            width=220,
            corner_radius=0,
            fg_color="#111827",
            border_width=1,
            border_color="#1e293b"
        )
        self.sidebar.grid(row=0, column=1, sticky="nsew")
        self.sidebar.grid_propagate(False)

        brand_frame = ctk.CTkFrame(self.sidebar, fg_color="transparent")
        brand_frame.pack(fill="x", padx=20, pady=(24, 20))

        ctk.CTkLabel(
            brand_frame,
            text="🎙️ Handy SayTo",
            font=("Segoe UI", 20, "bold"),
            text_color="#f8fafc"
        ).pack(anchor="e")

        ctk.CTkLabel(
            brand_frame,
            text="تایپ صوتی آفلاین ویندوز",
            font=("Segoe UI", 12),
            text_color="#64748b"
        ).pack(anchor="e")

        # دکمه‌های ناوبری Sidebar
        self.nav_buttons = {}
        nav_items = [
            ("home", "🏠  میز کار و تایپ زنده"),
            ("models", "🧠  مدل صوتی و میکروفون"),
            ("history", "📜  تاریخچه و خروجی اکسل"),
        ]
        for key, label in nav_items:
            btn = ctk.CTkButton(
                self.sidebar,
                text=label,
                anchor="e",
                height=42,
                corner_radius=10,
                font=("Segoe UI", 13, "bold"),
                fg_color="transparent",
                text_color="#cbd5e1",
                hover_color="#1e293b",
                command=lambda k=key: self.switch_page(k)
            )
            btn.pack(fill="x", padx=14, pady=4)
            self.nav_buttons[key] = btn

        # کارت راهنمای کلید میانبر در پایین سایدبار
        shortcut_card = ctk.CTkFrame(
            self.sidebar,
            fg_color="#1e293b",
            corner_radius=12,
            border_width=1,
            border_color="#334155"
        )
        shortcut_card.pack(side="bottom", fill="x", padx=14, pady=18)

        ctk.CTkLabel(
            shortcut_card,
            text="کلید میانبر سراسری ویندوز",
            font=("Segoe UI", 11),
            text_color="#94a3b8"
        ).pack(pady=(10, 2))

        ctk.CTkLabel(
            shortcut_card,
            text="Ctrl + Shift + Space",
            font=("Consolas", 13, "bold"),
            text_color="#38bdf8"
        ).pack(pady=(0, 10))

        # ۲. بخش محتوای اصلی (سمت چپ)
        self.main_area = ctk.CTkFrame(self, fg_color="#090d16", corner_radius=0)
        self.main_area.grid(row=0, column=0, sticky="nsew", padx=24, pady=24)
        self.main_area.grid_columnconfigure(0, weight=1)
        self.main_area.grid_rowconfigure(1, weight=1)

        # نوار وضعیت بالای صفحه + دکمه اصلی ضبط
        top_card = ctk.CTkFrame(
            self.main_area,
            fg_color="#111827",
            corner_radius=14,
            border_width=1,
            border_color="#1e293b"
        )
        top_card.grid(row=0, column=0, sticky="ew", pady=(0, 16))

        self.record_btn = ctk.CTkButton(
            top_card,
            text="🎙️ شروع تایپ صوتی",
            font=("Segoe UI", 13, "bold"),
            height=40,
            width=180,
            corner_radius=10,
            fg_color="#2563eb",
            hover_color="#1d4ed8",
            state="disabled",
            command=self.toggle_recording
        )
        self.record_btn.pack(side="left", padx=16, pady=14)

        self.status_lbl = ctk.CTkLabel(
            top_card,
            textvariable=self.status_var,
            font=("Segoe UI", 13),
            text_color="#e2e8f0"
        )
        self.status_lbl.pack(side="right", padx=18, pady=14)

        # صفحات داخلی
        self.pages = {}
        self._build_home_page()
        self._build_models_page()
        self._build_history_page()

        self.switch_page("home")

    def _build_home_page(self):
        page = ctk.CTkFrame(self.main_area, fg_color="transparent")
        self.pages["home"] = page

        # بنر دانلود مدل (فقط در صورتی که مدل هنوز دانلود نشده باشد بالا می‌آید)
        self.download_card = ctk.CTkFrame(
            page,
            fg_color="#172554",
            corner_radius=14,
            border_width=1,
            border_color="#1d4ed8"
        )
        self.download_card.pack(fill="x", pady=(0, 16))

        dl_top = ctk.CTkFrame(self.download_card, fg_color="transparent")
        dl_top.pack(fill="x", padx=18, pady=(14, 8))

        self.download_btn = ctk.CTkButton(
            dl_top,
            text="📥 دانلود خودکار مدل فارسی (۴۷ مگابایت)",
            font=("Segoe UI", 13, "bold"),
            height=38,
            corner_radius=10,
            fg_color="#0284c7",
            hover_color="#0369a1",
            command=self.start_model_download_thread
        )
        self.download_btn.pack(side="left")

        ctk.CTkLabel(
            dl_top,
            text="مدل آفلاین vosk-model-small-fa-0.42",
            font=("Segoe UI", 14, "bold"),
            text_color="#f8fafc"
        ).pack(side="right")

        self.progress_bar = ctk.CTkProgressBar(
            self.download_card,
            height=8,
            corner_radius=4,
            progress_color="#38bdf8"
        )
        self.progress_bar.set(0)
        self.progress_bar.pack(fill="x", padx=18, pady=(4, 14))

        # کارت کلیدهای سوییچ مدرن (Handy Pill Switches)
        switches_card = ctk.CTkFrame(
            page,
            fg_color="#111827",
            corner_radius=14,
            border_width=1,
            border_color="#1e293b"
        )
        switches_card.pack(fill="x", pady=(0, 16))

        sw_inner = ctk.CTkFrame(switches_card, fg_color="transparent")
        sw_inner.pack(fill="x", padx=18, pady=14)

        ctk.CTkSwitch(
            sw_inner,
            text="تایپ خودکار در پنجره فعال (Auto-Paste)",
            variable=self.auto_paste_var,
            font=("Segoe UI", 12),
            progress_color="#2563eb"
        ).pack(side="right", padx=(12, 0))

        ctk.CTkSwitch(
            sw_inner,
            text="اصلاح نیم‌فاصله (می‌روم)",
            variable=self.use_halfspace_var,
            font=("Segoe UI", 12),
            progress_color="#2563eb"
        ).pack(side="right", padx=16)

        ctk.CTkSwitch(
            sw_inner,
            text="علائم نگارشی صوتی (ویرگول، نقطه)",
            variable=self.use_punctuation_var,
            font=("Segoe UI", 12),
            progress_color="#2563eb"
        ).pack(side="right", padx=16)

        ctk.CTkSwitch(
            sw_inner,
            text="کپسول شناور",
            variable=self.show_overlay_var,
            font=("Segoe UI", 12),
            progress_color="#2563eb",
            command=self._toggle_overlay_visibility
        ).pack(side="left")

        # کارت ویرایشگر زنده متن فارسی
        editor_card = ctk.CTkFrame(
            page,
            fg_color="#111827",
            corner_radius=14,
            border_width=1,
            border_color="#1e293b"
        )
        editor_card.pack(fill="both", expand=True)

        ed_header = ctk.CTkFrame(editor_card, fg_color="transparent")
        ed_header.pack(fill="x", padx=18, pady=(14, 6))

        ctk.CTkLabel(
            ed_header,
            text="متن فارسی تشخیص داده‌شده (آماده تزریق در Word، تلگرام، مرورگر و...)",
            font=("Segoe UI", 13, "bold"),
            text_color="#94a3b8"
        ).pack(side="right")

        btn_box = ctk.CTkFrame(ed_header, fg_color="transparent")
        btn_box.pack(side="left")

        ctk.CTkButton(
            btn_box,
            text="کپی متن",
            width=85,
            height=30,
            corner_radius=8,
            fg_color="#1e293b",
            hover_color="#334155",
            font=("Segoe UI", 12),
            command=self.copy_all_text
        ).pack(side="left", padx=(0, 8))

        ctk.CTkButton(
            btn_box,
            text="پاک کردن",
            width=85,
            height=30,
            corner_radius=8,
            fg_color="#1e293b",
            hover_color="#334155",
            font=("Segoe UI", 12),
            command=lambda: self.text_box.delete("1.0", "end")
        ).pack(side="left")

        self.text_box = ctk.CTkTextbox(
            editor_card,
            font=("Segoe UI", 15),
            fg_color="#0b1120",
            text_color="#f8fafc",
            corner_radius=10,
            border_width=1,
            border_color="#1e293b",
            wrap="word"
        )
        self.text_box.pack(fill="both", expand=True, padx=18, pady=(4, 18))

        # راست‌چین کردن کامل متن داخل Textbox در ویندوز
        try:
            self.text_box._textbox.tag_configure("rtl", justify="right")
            self.text_box._textbox.tag_add("rtl", "1.0", "end")
        except Exception:
            pass

    def _build_models_page(self):
        page = ctk.CTkFrame(self.main_area, fg_color="transparent")
        self.pages["models"] = page

        card = ctk.CTkFrame(
            page,
            fg_color="#111827",
            corner_radius=14,
            border_width=1,
            border_color="#1e293b"
        )
        card.pack(fill="x", pady=(0, 16), padx=4)

        ctk.CTkLabel(
            card,
            text="مدیریت مدل آفلاین و تنظیمات میکروفون",
            font=("Segoe UI", 16, "bold"),
            text_color="#f8fafc"
        ).pack(anchor="e", padx=20, pady=(18, 8))

        ctk.CTkLabel(
            card,
            text=f"مسیر ذخیره‌سازی مدل در ویندوز:  {MODEL_DIR}",
            font=("Consolas", 11),
            text_color="#38bdf8"
        ).pack(anchor="e", padx=20, pady=(0, 14))

        mic_row = ctk.CTkFrame(card, fg_color="transparent")
        mic_row.pack(fill="x", padx=20, pady=(0, 20))

        ctk.CTkLabel(
            mic_row,
            text="دستگاه ورودی صدا (میکروفون):",
            font=("Segoe UI", 13),
            text_color="#cbd5e1"
        ).pack(side="right", padx=(12, 0))

        self.mic_combo = ctk.CTkComboBox(
            mic_row,
            values=["پیش‌فرض ویندوز (Default Microphone)"],
            width=340,
            font=("Segoe UI", 12)
        )
        self.mic_combo.pack(side="right")

    def _build_history_page(self):
        page = ctk.CTkFrame(self.main_area, fg_color="transparent")
        self.pages["history"] = page

        top_bar = ctk.CTkFrame(page, fg_color="transparent")
        top_bar.pack(fill="x", pady=(0, 12))

        ctk.CTkLabel(
            top_bar,
            text="تاریخچه تایپ‌های صوتی اخیر (SQLite)",
            font=("Segoe UI", 16, "bold"),
            text_color="#f8fafc"
        ).pack(side="right")

        ctk.CTkButton(
            top_bar,
            text="📊 خروجی اکسل (.CSV)",
            height=34,
            corner_radius=8,
            fg_color="#059669",
            hover_color="#047857",
            font=("Segoe UI", 12, "bold"),
            command=self.export_history_csv
        ).pack(side="left")

        self.history_box = ctk.CTkTextbox(
            page,
            font=("Segoe UI", 13),
            fg_color="#111827",
            text_color="#e2e8f0",
            corner_radius=12,
            border_width=1,
            border_color="#1e293b"
        )
        self.history_box.pack(fill="both", expand=True)

    def switch_page(self, page_key: str):
        for k, p in self.pages.items():
            p.grid_forget()
        for k, btn in self.nav_buttons.items():
            if k == page_key:
                btn.configure(fg_color="#2563eb", text_color="#ffffff")
            else:
                btn.configure(fg_color="transparent", text_color="#cbd5e1")

        self.pages[page_key].grid(row=1, column=0, sticky="nsew")
        if page_key == "history":
            self._refresh_history_view()

    def _toggle_overlay_visibility(self):
        if self.show_overlay_var.get():
            self.overlay.deiconify()
        else:
            self.overlay.withdraw()

    def _refresh_history_view(self):
        self.history_box.delete("1.0", "end")
        with sqlite3.connect(DB_PATH) as conn:
            rows = conn.execute(
                "SELECT created_at, processed_text, word_count, duration_sec FROM transcriptions ORDER BY id DESC LIMIT 100"
            ).fetchall()
        if not rows:
            self.history_box.insert("end", "هنوز هیچ تایپ صوتی ثبت نشده است.\\n")
            return
        for r in rows:
            line = f"[{r[0]}]  ({r[2]} کلمه - {r[3]} ثانیه)\\n{r[1]}\\n{'-'*65}\\n"
            self.history_box.insert("end", line)

    def _initialize_libraries_and_model(self):
        try:
            import sounddevice as sd_mod
            import vosk as vosk_mod
            import keyboard as kb_mod
            import pyperclip as clip_mod

            self.sd = sd_mod
            self.vosk_module = vosk_mod
            self.keyboard_module = kb_mod
            self.pyperclip_module = clip_mod

            # پر کردن لیست میکروفون‌های واقعی ویندوز
            try:
                devices = self.sd.query_devices()
                input_names = [f"{i}: {d['name']}" for i, d in enumerate(devices) if d.get("max_input_channels", 0) > 0]
                if input_names:
                    self.mic_combo.configure(values=input_names)
                    self.mic_combo.set(input_names[0])
            except Exception:
                pass

        except Exception as err:
            LOG_FILE.write_text(traceback.format_exc(), encoding="utf-8")
            self.status_var.set(f"❌ خطا در بارگذاری ماژول صوتی: {err}")
            return

        if MODEL_DIR.exists():
            self.progress_bar.set(1.0)
            self.download_btn.configure(state="disabled", text="✅ مدل فارسی نصب است", fg_color="#16a34a")
            threading.Thread(target=self._load_vosk_engine, daemon=True).start()
        else:
            self.status_var.set("⚠️ ابتدا روی دکمه آبی «دانلود خودکار مدل فارسی (۴۷ مگابایت)» کلیک کنید.")

    def start_model_download_thread(self):
        self.download_btn.configure(state="disabled", text="⏳ در حال دانلود مدل...")
        threading.Thread(target=self._download_and_extract_model, daemon=True).start()

    def _download_and_extract_model(self):
        try:
            MODELS_ROOT.mkdir(parents=True, exist_ok=True)
            self.status_var.set(f"🌐 در حال دانلود {MODEL_NAME} (۴۷ مگابایت)...")

            def reporthook(count, block_size, total_size):
                if total_size > 0:
                    ratio = min(1.0, (count * block_size) / total_size)
                    self.progress_bar.set(ratio)
                    self.status_var.set(f"📥 دانلود مدل فارسی: {ratio*100:.1f}%")

            urllib.request.urlretrieve(MODEL_URL, ZIP_PATH, reporthook=reporthook)
            self.status_var.set("📦 در حال استخراج فایل‌های مدل...")

            with zipfile.ZipFile(ZIP_PATH, "r") as zf:
                zf.extractall(MODELS_ROOT)

            ZIP_PATH.unlink(missing_ok=True)
            self.download_btn.configure(text="✅ مدل فارسی نصب شد", fg_color="#16a34a")
            self._load_vosk_engine()
        except Exception as err:
            self.status_var.set(f"❌ خطا در دانلود مدل: {err}")
            self.download_btn.configure(state="normal", text="📥 تلاش مجدد دانلود مدل")

    def _load_vosk_engine(self):
        try:
            self.status_var.set("⏳ در حال بارگذاری موتور صوتی vosk-model-small-fa-0.42...")
            self.model = self.vosk_module.Model(str(MODEL_DIR))
            self.recognizer = self.vosk_module.KaldiRecognizer(self.model, SAMPLE_RATE)

            self.audio_stream = self.sd.RawInputStream(
                samplerate=SAMPLE_RATE,
                blocksize=4000,
                dtype="int16",
                channels=1,
                callback=self._audio_callback
            )
            self.audio_stream.start()

            threading.Thread(target=self._worker_loop, daemon=True).start()
            try:
                self.keyboard_module.add_hotkey(DEFAULT_HOTKEY, self.toggle_recording)
            except Exception:
                pass

            self.record_btn.configure(state="normal")
            self.status_var.set("✅ آماده به کار! کلید Ctrl+Shift+Space را در هر برنامه ویندوز بزنید.")
        except Exception as err:
            LOG_FILE.write_text(traceback.format_exc(), encoding="utf-8")
            self.status_var.set(f"❌ خطا در راه‌اندازی میکروفون: {err}")

    def _audio_callback(self, indata, frames, time_info, status):
        if self.is_recording:
            raw_bytes = bytes(indata)
            self.audio_queue.put(raw_bytes)
            # محاسبه سطح بلندی صدا برای اکولایزر کپسول شناور Handy
            try:
                step = max(1, len(raw_bytes) // 32)
                levels = [min(13, abs(raw_bytes[i] - 128) // 6 + 3) for i in range(0, min(len(raw_bytes), 32), 2)]
                self.after(0, lambda lv=levels: self.overlay.update_waveform(lv, active=True))
            except Exception:
                pass

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
            else:
                partial = json.loads(self.recognizer.PartialResult()).get("partial", "").strip()
                if partial:
                    self.after(0, lambda p=partial: self.overlay.set_recording_state(True, p))

    def _handle_recognized_segment(self, raw_segment: str):
        self.session_segments.append(raw_segment)
        processed = PersianTextProcessor.normalize(
            raw_segment,
            use_punctuation=self.use_punctuation_var.get(),
            use_halfspace=self.use_halfspace_var.get()
        )
        if not processed:
            return

        def update_ui():
            self.text_box.insert("end", processed + " ")
            try:
                self.text_box._textbox.tag_add("rtl", "1.0", "end")
            except Exception:
                pass
            self.overlay.set_recording_state(self.is_recording, processed)

        self.after(0, update_ui)

        if self.auto_paste_var.get() and self.pyperclip_module and self.keyboard_module:
            try:
                self.pyperclip_module.copy(processed + " ")
                time.sleep(0.05)
                self.keyboard_module.send("ctrl+v")
            except Exception:
                pass

    def toggle_recording(self):
        if not self.model:
            return
        if not self.is_recording:
            self.is_recording = True
            self.start_time = time.time()
            self.session_segments.clear()
            self.record_btn.configure(text="⏹ توقف ضبط", fg_color="#dc2626", hover_color="#b91c1c")
            self.status_var.set("🎙️ در حال شنیدن صدای شما... صحبت کنید")
            self.overlay.set_recording_state(True, "در حال شنیدن...")
        else:
            self.is_recording = False
            duration = time.time() - self.start_time
            final_res = json.loads(self.recognizer.FinalResult()).get("text", "").strip()
            if final_res:
                self._handle_recognized_segment(final_res)

            self.record_btn.configure(text="🎙️ شروع تایپ صوتی", fg_color="#2563eb", hover_color="#1d4ed8")
            self.status_var.set("✅ ضبط متوقف شد و متن تایپ گردید.")
            self.overlay.set_recording_state(False)

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
        content = self.text_box.get("1.0", "end").strip()
        if content and self.pyperclip_module:
            self.pyperclip_module.copy(content)
            self.status_var.set("📋 کل متن در کلیپ‌بورد کپی شد.")

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
        messagebox.showinfo("ذخیره موفق", f"فایل اکسل با موفقیت ذخیره شد:\\n{save_path}")


if __name__ == "__main__":
    try:
        app = SayToHandyModernApp()
        app.mainloop()
    except Exception:
        err_msg = traceback.format_exc()
        try:
            LOG_FILE.write_text(err_msg, encoding="utf-8")
            ctypes.windll.user32.MessageBoxW(0, f"Fatal Error:\\n{err_msg}", "SayToHandy Error", 0x10)
        except Exception:
            pass
`
  },
  {
    id: 'build-exe-bat',
    filename: 'build_exe.bat',
    title: 'اسکریپت ساخت خودکار فایل اجرایی تک‌فایلی مدرن (SayToHandy.exe)',
    badge: 'EXE Compiler Script',
    description:
      'با اجرای این اسکریپت روی ویندوز، PyInstaller رابط گرافیکی مدرن CustomTkinter به همراه تمام فایل‌های DLL موتور صوتی Vosk و PortAudio را داخل فایل مستقل dist\\SayToHandy.exe بسته‌بندی کرده و بلافاصله آن را اجرا می‌کند.',
    code: `@echo off
cd /d "%~dp0"
title SayTo-Handy Modern UI Windows EXE Compiler (PyInstaller + CustomTkinter)

echo ====================================================================
echo   SayTo-Handy Modern UI (Handy Clone) - Windows EXE Builder
echo   UI: CustomTkinter + Floating Pill Overlay - Engine: Vosk FA 0.42
echo ====================================================================
echo.

:: 1. Detect Python command (python or py)
set PY_CMD=
python --version >nul 2>&1
if not errorlevel 1 (
    set PY_CMD=python
) else (
    py --version >nul 2>&1
    if not errorlevel 1 (
        set PY_CMD=py
    )
)

if "%PY_CMD%"=="" (
    echo [ERROR] Python was not found on your Windows PC!
    echo Please install Python 3.10+ from https://www.python.org/downloads/
    pause
    exit /b 1
)

echo [OK] Found Python launcher: %PY_CMD%
%PY_CMD% --version
echo.

:: 2. Verify sayto_handy_gui_app.py exists
if not exist "sayto_handy_gui_app.py" (
    echo [ERROR] File "sayto_handy_gui_app.py" not found in %CD%
    pause
    exit /b 1
)

:: 3. Install CustomTkinter, PyInstaller and Audio Libraries
echo [Step 1/3] Installing CustomTkinter (Modern UI), PyInstaller, Vosk, SoundDevice...
%PY_CMD% -m pip install --upgrade pip
%PY_CMD% -m pip install customtkinter pyinstaller vosk sounddevice cffi keyboard pyperclip
if errorlevel 1 (
    echo [ERROR] Failed to install packages via pip.
    pause
    exit /b 1
)

:: 4. Clean old build cache
if exist "build" rmdir /s /q "build"
if exist "dist\\SayToHandy.exe" del /f /q "dist\\SayToHandy.exe"

:: 5. Compile single-file Windows executable with CustomTkinter assets bundled
echo.
echo [Step 2/3] Compiling Modern Handy UI into dist\\SayToHandy.exe ...
%PY_CMD% -m PyInstaller --noconfirm --clean --onefile --name "SayToHandy" --collect-all customtkinter --collect-all vosk --collect-all _sounddevice_data --hidden-import sounddevice --hidden-import _cffi_backend --hidden-import cffi --hidden-import keyboard --hidden-import pyperclip sayto_handy_gui_app.py

echo.
if exist "dist\\SayToHandy.exe" (
    echo ====================================================================
    echo   [SUCCESS] Modern SayToHandy.exe created successfully!
    echo   File Location:  %CD%\\dist\\SayToHandy.exe
    echo.
    echo   Launching Modern SayToHandy.exe now...
    echo ====================================================================
    start "" "dist\\SayToHandy.exe"
) else (
    echo [ERROR] SayToHandy.exe was not generated. Check errors above.
)

echo.
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

export const REQUIREMENTS_TXT = `customtkinter==5.2.2
vosk==0.3.45
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
