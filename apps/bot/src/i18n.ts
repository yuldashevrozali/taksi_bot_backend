// All bot texts live here. To add Russian later: add a `Language` enum value and one more entry.
import type { Language, OrderStatus } from "@prisma/client";

export interface Texts {
  chooseLanguage: string;
  languageSet: string;
  askPhone: string;
  sharePhoneButton: string;
  notOwnContact: string;
  invalidPhone: string;
  registered: string;
  menuTitle: string;
  driverMenuTitle: string;
  btnOrder: string;
  btnStatus: string;
  btnRepeat: string;
  btnCancel: string;
  btnOperator: string;
  btnDriverPanel: string;
  noOrders: string;
  orderStatus: (orderNumber: number, status: string) => string;
  comingSoon: string;
  miniAppUnavailable: string;
  openOrderPrompt: string;
  openDriverPrompt: string;
  menuButton: string;
  btnAdmin: string;
  btnBrowserLogin: string;
  adminPrompt: string;
  noAccess: string;
  repeatPrompt: (n: number) => string;
  cancelConfirm: (n: number) => string;
  btnCancelYes: string;
  cancelDone: string;
  cannotCancel: string;
  nothingToCancel: string;
  operator: (contact: string) => string;
  operatorUnset: string;
  notDriver: string;
  orderGone: string;
  takeOrderPrompt: (n: number) => string;
  btnTakeOrder: string;
  status: Record<OrderStatus, string>;
}

// Shown before the user has picked a language, so it is bilingual.
export const CHOOSE_LANGUAGE = "Tilni tanlang / Тилни танланг:";
export const LANGUAGE_BUTTONS: { lang: Language; label: string }[] = [
  { lang: "UZ_LATN", label: "O'zbekcha (lotin)" },
  { lang: "UZ_CYRL", label: "Ўзбекча (кирилл)" },
];

const UZ_LATN: Texts = {
  chooseLanguage: CHOOSE_LANGUAGE,
  languageSet: "Til tanlandi: O'zbekcha (lotin) ✅",
  askPhone: "Telefon raqamingizni yuboring. Pastdagi tugmani bosing 👇",
  sharePhoneButton: "📱 Telefon raqamni yuborish",
  notOwnContact: "Iltimos, o'zingizning raqamingizni pastdagi tugma orqali yuboring.",
  invalidPhone: "Telefon raqami noto'g'ri. Faqat O'zbekiston raqamlari (+998) qabul qilinadi.",
  registered: "Rahmat! Ro'yxatdan o'tdingiz ✅",
  menuTitle: "Asosiy menyu:",
  driverMenuTitle: "Haydovchi menyusi:",
  btnOrder: "🚕 Buyurtma berish",
  btnStatus: "📋 Buyurtma holati",
  btnRepeat: "🔁 Oxirgi buyurtmani takrorlash",
  btnCancel: "❌ Bekor qilish",
  btnOperator: "☎️ Operator",
  btnDriverPanel: "🚖 Haydovchi paneli",
  noOrders: "Sizda hali buyurtma yo'q.",
  orderStatus: (n, s) => `Buyurtma #${n}: ${s}`,
  comingSoon: "Bu funksiya tez orada ishga tushadi.",
  miniAppUnavailable: "Buyurtma berish hozircha mavjud emas (Mini App manzili sozlanmagan).",
  openOrderPrompt: "Buyurtma berish uchun quyidagi tugmani bosing 👇",
  openDriverPrompt: "Haydovchi panelini ochish uchun quyidagi tugmani bosing 👇",
  menuButton: "🚕 Taksi",
  btnAdmin: "🛠 Admin panel",
  btnBrowserLogin: "🌐 Brauzerda ochish (5 daqiqa)",
  adminPrompt: "Admin panelni oching 👇\nBrauzer havolasi bir martalik va 5 daqiqa amal qiladi.",
  noAccess: "⛔ Sizda bu bo'limga ruxsat yo'q.",
  repeatPrompt: (n) => `Buyurtma #${n} ma'lumotlari bilan yangi buyurtma ochiladi 👇`,
  cancelConfirm: (n) => `Buyurtma #${n} ni bekor qilasizmi?`,
  btnCancelYes: "❌ Ha, bekor qilish",
  cancelDone: "✅ Buyurtma bekor qilindi.",
  cannotCancel: "Bu buyurtmani endi bekor qilib bo'lmaydi.",
  nothingToCancel: "Bekor qilinadigan faol buyurtma yo'q.",
  operator: (c) => `☎️ Operator: ${c}`,
  operatorUnset: "☎️ Operator kontakti hali kiritilmagan.",
  notDriver: "⛔ Siz faol haydovchi sifatida ro'yxatda yo'qsiz.",
  orderGone: "Bu buyurtma allaqachon olingan yoki bekor qilingan.",
  takeOrderPrompt: (n) => `🚕 Buyurtma #${n}\nOchish va qabul qilish uchun pastdagi tugmani bosing 👇`,
  btnTakeOrder: "🚕 Buyurtmani olish",
  status: {
    PENDING: "Kutilmoqda",
    ACCEPTED: "Qabul qilindi",
    IN_PROGRESS: "Yo'lda",
    COMPLETED: "Yakunlandi",
    CANCELLED: "Bekor qilindi",
  },
};

