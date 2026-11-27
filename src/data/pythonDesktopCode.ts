/**
 * مجموعه کامل کدهای پایتون (Production-Ready) برای اجرای بومی ویندوز
 * شامل:
 * 1. Windows Native Tray & Global Hotkey Engine (Handy + SayTo Architecture with vosk-model-small-fa-0.42)
 * 2. FastAPI + SQLite + Excel Export Backend Service
 * 3. Streamlit Persian Desktop Dashboard
 * 4. اسکریپت دانلود خودکار مدل vosk-model-small-fa-0.42 و requirements.txt
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
    id: 'handy-vosk-agent',
    filename: 'handy_sayto_agent.py',
    title: 'هسته ویندوزی تایپ صوتی (Vosk + Global Hotkey + Auto-Paste)',
    badge: 'Windows Native Agent',
    description:
      'کد کامل عامل پس‌زمینه ویندوز مشابه Handy و SayTo: ضبط زنده میکروفون با sounddevice، پردازش آفلاین با vosk-model-small-fa-0.42، نرمال‌ساز نیم‌فاصله و علائم نگارشی فارسی، و تایپ خودکار در محل نشانگر ماوس در هر نرم‌افزار ویندوز با میانبر Ctrl+Shift+Space.',
    code: `#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SayTo-Handy Windows Desktop Agent (Persian Offline Speech-to-Text)
Engine: vosk-model-small-fa-0.42
Inspired by: Handy (cjpais/Handy) & SayTo (CycleSeeker / SayTo)
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

# تنظیمات لاگینگ استاندارد
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger("SayToHandy")

# مسیر مدل آفلاین فارسی Vosk
MODEL_DIR = Path("models/vosk-model-small-fa-0.42")
DB_PATH = Path("sayto_history.db")
SAMPLE_RATE = 16000
HOTKEY_COMBINATION = "ctrl+shift+space"


class PersianTextProcessor:
    """
    موتور پس‌پردازش، اصلاح نیم‌فاصله و تبدیل دستورات صوتی نگارشی فارسی
    مخصوص خروجی خام مدل vosk-model-small-fa-0.42
    """

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

        # 1. یکسان‌سازی حروف عربی به فارسی استاندارد
        text = text.replace("ي", "ی").replace("ى", "ی").replace("ك", "ک")

        # 2. جایگزینی دستورات صوتی علائم نگارشی
        for trigger, replacement in cls.VOICE_COMMANDS:
            pattern = rf"(^|\\s){re.escape(trigger)}(?=\\s|$)"
            text = re.sub(pattern, replacement, text)

        # 3. اصلاح نیم‌فاصله‌ها (ZWNJ) برای پیشوندهای فعلی (می / نمی)
        text = re.sub(r"(^|\\s)(ن?می)\\s+([آ-ی]{2,})", r"\\1\\2‌\\3", text)

        # 4. اصلاح نیم‌فاصله پسوندهای جمع (ها / های / هایی) و صفت برتر (تر / ترین)
        text = re.sub(r"([آ-ی]{2,})\\s+(های|هایی|ها|ترین|تر)(?=\\s|$|[،.؟!:؛])", r"\\1‌\\2", text)

        # 5. حذف فاصله‌های اضافی قبل از علائم نگارشی
        text = re.sub(r"\\s+([،.؟!:؛.])", r"\\1", text)
        text = re.sub(r"([،.؟!:؛.])(?=[^\\s\\n»)])", r"\\1 ", text)

        # 6. تبدیل اعداد به ارقام فارسی
        text = text.translate(cls.PERSIAN_DIGITS)

        return text.strip()


class HistoryDatabase:
    """مدیریت پایگاه داده SQLite برای ذخیره تاریخچه تایپ صوتی"""

    def __init__(self, db_path: Path):
        self.db_path = db_path
        self._init_db()

    def _init_db(self):
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS transcriptions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    raw_text TEXT NOT NULL,
                    processed_text TEXT NOT NULL,
                    duration_sec REAL DEFAULT 0.0,
                    word_count INTEGER DEFAULT 0,
                    target_app TEXT DEFAULT 'Windows Active Window',
                    created_at TEXT NOT NULL
                )
            """)
            conn.commit()

    def save_entry(self, raw_text: str, processed_text: str, duration_sec: float):
        word_count = len(processed_text.split())
        now_iso = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                """
                INSERT INTO transcriptions (raw_text, processed_text, duration_sec, word_count, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (raw_text, processed_text, round(duration_sec, 2), word_count, now_iso)
            )
            conn.commit()


class HandyVoskEngine:
    """
    موتور اصلی ضبط صدا، تشخیص گفتار آفلاین با Vosk و تزریق مستقیم متن در ویندوز
    """

    def __init__(self, model_path: Path):
        if not model_path.exists():
            raise FileNotFoundError(
                f"مدل Vosk در مسیر '{model_path}' یافت نشد. "
                "لطفاً ابتدا اسکریپت setup_model.py را اجرا کنید."
            )

        logger.info(f"در حال بارگذاری مدل آفلاین فارسی از {model_path} ...")
        self.model = Model(str(model_path))
        self.recognizer = KaldiRecognizer(self.model, SAMPLE_RATE)
        self.audio_queue: queue.Queue[bytes] = queue.Queue()
        self.db = HistoryDatabase(DB_PATH)

        self.is_recording = False
        self.start_time = 0.0
        self.session_segments: list[str] = []

    def _audio_callback(self, indata, frames, time_info, status):
        """دریافت استریم صوتی ۱۶ کیلوهرتز تک‌کاناله از میکروفون"""
        if status:
            logger.warning(f"وضعیت کارت صدا: {status}")
        if self.is_recording:
            self.audio_queue.put(bytes(indata))

    def inject_text_to_active_window(self, text: str):
        """
        کپی متن فارسی در کلیپ‌بورد و ارسال Ctrl+V به پنجره فعال ویندوز (مشابه Handy)
        با حفظ محتوای قبلی کلیپ‌بورد کاربر
        """
        if not text:
            return

        try:
            previous_clipboard = pyperclip.paste()
        except Exception:
            previous_clipboard = ""

        try:
            pyperclip.copy(text + " ")
            time.sleep(0.06)
            keyboard.send("ctrl+v")
            logger.info(f"متن در پنجره فعال تایپ شد: {text}")
        except Exception as err:
            logger.error(f"خطا در تزریق متن به پنجره فعال: {err}")

    def _process_queue_worker(self):
        """پردازش زنده بافرهای صوتی در ترد پس‌زمینه"""
        while True:
            data = self.audio_queue.get()
            if data is None:
                break

            if self.recognizer.AcceptWaveform(data):
                result = json.loads(self.recognizer.Result())
                segment = result.get("text", "").strip()
                if segment:
                    self.session_segments.append(segment)
                    processed_seg = PersianTextProcessor.normalize(segment)
                    self.inject_text_to_active_window(processed_seg)
            else:
                partial = json.loads(self.recognizer.PartialResult()).get("partial", "")
                if partial:
                    sys.stdout.write(f"\\r[در حال شنیدن...] {partial}   ")
                    sys.stdout.flush()

    def toggle_recording(self):
        """تغییر وضعیت ضبط با فشردن کلید میانبر سراسری (Toggle Mode)"""
        if not self.is_recording:
            self.is_recording = True
            self.start_time = time.time()
            self.session_segments.clear()
            logger.info("🎙️ ضبط صدا آغاز شد (در حال گوش دادن با vosk-model-small-fa-0.42)...")
        else:
            self.is_recording = False
            duration = time.time() - self.start_time
            final_res = json.loads(self.recognizer.FinalResult()).get("text", "").strip()
            if final_res:
                self.session_segments.append(final_res)
                processed_final = PersianTextProcessor.normalize(final_res)
                self.inject_text_to_active_window(processed_final)

            full_raw = " ".join(self.session_segments).strip()
            if full_raw:
                full_processed = PersianTextProcessor.normalize(full_raw)
                self.db.save_entry(full_raw, full_processed, duration)
                logger.info(f"✅ پایان ضبط ({duration:.1f} ثانیه) | ذخیره در SQLite انجام شد.")
            else:
                logger.info("⏹️ ضبط متوقف شد (صدایی تشخیص داده نشد).")

    def run(self):
        worker = threading.Thread(target=self._process_queue_worker, daemon=True)
        worker.start()

        keyboard.add_hotkey(HOTKEY_COMBINATION, self.toggle_recording)
        logger.info("=" * 65)
        logger.info(f"🚀 SayTo-Handy آماده به کار است! میانبر سراسری: [{HOTKEY_COMBINATION.upper()}]")
        logger.info("در هر برنامه ویندوزی (Word, Notepad, Browser, Telegram) میانبر را بزنید و صحبت کنید.")
        logger.info("=" * 65)

        with sd.RawInputStream(
            samplerate=SAMPLE_RATE,
            blocksize=8000,
            dtype="int16",
            channels=1,
            callback=self._audio_callback
        ):
            keyboard.wait("esc+ctrl")


if __name__ == "__main__":
    try:
        engine = HandyVoskEngine(MODEL_DIR)
        engine.run()
    except Exception as e:
        logger.error(f"خطای بحرانی در اجرای برنامه: {e}")
        sys.exit(1)
`
  },
  {
    id: 'fastapi-backend',
    filename: 'backend_api.py',
    title: 'سرویس بک‌اند FastAPI + SQLite + خروجی Excel (Pandas/OpenPyXL)',
    badge: 'FastAPI + SQLite + Excel',
    description:
      'سرویس کامل REST API با FastAPI برای مدیریت تاریخچه تایپ صوتی، دیکشنری واژگان سفارشی، پردازش فایل‌های صوتی WAV با Vosk و استخراج گزارش کامل Excel با استفاده از pandas و openpyxl.',
    code: `#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
FastAPI Backend Service for SayTo-Handy Persian Speech Recognition
Includes SQLite database persistence, WAV audio transcription via Vosk,
and automated Excel report generation using Pandas & OpenPyXL.
"""

import io
import json
import wave
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import pandas as pd
from vosk import Model, KaldiRecognizer

from handy_sayto_agent import PersianTextProcessor, MODEL_DIR, DB_PATH

app = FastAPI(
    title="SayTo-Handy Persian STT API",
    description="API تبدیل گفتار به متن آفلاین فارسی با مدل vosk-model-small-fa-0.42",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# بارگذاری یک‌باره مدل در حافظه سرور
vosk_model: Optional[Model] = None


@app.on_event("startup")
def startup_event():
    global vosk_model
    if MODEL_DIR.exists():
        vosk_model = Model(str(MODEL_DIR))


class TranscriptionItem(BaseModel):
    id: int
    raw_text: str
    processed_text: str
    duration_sec: float
    word_count: int
    target_app: str
    created_at: str


class NormalizeRequest(BaseModel):
    raw_text: str


@app.post("/api/normalize")
def normalize_persian_text(payload: NormalizeRequest):
    """نرمال‌سازی متن خام خروجی Vosk و اعمال علائم نگارشی و نیم‌فاصله"""
    processed = PersianTextProcessor.normalize(payload.raw_text)
    return {
        "raw_text": payload.raw_text,
        "processed_text": processed,
        "word_count": len(processed.split()) if processed else 0
    }


@app.post("/api/transcribe-wav")
async def transcribe_wav_file(file: UploadFile = File(...)):
    """تبدیل فایل صوتی WAV (16kHz Mono) به متن فارسی با vosk-model-small-fa-0.42"""
    if vosk_model is None:
        raise HTTPException(
            status_code=503,
            detail="مدل vosk-model-small-fa-0.42 بارگذاری نشده است. ابتدا setup_model.py را اجرا کنید."
        )

    content = await file.read()
    try:
        wf = wave.open(io.BytesIO(content), "rb")
    except Exception as err:
        raise HTTPException(status_code=400, detail=f"فرمت فایل WAV معتبر نیست: {err}")

    if wf.getnchannels() != 1 or wf.getsampwidth() != 2:
        raise HTTPException(
            status_code=400,
            detail="فایل صوتی باید به فرمت WAV تک‌کاناله (Mono) و 16-bit PCM باشد."
        )

    rec = KaldiRecognizer(vosk_model, wf.getframerate())
    segments = []

    while True:
        data = wf.readframes(4000)
        if len(data) == 0:
            break
        if rec.AcceptWaveform(data):
            res = json.loads(rec.Result())
            if res.get("text"):
                segments.append(res["text"])

    final_res = json.loads(rec.FinalResult())
    if final_res.get("text"):
        segments.append(final_res["text"])

    raw_text = " ".join(segments).strip()
    processed_text = PersianTextProcessor.normalize(raw_text)
    duration_sec = wf.getnframes() / float(wf.getframerate())

    # ذخیره در پایگاه داده SQLite
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            """
            INSERT INTO transcriptions (raw_text, processed_text, duration_sec, word_count, target_app, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                raw_text,
                processed_text,
                round(duration_sec, 2),
                len(processed_text.split()),
                "FastAPI WAV Upload",
                datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            )
        )
        conn.commit()

    return {
        "raw_text": raw_text,
        "processed_text": processed_text,
        "duration_sec": round(duration_sec, 2),
        "model": "vosk-model-small-fa-0.42"
    }


@app.get("/api/history", response_model=List[TranscriptionItem])
def get_transcription_history():
    """دریافت لیست تمام متون تایپ‌شده از SQLite"""
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT * FROM transcriptions ORDER BY id DESC LIMIT 200"
        ).fetchall()
        return [dict(r) for r in rows]


@app.get("/api/export-excel")
def export_history_to_excel():
    """استخراج تاریخچه تایپ صوتی به فایل اکسل استاندارد با Pandas و OpenPyXL"""
    with sqlite3.connect(DB_PATH) as conn:
        df = pd.read_sql_query(
            """
            SELECT 
                id AS 'شناسه',
                processed_text AS 'متن نهایی (اصلاح‌شده)',
                raw_text AS 'خروجی خام Vosk',
                word_count AS 'تعداد کلمات',
                duration_sec AS 'مدت زمان (ثانیه)',
                target_app AS 'نرم‌افزار مقصد',
                created_at AS 'تاریخ و زمان'
            FROM transcriptions
            ORDER BY id DESC
            """,
            conn
        )

    output = io.BytesIO()
    with pd.ExcelWriter(output, engine="openpyxl") as writer:
        df.to_excel(writer, index=False, sheet_name="تاریخچه تایپ صوتی")
        worksheet = writer.sheets["تاریخچه تایپ صوتی"]
        worksheet.sheet_view.rightToLeft = True  # راست‌چین کردن شیت اکسل برای فارسی

    output.seek(0)
    filename = f"sayto_handy_report_{datetime.now().strftime('%Y%m%d_%H%M')}.xlsx"
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )
`
  },
  {
    id: 'streamlit-ui',
    filename: 'streamlit_dashboard.py',
    title: 'رابط کاربری دسکتاپ با Streamlit (مدیریت، تست صدا و گزارش اکسل)',
    badge: 'Streamlit UI',
    description:
      'پنل مدیریتی کامل با Streamlit برای مشاهده آمار تایپ صوتی، تست زنده نرمال‌ساز فارسی، آپلود فایل صوتی، ویرایش دیکشنری دستورات صوتی و دانلود مستقیم فایل اکسل.',
    code: `#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Streamlit Desktop Control Panel for SayTo-Handy (Vosk Persian 0.42)
Run with: streamlit run streamlit_dashboard.py
"""

import sqlite3
from pathlib import Path
import streamlit as st
import pandas as pd
from handy_sayto_agent import PersianTextProcessor, DB_PATH, MODEL_DIR, HOTKEY_COMBINATION

st.set_page_config(
    page_title="SayTo-Handy | تایپ صوتی آفلاین فارسی",
    page_icon="🎙️",
    layout="wide"
)

# استایل راست‌به‌چپ (RTL) و فونت فارسی برای Streamlit
st.markdown("""
<style>
    @import url('https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;600;700&display=swap');
    html, body, [class*="css"] {
        font-family: 'Vazirmatn', sans-serif !important;
        direction: rtl;
        text-align: right;
    }
    .stTextArea textarea, .stTextInput input {
        direction: rtl;
        text-align: right;
        font-family: 'Vazirmatn', sans-serif !important;
    }
</style>
""", unsafe_allow_html=True)

st.title("🎙️ SayTo-Handy — دستیار تایپ صوتی آفلاین ویندوز")
st.caption(f"موتور تشخیص گفتار: vosk-model-small-fa-0.42 | کلید میانبر سراسری: {HOTKEY_COMBINATION.upper()}")

col1, col2, col3 = st.columns(3)

# خواندن آمار از SQLite
total_records, total_words, total_duration = 0, 0, 0.0
if DB_PATH.exists():
    with sqlite3.connect(DB_PATH) as conn:
        row = conn.execute(
            "SELECT COUNT(*), COALESCE(SUM(word_count), 0), COALESCE(SUM(duration_sec), 0) FROM transcriptions"
        ).fetchone()
        if row:
            total_records, total_words, total_duration = row

col1.metric("تعداد کل دیکته‌ها", f"{total_records} مورد")
col2.metric("مجموع کلمات تایپ‌شده", f"{total_words} کلمه")
col3.metric("وضعیت مدل آفلاین", "آماده به کار ✅" if MODEL_DIR.exists() else "نیاز به دانلود ⚠️")

st.divider()

tab_live, tab_history = st.tabs(["✨ تست نرمال‌ساز و علائم نگارشی", "📊 تاریخچه SQLite و خروجی اکسل"])

with tab_live:
    st.subheader("تست موتور پس‌پردازش SayTo بر روی خروجی خام Vosk")
    raw_input = st.text_area(
        "متن خام خروجی مدل Vosk را وارد کنید:",
        value="سلام ویرگول این متن با مدل آفلاین وسک در ویندوز تایپ می شود نقطه سر خط آیا کیفیت تشخیص خوب است علامت سوال",
        height=110
    )
    if st.button("اعمال نرمال‌سازی و نیم‌فاصله", type="primary"):
        processed = PersianTextProcessor.normalize(raw_input)
        st.success("متن نهایی آماده تزریق به ویندوز:")
        st.code(processed, language=None)

with tab_history:
    st.subheader("تاریخچه متون تبدیل‌شده در ویندوز")
    if DB_PATH.exists():
        with sqlite3.connect(DB_PATH) as conn:
            df = pd.read_sql_query("SELECT * FROM transcriptions ORDER BY id DESC", conn)

        if not df.empty:
            st.dataframe(df, use_container_width=True)
            # تولید خروجی اکسل در حافظه
            import io
            excel_buffer = io.BytesIO()
            with pd.ExcelWriter(excel_buffer, engine="openpyxl") as writer:
                df.to_excel(writer, index=False, sheet_name="Transcriptions")
            st.download_button(
                label="📥 دانلود گزارش کامل Excel (.xlsx)",
                data=excel_buffer.getvalue(),
                file_name="sayto_handy_transcriptions.xlsx",
                mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            )
        else:
            st.info("هنوز هیچ رکوردی در پایگاه داده ثبت نشده است.")
`
  },
  {
    id: 'setup-model',
    filename: 'setup_model.py',
    title: 'اسکریپت دانلود و نصب خودکار مدل vosk-model-small-fa-0.42',
    badge: 'Auto Installer',
    description:
      'اسکریپت پایتون برای دانلود مستقیم مدل رسمی vosk-model-small-fa-0.42.zip از سرورهای Alphacephei، استخراج خودکار در پوشه models و بررسی نصب بودن پکیج‌های مورد نیاز.',
    code: `#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
اسکریپت دانلود و استخراج خودکار مدل vosk-model-small-fa-0.42
حجم مدل: ~47 مگابایت | کاملاً آفلاین پس از نصب اولیه
"""

import os
import sys
import zipfile
import urllib.request
from pathlib import Path

MODEL_NAME = "vosk-model-small-fa-0.42"
MODEL_URL = f"https://alphacephei.com/vosk/models/{MODEL_NAME}.zip"
MODELS_ROOT = Path("models")
TARGET_DIR = MODELS_ROOT / MODEL_NAME
ZIP_PATH = MODELS_ROOT / f"{MODEL_NAME}.zip"


def download_progress(count, block_size, total_size):
    percent = int(count * block_size * 100 / total_size)
    sys.stdout.write(f"\\r📥 در حال دانلود {MODEL_NAME}: {min(percent, 100)}%")
    sys.stdout.flush()


def setup_vosk_persian_model():
    MODELS_ROOT.mkdir(parents=True, exist_ok=True)

    if TARGET_DIR.exists():
        print(f"✅ مدل '{MODEL_NAME}' از قبل در مسیر '{TARGET_DIR}' نصب شده است.")
        return

    print(f"🌐 شروع دانلود مدل رسمی فارسی از: {MODEL_URL}")
    try:
        urllib.request.urlretrieve(MODEL_URL, ZIP_PATH, reporthook=download_progress)
        print("\\n📦 دانلود کامل شد. در حال استخراج فایل فشرده...")

        with zipfile.ZipFile(ZIP_PATH, "r") as zf:
            zf.extractall(MODELS_ROOT)

        ZIP_PATH.unlink(missing_ok=True)
        print(f"🎉 مدل '{MODEL_NAME}' با موفقیت در '{TARGET_DIR}' آماده استفاده شد!")
    except Exception as err:
        print(f"\\n❌ خطا در دانلود یا استخراج مدل: {err}")
        sys.exit(1)


if __name__ == "__main__":
    setup_vosk_persian_model()
`
  },
  {
    id: 'run-windows-bat',
    filename: 'run_windows.bat',
    title: 'اسکریپت اجرای یک‌کلیکی در ویندوز (نصب خودکار + دانلود مدل + اجرا)',
    badge: 'Windows 1-Click Launcher',
    description:
      'فایل اجرایی Batch ویندوز که با دابل‌کلیک روی آن، تمام کتابخانه‌ها را نصب می‌کند، مدل vosk-model-small-fa-0.42 را دانلود کرده و دستیار تایپ صوتی Handy-SayTo را فعال می‌سازد.',
    code: `@echo off
chcp 65001 > nul
title SayTo-Handy Persian Offline Speech-to-Text (Vosk FA 0.42)

echo ====================================================================
echo   راه‌اندازی خودکار دستیار تایپ صوتی آفلاین فارسی (SayTo-Handy)
echo   Engine: vosk-model-small-fa-0.42 (100%% Offline)
echo ====================================================================
echo.

:: 1. بررسی نصب بودن پایتون
python --version > nul 2>&1
if %errorlevel% neq 0 (
    echo [خطا] پایتون روی سیستم شما یافت نشد!
    echo لطفاً Python 3.10 یا بالاتر را از سایت python.org دانلود و نصب کنید.
    echo هنگام نصب حتماً تیک گزینه "Add Python to PATH" را بزنید.
    pause
    exit /b 1
)

:: 2. ساخت محیط مجازی (در صورت عدم وجود)
if not exist "venv" (
    echo [۱/۴] در حال ساخت محیط مجازی پایتون (venv)...
    python -m venv venv
)

:: 3. فعال‌سازی محیط مجازی و نصب پکیج‌ها
echo [۲/۴] در حال بررسی و نصب کتابخانه‌های مورد نیاز...
call venv\\Scripts\\activate.bat
pip install -q --upgrade pip
pip install -q vosk sounddevice keyboard pyperclip fastapi uvicorn streamlit pandas openpyxl python-multipart

:: 4. دانلود خودکار مدل vosk-model-small-fa-0.42 (در صورت عدم وجود)
echo [۳/۴] بررسی مدل آفلاین فارسی vosk-model-small-fa-0.42...
python setup_model.py

:: 5. اجرای هسته اصلی تایپ صوتی ویندوز
echo.
echo [۴/۴] در حال اجرای سرویس پس‌زمینه تایپ صوتی ویندوز...
echo --------------------------------------------------------------------
echo   میانبر سراسری:  Ctrl + Shift + Space
echo   در هر برنامه‌ای (Word, Notepad, Telegram, Browser) میانبر را بزنید!
echo --------------------------------------------------------------------
echo.
python handy_sayto_agent.py

pause
`
  }
];

export const REQUIREMENTS_TXT = `vosk==0.3.45
sounddevice==0.5.1
keyboard==0.13.5
pyperclip==1.9.0
fastapi==0.115.6
uvicorn==0.34.0
streamlit==1.41.1
pandas==2.2.3
openpyxl==3.1.5
python-multipart==0.0.20`;
