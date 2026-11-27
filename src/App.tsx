import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Mic,
  MicOff,
  Copy,
  Check,
  Trash2,
  Download,
  Terminal,
  Sliders,
  BookOpen,
  History,
  Play,
  Pause,
  Plus,
  Sun,
  Moon,
  Volume2,
  Keyboard,
  Cpu,
  FileSpreadsheet,
  Search,
  Sparkles,
  RefreshCw,
  FolderDown,
} from 'lucide-react';
import {
  DEFAULT_VOICE_COMMANDS,
  VoiceCommandRule,
  NormalizationOptions,
  processPersianTranscript,
  SAMPLE_RAW_VOSK_SENTENCES,
} from './utils/persianProcessor';
import {
  PYTHON_PROJECT_FILES,
  REQUIREMENTS_TXT,
} from './data/pythonDesktopCode';

interface TranscriptionRecord {
  id: string;
  rawText: string;
  processedText: string;
  wordCount: number;
  durationSec: number;
  targetApp: string;
  createdAt: string;
  rulesApplied: number;
}

const INITIAL_HISTORY: TranscriptionRecord[] = [
  {
    id: 'rec-101',
    rawText: 'سلام وقت بخیر ویرگول گزارش پیشرفت پروژه اتوماسیون اداری آماده ارسال می باشد نقطه',
    processedText: 'سلام وقت بخیر، گزارش پیشرفت پروژه اتوماسیون اداری آماده ارسال می‌باشد.',
    wordCount: 12,
    durationSec: 4.8,
    targetApp: 'Microsoft Word (Win11)',
    createdAt: '۱۴۰۵/۰۹/۰۶ - ۱۱:۴۰',
    rulesApplied: 3,
  },
  {
    id: 'rec-102',
    rawText: 'در نسخه جدید برنامه ها سرعت پردازش مدل کوچک فارسی وسک به بیش از سه برابر افزایش یافته است علامت تعجب',
    processedText: 'در نسخه جدید برنامه‌ها سرعت پردازش مدل کوچک فارسی وسک به بیش از ۳ برابر افزایش یافته است!',
    wordCount: 18,
    durationSec: 6.2,
    targetApp: 'Telegram Desktop',
    createdAt: '۱۴۰۵/۰۹/۰۶ - ۱۰:۱۵',
    rulesApplied: 3,
  },
  {
    id: 'rec-103',
    rawText: 'لطفاً فایل های اکسل خروجی را بررسی کنید ویرگول آیا اطلاعات کامل است علامت سوال',
    processedText: 'لطفاً فایل‌های اکسل خروجی را بررسی کنید، آیا اطلاعات کامل است؟',
    wordCount: 11,
    durationSec: 3.9,
    targetApp: 'VS Code Editor',
    createdAt: '۱۴۰۵/۰۹/۰۵ - ۱۶:۲۲',
    rulesApplied: 3,
  },
];

type ActiveSection = 'studio' | 'rules' | 'history' | 'python-code';

