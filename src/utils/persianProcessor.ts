/**
 * موتور پردازش، نرمال‌سازی، تبدیل فرمان‌های صوتی نگارشی و اصلاح نیم‌فاصله برای متن فارسی
 * الهام گرفته از بهترین شیوه‌های SayTo و Vosk Persian Post-Processing
 */

export interface VoiceCommandRule {
  id: string;
  trigger: string;
  replacement: string;
  category: 'punctuation' | 'formatting' | 'custom';
  description: string;
  enabled: boolean;
}

export interface NormalizationOptions {
  enableVoicePunctuation: boolean;
  enableHalfSpace: boolean;
  enableArabicToPersianChars: boolean;
  enableSpokenNumbersToDigits: boolean;
  digitStyle: 'persian' | 'english';
}

export const DEFAULT_VOICE_COMMANDS: VoiceCommandRule[] = [
  { id: 'cmd-1', trigger: 'ویرگول', replacement: '، ', category: 'punctuation', description: 'درج ویرگول فارسی', enabled: true },
  { id: 'cmd-2', trigger: 'نقطه سر خط', replacement: '.\n', category: 'formatting', description: 'پایان جمله و رفتن به خط جدید', enabled: true },
  { id: 'cmd-3', trigger: 'سر خط', replacement: '\n', category: 'formatting', description: 'رفتن به خط جدید', enabled: true },
  { id: 'cmd-4', trigger: 'خط جدید', replacement: '\n', category: 'formatting', description: 'ایجاد سطر تازه', enabled: true },
  { id: 'cmd-5', trigger: 'پاراگراف جدید', replacement: '\n\n', category: 'formatting', description: 'ایجاد پاراگراف تازه', enabled: true },
  { id: 'cmd-6', trigger: 'علامت سوال', replacement: '؟ ', category: 'punctuation', description: 'درج علامت سؤال فارسی', enabled: true },
  { id: 'cmd-7', trigger: 'علامت تعجب', replacement: '! ', category: 'punctuation', description: 'درج علامت تعجب', enabled: true },
  { id: 'cmd-8', trigger: 'دونقطه', replacement: ': ', category: 'punctuation', description: 'درج دو نقطه توضیحی', enabled: true },
  { id: 'cmd-9', trigger: 'دو نقطه', replacement: ': ', category: 'punctuation', description: 'درج دو نقطه توضیحی', enabled: true },
  { id: 'cmd-10', trigger: 'نقطه ویرگول', replacement: '؛ ', category: 'punctuation', description: 'درج نقطه‌ویرگول فارسی', enabled: true },
  { id: 'cmd-11', trigger: 'پرانتز باز', replacement: ' (', category: 'punctuation', description: 'باز کردن پرانتز', enabled: true },
  { id: 'cmd-12', trigger: 'پرانتز بسته', replacement: ') ', category: 'punctuation', description: 'بستن پرانتز', enabled: true },
  { id: 'cmd-13', trigger: 'گیومه باز', replacement: ' «', category: 'punctuation', description: 'باز کردن گیومه فارسی', enabled: true },
  { id: 'cmd-14', trigger: 'گیومه بسته', replacement: '» ', category: 'punctuation', description: 'بستن گیومه فارسی', enabled: true },
  { id: 'cmd-15', trigger: 'نقطه', replacement: '. ', category: 'punctuation', description: 'درج نقطه پایان جمله', enabled: true },
];

const SPOKEN_NUMBERS_MAP: Record<string, string> = {
  'صفر': '0',
  'یک': '1',
  'دو': '2',
  'سه': '3',
  'چهار': '4',
  'پنج': '5',
  'شش': '6',
  'شیش': '6',
  'هفت': '7',
  'هشت': '8',
  'نه': '9',
  'ده': '10',
  'یازده': '11',
  'دوازده': '12',
  'سیزده': '13',
  'چهارده': '14',
  'پانزده': '15',
  'پونزده': '15',
  'شانزده': '16',
  'شونزده': '16',
  'هفده': '17',
  'هجده': '18',
  'نوزده': '19',
  'بیست': '20',
  'سی': '30',
  'چهل': '40',
  'پنجاه': '50',
  'شصت': '60',
  'هفتاد': '70',
  'هشتاد': '80',
  'نود': '90',
  'صد': '100',
  'دویست': '200',
  'سیصد': '300',
  'چهارصد': '400',
  'پانصد': '500',
  'هزار': '1000',
};

const PERSIAN_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];

export function toPersianDigits(text: string): string {
  return text.replace(/\d/g, (d) => PERSIAN_DIGITS[parseInt(d, 10)]);
}

export function toEnglishDigits(text: string): string {
  return text.replace(/[۰-۹]/g, (d) => String(PERSIAN_DIGITS.indexOf(d)));
}

/**
 * پردازش کامل خروجی خام مدل Vosk (vosk-model-small-fa-0.42)
 * از آنجایی که مدل Vosk متن را بدون علائم نگارشی و با فاصله معمولی برمی‌گرداند،
 * این تابع تمامی استانداردهای تایپوگرافی فارسی و دستورات صوتی SayTo را اعمال می‌کند.
 */