const UZ_CYRL: Texts = {
  chooseLanguage: CHOOSE_LANGUAGE,
  languageSet: "Тил танланди: Ўзбекча (кирилл) ✅",
  askPhone: "Телефон рақамингизни юборинг. Пастдаги тугмани босинг 👇",
  sharePhoneButton: "📱 Телефон рақамни юбориш",
  notOwnContact: "Илтимос, ўзингизнинг рақамингизни пастдаги тугма орқали юборинг.",
  invalidPhone: "Телефон рақами нотўғри. Фақат Ўзбекистон рақамлари (+998) қабул қилинади.",
  registered: "Раҳмат! Рўйхатдан ўтдингиз ✅",
  menuTitle: "Асосий меню:",
  driverMenuTitle: "Ҳайдовчи менюси:",
  btnOrder: "🚕 Буюртма бериш",
  btnStatus: "📋 Буюртма ҳолати",
  btnRepeat: "🔁 Охирги буюртмани такрорлаш",
  btnCancel: "❌ Бекор қилиш",
  btnOperator: "☎️ Оператор",
  btnDriverPanel: "🚖 Ҳайдовчи панели",
  noOrders: "Сизда ҳали буюртма йўқ.",
  orderStatus: (n, s) => `Буюртма #${n}: ${s}`,
  comingSoon: "Бу функция тез орада ишга тушади.",
  miniAppUnavailable: "Буюртма бериш ҳозирча мавжуд эмас (Mini App манзили созланмаган).",
  openOrderPrompt: "Буюртма бериш учун қуйидаги тугмани босинг 👇",
  openDriverPrompt: "Ҳайдовчи панелини очиш учун қуйидаги тугмани босинг 👇",
  menuButton: "🚕 Такси",
  btnAdmin: "🛠 Админ панел",
  btnBrowserLogin: "🌐 Браузерда очиш (5 дақиқа)",
  adminPrompt: "Админ панелни очинг 👇\nБраузер ҳаволаси бир марталик ва 5 дақиқа амал қилади.",
  noAccess: "⛔ Сизда бу бўлимга рухсат йўқ.",
  repeatPrompt: (n) => `Буюртма #${n} маълумотлари билан янги буюртма очилади 👇`,
  cancelConfirm: (n) => `Буюртма #${n} ни бекор қиласизми?`,
  btnCancelYes: "❌ Ҳа, бекор қилиш",
  cancelDone: "✅ Буюртма бекор қилинди.",
  cannotCancel: "Бу буюртмани энди бекор қилиб бўлмайди.",
  nothingToCancel: "Бекор қилинадиган фаол буюртма йўқ.",
  operator: (c) => `☎️ Оператор: ${c}`,
  operatorUnset: "☎️ Оператор контакти ҳали киритилмаган.",
  notDriver: "⛔ Сиз фаол ҳайдовчи сифатида рўйхатда йўқсиз.",
  orderGone: "Бу буюртма аллақачон олинган ёки бекор қилинган.",
  takeOrderPrompt: (n) => `🚕 Буюртма #${n}\nОчиш ва қабул қилиш учун пастдаги тугмани босинг 👇`,
  btnTakeOrder: "🚕 Буюртмани олиш",
  status: {
    PENDING: "Кутилмоқда",
    ACCEPTED: "Қабул қилинди",
    IN_PROGRESS: "Йўлда",
    COMPLETED: "Якунланди",
    CANCELLED: "Бекор қилинди",
  },
};

export const TEXTS: Record<Language, Texts> = { UZ_LATN, UZ_CYRL };

/** Clients only see PENDING / ACCEPTED / CANCELLED; the trip stages are driver-internal. */
export function clientStatus(status: OrderStatus): "PENDING" | "ACCEPTED" | "CANCELLED" {
  return status === "PENDING" || status === "CANCELLED" ? status : "ACCEPTED";
}

export function t(lang: Language): Texts {
  return TEXTS[lang];
}

export type MenuAction = "order" | "status" | "repeat" | "cancel" | "operator" | "driverPanel" | "admin";

const ACTION_KEYS: Record<MenuAction, keyof Texts> = {
  order: "btnOrder",
  status: "btnStatus",
  repeat: "btnRepeat",
  cancel: "btnCancel",
  operator: "btnOperator",
  driverPanel: "btnDriverPanel",
  admin: "btnAdmin",
};

// Maps a pressed reply-keyboard button (in any language) back to its action.
export function menuActionFromText(text: string): MenuAction | null {
  for (const texts of Object.values(TEXTS)) {
    for (const [action, key] of Object.entries(ACTION_KEYS) as [MenuAction, keyof Texts][]) {
      if (texts[key] === text) return action;
    }
  }
  return null;
}