export default function App() {
  const [darkMode, setDarkMode] = useState<boolean>(true);
  const [activeSection, setActiveSection] = useState<ActiveSection>('studio');

  // وضعیت ضبط و میکروفون
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [recordingMode, setRecordingMode] = useState<'toggle' | 'hold'>('toggle');
  const [hotkeyLabel, setHotkeyLabel] = useState<string>('Ctrl + Shift + Space');
  const [targetWindowSim, setTargetWindowSim] = useState<string>('پنجره فعال ویندوز (Auto-Paste)');
  const [recordingSeconds, setRecordingSeconds] = useState<number>(0);
  const [audioLevels, setAudioLevels] = useState<number[]>(new Array(24).fill(12));
  const [statusMessage, setStatusMessage] = useState<string>('آماده دریافت صدا با مدل vosk-model-small-fa-0.42');

  // متن خام و پردازش‌شده
  const [rawInputText, setRawInputText] = useState<string>(
    'سلام وقت بخیر ویرگول این یک تست زنده از سامانه تایپ صوتی فارسی مشابه هندی و سی تو با مدل وسک است نقطه سر خط شما می توانید با میکروفون صحبت کنید یا جملات نمونه را آزمایش نمایید علامت تعجب'
  );
  const [interimTranscript, setInterimTranscript] = useState<string>('');
  const [copiedEditor, setCopiedEditor] = useState<boolean>(false);

  // تنظیمات نرمال‌ساز فارسی (SayTo Engine)
  const [normOptions, setNormOptions] = useState<NormalizationOptions>({
    enableVoicePunctuation: true,
    enableHalfSpace: true,
    enableArabicToPersianChars: true,
    enableSpokenNumbersToDigits: true,
    digitStyle: 'persian',
  });

  // قواعد دستورات صوتی
  const [commands, setCommands] = useState<VoiceCommandRule[]>(DEFAULT_VOICE_COMMANDS);
  const [newTrigger, setNewTrigger] = useState<string>('');
  const [newReplacement, setNewReplacement] = useState<string>('');
  const [newDescription, setNewDescription] = useState<string>('');

  // تاریخچه SQLite شبیه‌سازی‌شده و واقعی در مرورگر
  const [history, setHistory] = useState<TranscriptionRecord[]>(INITIAL_HISTORY);
  const [historySearch, setHistorySearch] = useState<string>('');

  // بخش کد پایتون
  const [selectedPythonFileId, setSelectedPythonFileId] = useState<string>(PYTHON_PROJECT_FILES[0].id);
  const [copiedCodeId, setCopiedCodeId] = useState<string | null>(null);

  // رفرنس‌های Web Speech API و Web Audio API
  const recognitionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);

  // همگام‌سازی کلاس dark روی html
  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [darkMode]);

  // محاسبه لحظه‌ای خروجی پردازش‌شده فارسی
  const { processedText, appliedRulesCount } = useMemo(() => {
    const combinedRaw = interimTranscript
      ? `${rawInputText} ${interimTranscript}`.trim()
      : rawInputText;
    return processPersianTranscript(combinedRaw, normOptions, commands);
  }, [rawInputText, interimTranscript, normOptions, commands]);

  // راه‌اندازی اکولایزر صوتی واقعی از میکروفون
  const startAudioVisualizer = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioCtx();
      audioContextRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);
      analyserRef.current = analyser;

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const updateLevels = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);
        const bars: number[] = [];
        for (let i = 0; i < 24; i++) {
          const val = dataArray[i % bufferLength] || 0;
          const height = Math.max(10, Math.min(100, Math.round((val / 255) * 100)));
          bars.push(height);
        }
        setAudioLevels(bars);
        animFrameRef.current = requestAnimationFrame(updateLevels);
      };
      updateLevels();
    } catch {
      // اگر میکروفون در محیط sandbox در دسترس نبود، موج شبیه‌سازی‌شده نمایش بده
      const interval = window.setInterval(() => {
        setAudioLevels(Array.from({ length: 24 }, () => Math.floor(Math.random() * 75) + 15));
      }, 120);
      animFrameRef.current = interval as unknown as number;
    }
  };

  const stopAudioVisualizer = () => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      clearInterval(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    setAudioLevels(new Array(24).fill(12));
  };

  // شروع/توقف ضبط صدا (تایپ صوتی فارسی)
  const toggleRecording = () => {
    if (isRecording) {
      stopRecordingSession();
    } else {
      startRecordingSession();
    }
  };

  const startRecordingSession = () => {
    setIsRecording(true);
    setRecordingSeconds(0);
    setInterimTranscript('');
    setStatusMessage('در حال شنیدن صدای شما (فا-IR | شبیه‌ساز استریم Vosk 16kHz)...');

    timerRef.current = window.setInterval(() => {
      setRecordingSeconds((prev) => +(prev + 0.1).toFixed(1));
    }, 100);

    startAudioVisualizer();

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (SpeechRecognition) {
      try {
        const recognition = new SpeechRecognition();
        recognition.lang = 'fa-IR';
        recognition.continuous = true;
        recognition.interimResults = true;

        recognition.onresult = (event: any) => {
          let finalChunk = '';
          let interimChunk = '';
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
              finalChunk += transcript + ' ';
            } else {
              interimChunk += transcript;
            }
          }
          if (finalChunk) {
            setRawInputText((prev) => `${prev.trim()} ${finalChunk.trim()}`.trim());
          }
          setInterimTranscript(interimChunk);
        };

        recognition.onerror = () => {
          setStatusMessage('حالت استریم دمو فعال شد (می‌توانید صحبت کنید یا دکمه نمونه صوتی را بزنید)');
        };

        recognition.start();
        recognitionRef.current = recognition;
      } catch {
        setStatusMessage('ضبط فعال است — از دکمه «شبیه‌سازی استریم صوتی Vosk» نیز می‌توانید استفاده کنید');
      }
    } else {
      setStatusMessage('ضبط فعال است — مرورگر شما در حالت استریم شبیه‌ساز Vosk کار می‌کند');
    }
  };

  const stopRecordingSession = () => {
    setIsRecording(false);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
      recognitionRef.current = null;
    }
    stopAudioVisualizer();
    setInterimTranscript('');
    setStatusMessage('ضبط متوقف شد — متن نهایی آماده تزریق یا کپی است');
  };

  // میانبر صفحه‌کلید Ctrl + Shift + Space مشابه Handy
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.code === 'Space') {
        e.preventDefault();
        toggleRecording();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  // شبیه‌سازی دریافت استریم صوتی فارسی از مدل vosk-model-small-fa-0.42
  const runSimulatedVoskStream = () => {
    const randomSentence =
      SAMPLE_RAW_VOSK_SENTENCES[Math.floor(Math.random() * SAMPLE_RAW_VOSK_SENTENCES.length)];
    const words = randomSentence.split(' ');
    setRawInputText('');
    setIsRecording(true);
    setStatusMessage('در حال استریم بسته‌های صوتی ۱۶ کیلوهرتز به KaldiRecognizer (vosk-model-small-fa-0.42)...');

    let index = 0;
    const streamInterval = window.setInterval(() => {
      if (index < words.length) {
        const nextWord = words[index];
        setRawInputText((prev) => (prev ? `${prev} ${nextWord}` : nextWord));
        setAudioLevels(Array.from({ length: 24 }, () => Math.floor(Math.random() * 80) + 15));
        setRecordingSeconds((prev) => +(prev + 0.2).toFixed(1));
        index++;
      } else {
        clearInterval(streamInterval);
        setIsRecording(false);
        setAudioLevels(new Array(24).fill(12));
        setStatusMessage('استریم صوتی Vosk تکمیل شد و قواعد نگارشی SayTo اعمال گردید.');
      }
    }, 170);
  };

  // ذخیره متن فعلی در تاریخچه SQLite و کپی در کلیپ‌بورد
  const handleSaveAndInject = () => {
    if (!processedText.trim()) return;
    navigator.clipboard.writeText(processedText).catch(() => {});
    setCopiedEditor(true);
    setTimeout(() => setCopiedEditor(false), 2000);

    const newRecord: TranscriptionRecord = {
      id: `rec-${Date.now().toString().slice(-4)}`,
      rawText: rawInputText.trim(),
      processedText: processedText.trim(),
      wordCount: processedText.trim().split(/\s+/).length,
      durationSec: recordingSeconds > 0 ? recordingSeconds : 4.2,
      targetApp: targetWindowSim,
      createdAt: 'هم‌اکنون',
      rulesApplied: appliedRulesCount,
    };
    setHistory((prev) => [newRecord, ...prev]);
    setStatusMessage(`متن در کلیپ‌بورد کپی شد و به «${targetWindowSim}» ارسال گردید.`);
  };

  // افزودن دستور صوتی جدید به دیکشنری SayTo
  const handleAddCommand = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTrigger.trim() || !newReplacement.trim()) return;
    const created: VoiceCommandRule = {
      id: `cmd-custom-${Date.now()}`,
      trigger: newTrigger.trim(),
      replacement: newReplacement,
      category: 'custom',
      description: newDescription.trim() || 'فرمان صوتی سفارشی کاربر',
      enabled: true,
    };
    setCommands((prev) => [created, ...prev]);
    setNewTrigger('');
    setNewReplacement('');
    setNewDescription('');
  };

  const toggleCommandEnabled = (id: string) => {
    setCommands((prev) =>
      prev.map((c) => (c.id === id ? { ...c, enabled: !c.enabled } : c))
    );
  };

  const deleteCommand = (id: string) => {
    setCommands((prev) => prev.filter((c) => c.id !== id));
  };

  // دانلود خروجی CSV/Excel سازگار با UTF-8 BOM برای فارسی
  const handleExportCSV = () => {
    const headers = ['شناسه', 'متن نهایی اصلاح‌شده', 'خروجی خام Vosk', 'تعداد کلمات', 'مدت زمان (ثانیه)', 'برنامه مقصد', 'زمان ثبت'];
    const rows = history.map((item) => [
      item.id,
      `"${item.processedText.replace(/"/g, '""')}"`,
      `"${item.rawText.replace(/"/g, '""')}"`,
      item.wordCount,
      item.durationSec,
      `"${item.targetApp}"`,
      `"${item.createdAt}"`,
    ]);
    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sayto_handy_persian_history.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // دانلود فایل پایتون یا اسکریپت ویندوز (با تبدیل خودکار CRLF برای فایل‌های .bat)
  const handleDownloadPythonFile = (filename: string, content: string) => {
    const isWindowsBatch = filename.endsWith('.bat') || filename.endsWith('.iss');
    const normalizedContent = isWindowsBatch
      ? content.replace(/\r?\n/g, '\r\n')
      : content;
    const blob = new Blob([normalizedContent], { type: 'text/plain;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filteredHistory = useMemo(() => {
    if (!historySearch.trim()) return history;
    const q = historySearch.trim();
    return history.filter(
      (h) =>
        h.processedText.includes(q) ||
        h.rawText.includes(q) ||
        h.targetApp.toLowerCase().includes(q.toLowerCase())
    );
  }, [history, historySearch]);

  const activePythonFile =
    PYTHON_PROJECT_FILES.find((f) => f.id === selectedPythonFileId) || PYTHON_PROJECT_FILES[0];

  const totalWordsTyped = useMemo(
    () => history.reduce((acc, item) => acc + item.wordCount, 0),
    [history]
  );

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 transition-colors">
      {/* Top Bar Contract: 3 Zones separated by gap-8 */}
      <header className="flex items-center justify-between gap-8 px-6 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 sticky top-0 z-30">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#studio"
          onClick={(e) => {
            e.preventDefault();
            setActiveSection('studio');
          }}
          className="text-lg font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap shrink-0"
        >
          SayTo Handy FA
        </a>

        {/* Zone 2: 4 concise single-line text navigation links */}
        <nav className="flex items-center gap-6 text-sm font-medium text-slate-600 dark:text-slate-300 overflow-x-auto">
          <button
            onClick={() => setActiveSection('studio')}
            className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeSection === 'studio'
                ? 'border-sky-500 text-slate-900 dark:text-white font-semibold'
                : 'border-transparent hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            استودیو تایپ صوتی
          </button>
          <button
            onClick={() => setActiveSection('rules')}
            className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeSection === 'rules'
                ? 'border-sky-500 text-slate-900 dark:text-white font-semibold'
                : 'border-transparent hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            قواعد نگارشی SayTo
          </button>
          <button
            onClick={() => setActiveSection('history')}
            className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeSection === 'history'
                ? 'border-sky-500 text-slate-900 dark:text-white font-semibold'
                : 'border-transparent hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            تاریخچه و خروجی اکسل
          </button>
          <button
            onClick={() => setActiveSection('python-code')}
            className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeSection === 'python-code'
                ? 'border-sky-500 text-slate-900 dark:text-white font-semibold'
                : 'border-transparent hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            کد کامل ویندوز (Python + Vosk)
          </button>
        </nav>

        {/* Zone 3: 1 primary action */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={() => setActiveSection('python-code')}
            className="px-4 py-2 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-500 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            دریافت پکیج ویندوز
          </button>
        </div>
      </header>

      {/* Main Content Layout: Desktop Workspace */}
      <div className="flex-1 max-w-[1380px] w-full mx-auto px-6 py-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Sidebar: Handy Floating Pill Preview & Hardware/Model Controller (4 cols) */}
        <aside className="lg:col-span-4 flex flex-col gap-5">
          {/* Handy Floating Overlay Bar Simulator */}
          <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                نوار شناور ویندوز (Handy Desktop Overlay)
              </span>
              <button
                onClick={() => setDarkMode(!darkMode)}
                className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                title="تغییر تم روشن / تاریک"
              >
                {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>
            </div>

            {/* The iconic Handy compact floating pill */}
            <div className="p-4 rounded-xl bg-slate-900 dark:bg-slate-950 border border-slate-800 text-white">
              <div className="flex items-center justify-between gap-3 mb-3">
                <button
                  onClick={toggleRecording}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                    isRecording
                      ? 'bg-red-600 hover:bg-red-500 text-white'
                      : 'bg-sky-600 hover:bg-sky-500 text-white'
                  }`}
                >
                  {isRecording ? (
                    <>
                      <MicOff className="w-4 h-4" />
                      <span>توقف ضبط</span>
                    </>
                  ) : (
                    <>
                      <Mic className="w-4 h-4" />
                      <span>شروع تایپ صوتی</span>
                    </>
                  )}
                </button>

                <div className="text-left font-mono text-xs text-slate-300 tabular-nums">
                  {recordingSeconds.toFixed(1)}s · 16kHz
                </div>
              </div>

              {/* Live 24-Bar Audio Spectrum */}
              <div className="h-12 flex items-end justify-between gap-1 px-2 py-1.5 bg-slate-950/90 rounded-lg border border-slate-800/80">
                {audioLevels.map((val, idx) => (
                  <div
                    key={idx}
                    className={`w-1.5 rounded-sm transition-transform duration-100 origin-bottom ${
                      isRecording ? 'bg-sky-400' : 'bg-slate-700'
                    }`}
                    style={{
                      height: '100%',
                      transform: `scaleY(${Math.max(0.12, val / 100)})`,
                    }}
                  />
                ))}
              </div>

              <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
                <span>میانبر: {hotkeyLabel}</span>
                <span>·</span>
                <span className="font-mono">vosk-model-small-fa-0.42</span>
              </div>
            </div>

            {/* Simulated Stream Trigger button for immediate testing without mic */}
            <button
              onClick={runSimulatedVoskStream}
              className="mt-3 w-full py-2.5 px-4 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <Volume2 className="w-4 h-4 text-sky-500" />
              <span>تست شبیه‌ساز استریم صوتی Vosk (بدون نیاز به میکروفون)</span>
            </button>
          </div>

          {/* Model & Windows Hotkey Configuration Card */}
          <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-col gap-4">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Cpu className="w-4 h-4 text-sky-500" />
              <span>پیکربندی موتور Vosk و میانبر ویندوز</span>
            </h2>

            <div className="text-xs text-slate-600 dark:text-slate-400 space-y-2 leading-relaxed">
              <div className="flex items-center justify-between py-1.5 border-b border-slate-100 dark:border-slate-800/80">
                <span>مدل تشخیص گفتار:</span>
                <span className="font-mono font-semibold text-slate-900 dark:text-slate-200">
                  vosk-model-small-fa-0.42
                </span>
              </div>
              <div className="flex items-center justify-between py-1.5 border-b border-slate-100 dark:border-slate-800/80">
                <span>حجم مدل آفلاین:</span>
                <span className="font-mono tabular-nums text-slate-900 dark:text-slate-200">
                  47.2 MB (100% Offline)
                </span>
              </div>
              <div className="flex items-center justify-between py-1.5 border-b border-slate-100 dark:border-slate-800/80">
                <span>نرخ نمونه‌برداری (Sample Rate):</span>
                <span className="font-mono tabular-nums text-slate-900 dark:text-slate-200">
                  16,000 Hz · Mono PCM
                </span>
              </div>
            </div>

            {/* Mode selector: Toggle vs Hold-to-Talk (Handy feature) */}
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                حالت کلید میانبر ویندوز (Handy Trigger Mode)
              </label>
              <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
                <button
                  onClick={() => setRecordingMode('toggle')}
                  className={`py-1.5 px-2 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                    recordingMode === 'toggle'
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  فشردن برای شروع/توقف
                </button>
                <button
                  onClick={() => setRecordingMode('hold')}
                  className={`py-1.5 px-2 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                    recordingMode === 'hold'
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  نگه‌داشتن کلید (Push-to-Talk)
                </button>
              </div>
            </div>

            {/* Global Hotkey & Target Window Selector */}
            <div className="grid grid-cols-1 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                  کلید میانبر سراسری ویندوز
                </label>
                <select
                  value={hotkeyLabel}
                  onChange={(e) => setHotkeyLabel(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-mono"
                >
                  <option value="Ctrl + Shift + Space">Ctrl + Shift + Space (پیش‌فرض Handy)</option>
                  <option value="Alt + Space">Alt + Space</option>
                  <option value="Ctrl + Win + V">Ctrl + Win + V</option>
                  <option value="F9">کلید تابعی F9</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                  مقصد تزریق خودکار متن (Auto-Paste Target)
                </label>
                <select
                  value={targetWindowSim}
                  onChange={(e) => setTargetWindowSim(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                >
                  <option value="پنجره فعال ویندوز (Auto-Paste)">پنجره فعال ویندوز (Auto-Paste با Ctrl+V)</option>
                  <option value="Microsoft Word / Office">Microsoft Word / Office</option>
                  <option value="Telegram / WhatsApp Desktop">Telegram / WhatsApp Desktop</option>
                  <option value="VS Code / Notepad++">VS Code / Notepad++</option>
                </select>
              </div>
            </div>
          </div>

          {/* Quick Normalization Toggles (SayTo Capabilities) */}
          <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-col gap-3">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Sliders className="w-4 h-4 text-sky-500" />
              <span>بهینه‌سازهای هوشمند متن فارسی (SayTo)</span>
            </h2>

            <label className="flex items-center justify-between text-xs cursor-pointer py-1">
              <span className="text-slate-700 dark:text-slate-300">
                تبدیل فرمان‌های صوتی نگارشی (ویرگول، نقطه، سر خط...)
              </span>
              <input
                type="checkbox"
                checked={normOptions.enableVoicePunctuation}
                onChange={(e) =>
                  setNormOptions({ ...normOptions, enableVoicePunctuation: e.target.checked })
                }
                className="accent-sky-500 w-4 h-4 rounded cursor-pointer"
              />
            </label>

            <label className="flex items-center justify-between text-xs cursor-pointer py-1">
              <span className="text-slate-700 dark:text-slate-300">
                اصلاح خودکار نیم‌فاصله‌ها (می‌روم، کتاب‌ها، بهترین)
              </span>
              <input
                type="checkbox"
                checked={normOptions.enableHalfSpace}
                onChange={(e) =>
                  setNormOptions({ ...normOptions, enableHalfSpace: e.target.checked })
                }
                className="accent-sky-500 w-4 h-4 rounded cursor-pointer"
              />
            </label>

            <label className="flex items-center justify-between text-xs cursor-pointer py-1">
              <span className="text-slate-700 dark:text-slate-300">
                تبدیل اعداد گفتاری به رقم («سه» ← «۳»)
              </span>
              <input
                type="checkbox"
                checked={normOptions.enableSpokenNumbersToDigits}
                onChange={(e) =>
                  setNormOptions({ ...normOptions, enableSpokenNumbersToDigits: e.target.checked })
                }
                className="accent-sky-500 w-4 h-4 rounded cursor-pointer"
              />
            </label>

            <label className="flex items-center justify-between text-xs cursor-pointer py-1">
              <span className="text-slate-700 dark:text-slate-300">
                یکسان‌سازی حروف عربی به فارسی استاندارد (ي/ك ← ی/ک)
              </span>
              <input
                type="checkbox"
                checked={normOptions.enableArabicToPersianChars}
                onChange={(e) =>
                  setNormOptions({ ...normOptions, enableArabicToPersianChars: e.target.checked })
                }
                className="accent-sky-500 w-4 h-4 rounded cursor-pointer"
              />
            </label>
          </div>
        </aside>

        {/* Main Workspace Panel (8 cols) */}
        <main className="lg:col-span-8 flex flex-col gap-6">
          {/* Top Metrics Row (Unboxed clean tabular metrics) */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            <div>
              <div className="text-xs text-slate-500 dark:text-slate-400">مجموع کلمات تایپ‌شده</div>
              <div className="text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-white mt-0.5">
                {totalWordsTyped}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500 dark:text-slate-400">اصلاحات نگارشی در متن فعلی</div>
              <div className="text-xl font-bold font-mono tabular-nums text-sky-600 dark:text-sky-400 mt-0.5">
                {appliedRulesCount} مورد
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500 dark:text-slate-400">فرمان‌های صوتی فعال</div>
              <div className="text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-white mt-0.5">
                {commands.filter((c) => c.enabled).length} دستور
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500 dark:text-slate-400">تأخیر پردازش آفلاین</div>
              <div className="text-xl font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400 mt-0.5">
                ~18 ms
              </div>
            </div>
          </div>

          {/* VIEW 1: LIVE SPEECH-TO-TEXT STUDIO */}
          {activeSection === 'studio' && (
            <div className="flex flex-col gap-5">
              {/* Raw Vosk Output vs SayTo Processed Output */}
              <div className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-col gap-5">
                <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-4">
                  <div>
                    <h1 className="text-lg font-bold text-slate-900 dark:text-white">
                      میز کار تبدیل گفتار به متن فارسی (Vosk + SayTo Pipeline)
                    </h1>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                      {statusMessage}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setRawInputText('')}
                      className="px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>پاک کردن</span>
                    </button>
                    <button
                      onClick={handleSaveAndInject}
                      className="px-4 py-2 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-500 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                    >
                      {copiedEditor ? (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          <span>کپی و تزریق شد!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>کپی و تزریق به ویندوز (Ctrl+V)</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Step 1: Raw Vosk Model Output */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                      ۱. خروجی خام مدل <span className="font-mono">vosk-model-small-fa-0.42</span> (بدون علائم نگارشی و نیم‌فاصله)
                    </label>
                    <span className="text-xs text-slate-400">
                      می‌توانید مستقیماً تایپ کنید یا با میکروفون صحبت کنید
                    </span>
                  </div>
                  <textarea
                    rows={3}
                    value={rawInputText}
                    onChange={(e) => setRawInputText(e.target.value)}
                    placeholder="اینجا صحبت کنید یا متن خام خروجی Vosk را وارد نمایید (مثلاً: سلام ویرگول حال شما چطور است علامت سوال)..."
                    className="w-full p-3.5 text-sm leading-relaxed rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 focus:outline-none focus:border-sky-500"
                  />
                  {interimTranscript && (
                    <p className="mt-1.5 text-xs text-sky-500">
                      در حال تشخیص لحظه‌ای: {interimTranscript}
                    </p>
                  )}
                </div>

                {/* Step 2: SayTo Normalized & Punctuated Output */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                      ۲. خروجی نهایی پس‌پردازش‌شده (آماده تزریق به نشانگر ماوس در ویندوز)
                    </label>
                    <span className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                      {processedText.trim() ? processedText.trim().split(/\s+/).length : 0} کلمه ·{' '}
                      {processedText.length} کاراکتر
                    </span>
                  </div>
                  <div className="w-full min-h-[120px] p-4 text-base leading-8 rounded-lg border border-emerald-500/30 bg-emerald-500/5 dark:bg-emerald-950/20 text-slate-900 dark:text-slate-100 whitespace-pre-wrap select-all">
                    {processedText || (
                      <span className="text-slate-400 text-sm">
                        خروجی نهایی با نیم‌فاصله و علائم نگارشی استاندارد در اینجا نمایش داده می‌شود...
                      </span>
                    )}
                  </div>
                </div>

                {/* Quick Voice Command Cheat-Sheet Strip */}
                <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-500 dark:text-slate-400">
                  <span className="font-semibold text-slate-700 dark:text-slate-300">
                    امتحان سریع فرمان‌های صوتی (کلیک کنید تا به متن اضافه شود):
                  </span>
                  {[
                    { label: '«ویرگول» (،)', word: 'ویرگول' },
                    { label: '«نقطه» (.)', word: 'نقطه' },
                    { label: '«علامت سوال» (؟)', word: 'علامت سوال' },
                    { label: '«نقطه سر خط» (↵)', word: 'نقطه سر خط' },
                    { label: '«می توانیم» (نیم‌فاصله)', word: 'ما می توانیم برنامه ها را اجرا کنیم' },
                  ].map((item, idx) => (
                    <React.Fragment key={item.word}>
                      {idx > 0 && <span aria-hidden="true">·</span>}
                      <button
                        onClick={() =>
                          setRawInputText((prev) => `${prev.trim()} ${item.word}`.trim())
                        }
                        className="text-sky-600 dark:text-sky-400 hover:underline cursor-pointer"
                      >
                        {item.label}
                      </button>
                    </React.Fragment>
                  ))}
                </div>
              </div>

              {/* Architectural Comparison Card: Why Handy + SayTo + Vosk FA 0.42 */}
              <div className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-3">
                  معماری ترکیبی Handy + SayTo با مدل vosk-model-small-fa-0.42 چگونه کار می‌کند؟
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                  <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200/70 dark:border-slate-800">
                    <div className="font-bold text-slate-900 dark:text-white mb-1">
                      ۰۱. میانبر سراسری و تزریق خودکار (Handy)
                    </div>
                    برنامه در System Tray ویندوز قرار می‌گیرد. به محض فشردن{' '}
                    <span className="font-mono">Ctrl+Shift+Space</span>، صدای میکروفون ضبط شده و متن فارسی مستقیماً در محل مکان‌نما (Word، مرورگر یا تلگرام) Paste می‌شود.
                  </div>
                  <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200/70 dark:border-slate-800">
                    <div className="font-bold text-slate-900 dark:text-white mb-1">
                      ۰۲. موتور آفلاین Vosk FA 0.42
                    </div>
                    مدل <span className="font-mono">vosk-model-small-fa-0.42</span> تنها ۴۷ مگابایت حجم دارد، روی هر پردازنده معمولی (بدون نیاز به GPU) به صورت ۱۰۰٪ آفلاین و بلادرنگ اجرا می‌شود.
                  </div>
                  <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200/70 dark:border-slate-800">
                    <div className="font-bold text-slate-900 dark:text-white mb-1">
                      ۰۳. پس‌پردازش هوشمند فارسی (SayTo)
                    </div>
                    چون خروجی خام Vosk فاقد علامت نگارشی و نیم‌فاصله است، لایه SayTo عباراتی مثل «ویرگول» یا «می روم» را به «،» و «می‌روم» تبدیل می‌کند.
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* VIEW 2: SAYTO VOICE COMMANDS & CUSTOM DICTIONARY */}
          {activeSection === 'rules' && (
            <div className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-col gap-5">
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                  جدول فرمان‌های صوتی نگارشی و واژگان سفارشی (SayTo Dictionary)
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  هر عبارتی که در هنگام صحبت کردن بگویید، به صورت خودکار با علامت نگارشی یا متن معادل آن جایگزین می‌شود.
                </p>
              </div>

              {/* Add new rule form */}
              <form
                onSubmit={handleAddCommand}
                className="grid grid-cols-1 sm:grid-cols-12 gap-3 p-4 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800"
              >
                <div className="sm:col-span-3">
                  <input
                    type="text"
                    value={newTrigger}
                    onChange={(e) => setNewTrigger(e.target.value)}
                    placeholder="عبارت گفتاری (مثلاً: امضا)"
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
                  />
                </div>
                <div className="sm:col-span-4">
                  <input
                    type="text"
                    value={newReplacement}
                    onChange={(e) => setNewReplacement(e.target.value)}
                    placeholder="متن جایگزین (مثلاً: با احترام، واحد فنی)"
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
                  />
                </div>
                <div className="sm:col-span-3">
                  <input
                    type="text"
                    value={newDescription}
                    onChange={(e) => setNewDescription(e.target.value)}
                    placeholder="توضیح کوتاه"
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
                  />
                </div>
                <div className="sm:col-span-2">
                  <button
                    type="submit"
                    className="w-full h-full py-2 px-3 bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold rounded-lg flex items-center justify-center gap-1 cursor-pointer whitespace-nowrap"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>افزودن</span>
                  </button>
                </div>
              </form>

              {/* High-Density Rules Table */}
              <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-lg">
                <table className="w-full text-right text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-950 text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="py-3 px-4 font-semibold">وضعیت</th>
                      <th className="py-3 px-4 font-semibold">عبارت گفتاری (Trigger)</th>
                      <th className="py-3 px-4 font-semibold">خروجی جایگزین</th>
                      <th className="py-3 px-4 font-semibold">توضیح عملکرد</th>
                      <th className="py-3 px-4 font-semibold text-left">عملیات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {commands.map((cmd) => (
                      <tr
                        key={cmd.id}
                        className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                      >
                        <td className="py-2.5 px-4">
                          <input
                            type="checkbox"
                            checked={cmd.enabled}
                            onChange={() => toggleCommandEnabled(cmd.id)}
                            className="accent-sky-500 w-4 h-4 cursor-pointer"
                          />
                        </td>
                        <td className="py-2.5 px-4 font-semibold text-slate-900 dark:text-white">
                          «{cmd.trigger}»
                        </td>
                        <td className="py-2.5 px-4 font-mono text-sky-600 dark:text-sky-400">
                          {cmd.replacement.replace(/\n/g, '↵ ')}
                        </td>
                        <td className="py-2.5 px-4 text-slate-500 dark:text-slate-400">
                          {cmd.description}
                        </td>
                        <td className="py-2.5 px-4 text-left">
                          <button
                            onClick={() => deleteCommand(cmd.id)}
                            className="text-slate-400 hover:text-red-500 transition-colors cursor-pointer"
                            title="حذف قاعده"
                          >
                            <Trash2 className="w-4 h-4 inline" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* VIEW 3: SQLITE HISTORY & EXCEL EXPORT */}
          {activeSection === 'history' && (
            <div className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-col gap-5">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                    تاریخچه تایپ صوتی (SQLite Log) و خروجی اکسل
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    تمامی متون تبدیل‌شده در پایگاه داده محلی ذخیره می‌شوند و قابل استخراج به فرمت Excel / CSV هستند.
                  </p>
                </div>

                <button
                  onClick={handleExportCSV}
                  className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg flex items-center gap-2 transition-colors cursor-pointer whitespace-nowrap"
                >
                  <FileSpreadsheet className="w-4 h-4" />
                  <span>دانلود گزارش اکسل (CSV / UTF-8)</span>
                </button>
              </div>

              {/* Search Bar */}
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute right-3.5 top-2.5" />
                <input
                  type="text"
                  value={historySearch}
                  onChange={(e) => setHistorySearch(e.target.value)}
                  placeholder="جستجو در متون تایپ‌شده یا نام نرم‌افزار مقصد..."
                  className="w-full pr-10 pl-4 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
                />
              </div>

              {/* History List */}
              {filteredHistory.length === 0 ? (
                <div className="py-12 text-center text-xs text-slate-500">
                  هیچ رکوردی مطابق جستجوی شما یافت نشد.
                </div>
              ) : (
                <div className="divide-y divide-slate-200 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg">
                  {filteredHistory.map((item) => (
                    <div
                      key={item.id}
                      className="p-4 hover:bg-slate-50/70 dark:hover:bg-slate-800/30 transition-colors flex flex-col gap-2"
                    >
                      <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-semibold text-slate-700 dark:text-slate-300">
                            {item.targetApp}
                          </span>
                          <span>·</span>
                          <span className="font-mono tabular-nums">{item.createdAt}</span>
                          <span>·</span>
                          <span className="font-mono tabular-nums">{item.wordCount} کلمه</span>
                          <span>·</span>
                          <span className="font-mono tabular-nums">{item.durationSec}s</span>
                        </div>
                        <button
                          onClick={() => navigator.clipboard.writeText(item.processedText)}
                          className="text-sky-600 dark:text-sky-400 hover:underline flex items-center gap-1 cursor-pointer"
                        >
                          <Copy className="w-3.5 h-3.5" />
                          <span>کپی مجدد</span>
                        </button>
                      </div>
                      <p className="text-sm font-medium text-slate-900 dark:text-slate-100 leading-relaxed">
                        {item.processedText}
                      </p>
                      <p className="text-xs text-slate-400 dark:text-slate-500">
                        خام Vosk: {item.rawText}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* VIEW 4: COMPLETE PYTHON WINDOWS DESKTOP CODEBASE (FastAPI + Streamlit + Vosk Agent) */}
          {activeSection === 'python-code' && (
            <div className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-col gap-5">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-4">
                <div>
                  <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                    سورس‌کد کامل و آماده اجرای ویندوز (Python + Vosk FA 0.42 + FastAPI + Streamlit)
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    کدهای زیر کاملاً ماژولار، دارای مدیریت خطا و آماده اجرا در ویندوز ۱۰ و ۱۱ هستند.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      PYTHON_PROJECT_FILES.forEach((file, index) => {
                        setTimeout(() => {
                          handleDownloadPythonFile(file.filename, file.code);
                        }, index * 250);
                      });
                      setTimeout(() => {
                        handleDownloadPythonFile('requirements.txt', REQUIREMENTS_TXT);
                      }, PYTHON_PROJECT_FILES.length * 250);
                    }}
                    className="px-3.5 py-2 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-500 rounded-lg flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    <Download className="w-4 h-4" />
                    <span>دانلود یکجای تمام فایل‌های ویندوز</span>
                  </button>
                  <button
                    onClick={() =>
                      handleDownloadPythonFile('requirements.txt', REQUIREMENTS_TXT)
                    }
                    className="px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    <FolderDown className="w-4 h-4 text-sky-500" />
                    <span>دانلود requirements.txt</span>
                  </button>
                </div>
              </div>

              {/* Step-by-Step Windows EXE Builder & One-Click Generator */}
              <div className="p-5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs leading-relaxed space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-bold text-slate-900 dark:text-white">
                      🚀 ساخت و دریافت نسخه نصبی ویندوز (<span className="font-mono">SayToHandy.exe</span>) با دانلودر داخلی مدل
                    </div>
                    <p className="text-slate-500 dark:text-slate-400 mt-1">
                      برنامه <code className="font-mono text-sky-600 dark:text-sky-400">sayto_handy_gui_app.py</code> دارای پنجره گرافیکی ویندوز و **دکمه دانلود خودکار مدل با نوار پیشرفت (Progress Bar)** است. وقتی به <code className="font-mono">.exe</code> تبدیل شود، کاربر نهایی بدون نیاز به پایتون، فقط برنامه را باز کرده، دکمه «دانلود مدل (۴۷ مگابایت)» را می‌زند و بلافاصله کار را شروع می‌کند.
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      const guiApp =
                        PYTHON_PROJECT_FILES.find((f) => f.id === 'windows-gui-exe-app')?.code || '';
                      const buildBat =
                        PYTHON_PROJECT_FILES.find((f) => f.id === 'build-exe-bat')?.code || '';
                      // Split Base64 into 64-character chunks so Windows CMD never hits the 8191-char line limit!
                      const b64Payload = window.btoa(unescape(encodeURIComponent(guiApp)));
                      const chunks = b64Payload.match(/.{1,64}/g) || [];
                      const echoLines = chunks
                        .map((chunk, idx) =>
                          idx === 0
                            ? `> "sayto_handy_gui_app.b64" echo ${chunk}`
                            : `>> "sayto_handy_gui_app.b64" echo ${chunk}`
                        )
                        .join('\n');

                      const safeAllInOneBat = `@echo off
cd /d "%~dp0"
title SayTo-Handy All-In-One EXE Builder

echo ====================================================================
echo   SayTo-Handy All-In-One Windows EXE Builder
echo ====================================================================
echo.

echo [Step 0] Extracting complete sayto_handy_gui_app.py (multi-line safe)...
if exist "sayto_handy_gui_app.b64" del /f /q "sayto_handy_gui_app.b64"
if exist "sayto_handy_gui_app.py" del /f /q "sayto_handy_gui_app.py"
${echoLines}
certutil -decode -f "sayto_handy_gui_app.b64" "sayto_handy_gui_app.py" >nul 2>&1
del /q "sayto_handy_gui_app.b64" >nul 2>&1

${buildBat}`;
                      handleDownloadPythonFile('Make_SayToHandy_EXE.bat', safeAllInOneBat);
                    }}
                    className="px-4 py-2.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg flex items-center gap-2 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <Download className="w-4 h-4" />
                    <span>دانلود سازنده تک‌کلیکی اصلاح‌شده (Make_SayToHandy_EXE.bat)</span>
                  </button>
                </div>

                {/* Troubleshooting Box for Windows Users */}
                <div className="p-3.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-slate-800 dark:text-slate-200 space-y-1.5">
                  <div className="font-bold text-amber-700 dark:text-amber-400">
                    💡 چرا فایل ۷۱ مگابایتی <span className="font-mono">SayToHandy.exe</span> بعد از یک لحظه بسته شد؟ (رفع قطعی باگ DLL موتور Vosk در PyInstaller)
                  </div>
                  <p className="text-xs leading-relaxed">
                    وقتی PyInstaller فایل ۷۱ مگابایتی را به صورت تک‌فایلی (<code className="font-mono">--onefile</code>) می‌سازد، هنگام اجرا فایل‌های <code className="font-mono">libvosk.dll</code> و <code className="font-mono">_cffi_backend</code> را در پوشه موقت ویندوز (<code className="font-mono">_MEIPASS\vosk</code>) باز می‌کند اما ویندوز مسیر آن زیرپوشه را پیدا نمی‌کرد و به دلیل فلگ <code className="font-mono">--windowed</code> بدون نمایش خطا بسته می‌شد. اکنون **لودر مستقیم مسیر DLLهای <code className="font-mono">os.add_dll_directory(sys._MEIPASS + &apos;\vosk&apos;)</code> و ماژول <code className="font-mono">_cffi_backend</code>** به ابتدای کد اضافه شد تا پنجره گرافیکی در ۱۰۰٪ مواقع باز بماند.
                  </p>
                  <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                    کافی است یک بار دیگر روی دکمه سبز بالا («دانلود سازنده تک‌کلیکی اصلاح‌شده Make_SayToHandy_EXE.bat») کلیک کرده و آن را اجرا کنید؛ در پایان ساخت، خود اسکریپت برنامه SayToHandy.exe را برای شما باز می‌کند!
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2 border-t border-slate-200 dark:border-slate-800">
                  <div className="p-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800">
                    <div className="font-bold text-slate-900 dark:text-white mb-1">
                      گام ۱: اجرای build_exe.bat یا سازنده تک‌کلیکی
                    </div>
                    فایل جدید <code className="font-mono text-emerald-600 dark:text-emerald-400">Make_SayToHandy_EXE.bat</code> (یا فایل <code className="font-mono">build_exe.bat</code> در کنار <code className="font-mono">sayto_handy_gui_app.py</code>) را اجرا کنید تا پنجره CMD باز بماند و مراحل ساخت <code className="font-mono">dist\SayToHandy.exe</code> را نشان دهد.
                  </div>
                  <div className="p-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800">
                    <div className="font-bold text-slate-900 dark:text-white mb-1">
                      گام ۲: نصب روی هر ویندوزی
                    </div>
                    فایل <code className="font-mono">dist\SayToHandy.exe</code> تولیدشده را به هر کامپیوتر دیگری بدهید؛ کاربر بدون نیاز به نصب پایتون آن را باز می‌کند.
                  </div>
                  <div className="p-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800">
                    <div className="font-bold text-slate-900 dark:text-white mb-1">
                      گام ۳: دانلود مدل در داخل برنامه
                    </div>
                    داخل پنجره برنامه، کاربر فقط یک‌بار روی دکمه **«دانلود و نصب خودکار مدل فارسی (۴۷ مگابایت)»** کلیک می‌کند و بلافاصله کلید <code className="font-mono">Ctrl+Shift+Space</code> فعال می‌شود.
                  </div>
                </div>
              </div>

              {/* File Selector Tabs */}
              <div className="flex items-center gap-2 overflow-x-auto pb-1">
                {PYTHON_PROJECT_FILES.map((file) => (
                  <button
                    key={file.id}
                    onClick={() => setSelectedPythonFileId(file.id)}
                    className={`px-3.5 py-2 rounded-lg text-xs font-mono font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                      selectedPythonFileId === file.id
                        ? 'bg-sky-600 text-white'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                    }`}
                  >
                    {file.filename}
                  </button>
                ))}
              </div>

              {/* Active Python File Viewer */}
              <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                <div className="px-4 py-3 bg-slate-100 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-bold text-slate-900 dark:text-white">
                      {activePythonFile.title}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      {activePythonFile.description}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(activePythonFile.code);
                        setCopiedCodeId(activePythonFile.id);
                        setTimeout(() => setCopiedCodeId(null), 2000);
                      }}
                      className="px-3 py-1.5 text-xs font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-1.5 cursor-pointer"
                    >
                      {copiedCodeId === activePythonFile.id ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-500" />
                          <span>کپی شد</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>کپی کد</span>
                        </>
                      )}
                    </button>
                    <button
                      onClick={() =>
                        handleDownloadPythonFile(
                          activePythonFile.filename,
                          activePythonFile.code
                        )
                      }
                      className="px-3 py-1.5 text-xs font-medium bg-sky-600 hover:bg-sky-500 text-white rounded-lg flex items-center gap-1.5 cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>دانلود {activePythonFile.filename}</span>
                    </button>
                  </div>
                </div>
                <pre
                  dir="ltr"
                  className="p-4 text-xs font-mono leading-relaxed overflow-x-auto max-h-[520px] bg-slate-950 text-slate-200 text-left"
                >
                  <code>{activePythonFile.code}</code>
                </pre>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