export function processPersianTranscript(
  rawText: string,
  options: NormalizationOptions,
  commands: VoiceCommandRule[]
): { processedText: string; appliedRulesCount: number } {
  if (!rawText) return { processedText: '', appliedRulesCount: 0 };

  let text = rawText;
  let appliedRulesCount = 0;

  // ۱. یکسان‌سازی حروف عربی به فارسی استاندارد (ی، ک، ه)
  if (options.enableArabicToPersianChars) {
    const before = text;
    text = text
      .replace(/ي/g, 'ی')
      .replace(/ى/g, 'ی')
      .replace(/ك/g, 'ک')
      .replace(/ة/g, 'ه')
      .replace(/ؤ/g, 'و');
    if (text !== before) appliedRulesCount++;
  }

  // ۲. اعمال دستورات صوتی نگارشی و واژگان سفارشی (مرتب‌سازی از طولانی‌ترین عبارت به کوتاه‌ترین)
  if (options.enableVoicePunctuation) {
    const activeCommands = commands
      .filter((c) => c.enabled && c.trigger.trim().length > 0)
      .sort((a, b) => b.trigger.length - a.trigger.length);

    for (const cmd of activeCommands) {
      const escapedTrigger = cmd.trigger.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // تطبیق در مرز کلمات فارسی
      const regex = new RegExp(`(^|\\s)${escapedTrigger}(?=\\s|$|[،.؟!])`, 'g');
      const matches = text.match(regex);
      if (matches) {
        appliedRulesCount += matches.length;
        text = text.replace(regex, (match) => {
          // اگر جایگزین علامت نگارشی چسبان به کلمه قبلی است، فاصله قبل را حذف کن
          if (/^[،.؟!:؛)]/.test(cmd.replacement)) {
            return cmd.replacement;
          }
          return match.startsWith(' ') ? ' ' + cmd.replacement : cmd.replacement;
        });
      }
    }
  }

  // ۳. اصلاح نیم‌فاصله‌ها (ZWNJ) در پیشوندها و پسوندهای رایج فارسی
  if (options.enableHalfSpace) {
    const before = text;
    // پیشوند افعال: می و نمی (مثلاً "می روم" -> "می‌روم"، "نمی دانم" -> "نمی‌دانم")
    text = text.replace(/(^|\s)(ن?می)\s+([آ-ی]{2,})/g, '$1$2‌$3');

    // پسوند جمع "ها" و "های" و "هایی" (مثلاً "کتاب ها" -> "کتاب‌ها")
    text = text.replace(/([آ-ی]{2,})\s+(های|هایی|ها)(?=\s|$|[،.؟!:؛])/g, '$1‌$2');

    // پسوند صفت تفضیلی و عالی "تر" و "ترین" (مثلاً "بهتر ین" یا "بزرگ تر")
    text = text.replace(/([آ-ی]{2,})\s+(ترین|تر)(?=\s|$|[،.؟!:؛])/g, '$1‌$2');

    // ضمایر ملکی/صرفی چسبان بعد از ه غیرملفوظ (مثلاً "خانه ام" -> "خانه‌ام")
    text = text.replace(/([آ-ی]+ه)\s+(ام|ات|اش|ایم|اید|اند|ای)(?=\s|$|[،.؟!:؛])/g, '$1‌$2');

    if (text !== before) appliedRulesCount++;
  }

  // ۴. تبدیل اعداد گفتاری به رقم
  if (options.enableSpokenNumbersToDigits) {
    const words = text.split(/(\s+)/);
    const convertedWords = words.map((token) => {
      const cleanToken = token.trim();
      if (SPOKEN_NUMBERS_MAP[cleanToken]) {
        appliedRulesCount++;
        return SPOKEN_NUMBERS_MAP[cleanToken];
      }
      return token;
    });
    text = convertedWords.join('');
  }

  // ۵. تبدیل استایل ارقام (فارسی یا انگلیسی)
  if (options.digitStyle === 'persian') {
    text = toPersianDigits(text);
  } else {
    text = toEnglishDigits(text);
  }

  // ۶. تمیزکاری فاصله‌های اضافه قبل از علائم نگارشی
  text = text
    .replace(/\s+([،.؟!:؛])/g, '$1')
    .replace(/([،.؟!:؛])(?=[^\s\n»)])/g, '$1 ')
    .replace(/[ \t]{2,}/g, ' ');

  return {
    processedText: text,
    appliedRulesCount,
  };
}

export const SAMPLE_RAW_VOSK_SENTENCES = [
  'سلام وقت بخیر ویرگول این یک تست از سیستم تشخیص گفتار آفلاین فارسی با مدل وسک است نقطه سر خط ما می توانیم متن ها را با سرعت بالا و دقت عالی در ویندوز تایپ کنیم علامت تعجب',
  'گزارش جلسه امروز دو نقطه بررسی عملکرد پروژه ها نشان می دهد که سرعت تایپ صوتی تا سه برابر سریع تر از تایپ دستی است ویرگول و هیچ داده ای به سرور ارسال نمی شود نقطه',
  'آیا می دانستید که مدل کوچک فارسی وسک تنها چهل مگابایت حجم دارد علامت سوال این ویژگی باعث می شود برنامه در تمام کامپیوتر ها بدون نیاز به کارت گرافیک اجرا شود نقطه',
];
