"use strict";

const SUPPORTED_LANGUAGES = Object.freeze([
  "en",
  "hinglish",
  "hi",
  "bn",
  "mr",
  "gu",
  "pa",
  "ta",
  "te",
  "kn",
  "ml"
]);

const messages = {
  en: {
    permissionDenied: "Permission denied. Admin only.",
    reportReceived: "Report received. An admin will review this.",
    unknownCommand: "Unknown command. Type /help.",
    help: "User: /help /rules /report /admin /status. Admin: /kick /ban /mute /warn /summary."
  },
  hinglish: {
    permissionDenied: "Permission denied. Sirf admin.",
    reportReceived: "Report mil gaya. Admin review karega.",
    unknownCommand: "Unknown command. /help type karein.",
    help: "User: /help /rules /report /admin /status. Admin: /kick /ban /mute /warn /summary."
  },
  hi: {
    permissionDenied: "अनुमति नहीं है। केवल एडमिन।",
    reportReceived: "रिपोर्ट मिल गई। एडमिन समीक्षा करेगा।",
    unknownCommand: "अज्ञात कमांड। /help लिखें।",
    help: "यूजर: /help /rules /report /admin /status. एडमिन: /kick /ban /mute /warn /summary."
  },
  bn: {
    permissionDenied: "অনুমতি নেই। শুধু অ্যাডমিন।",
    reportReceived: "রিপোর্ট পাওয়া গেছে। অ্যাডমিন দেখবেন।",
    unknownCommand: "অজানা কমান্ড। /help লিখুন।",
    help: "User: /help /rules /report /admin /status. Admin: /kick /ban /mute /warn /summary."
  },
  mr: {
    permissionDenied: "परवानगी नाही. फक्त अॅडमिन.",
    reportReceived: "रिपोर्ट मिळाला. अॅडमिन तपासेल.",
    unknownCommand: "अज्ञात कमांड. /help लिहा.",
    help: "User: /help /rules /report /admin /status. Admin: /kick /ban /mute /warn /summary."
  },
  gu: {
    permissionDenied: "પરવાનગી નથી. ફક્ત એડમિન.",
    reportReceived: "રિપોર્ટ મળ્યો. એડમિન સમીક્ષા કરશે.",
    unknownCommand: "અજ્ઞાત કમાન્ડ. /help લખો.",
    help: "User: /help /rules /report /admin /status. Admin: /kick /ban /mute /warn /summary."
  },
  pa: {
    permissionDenied: "ਇਜਾਜ਼ਤ ਨਹੀਂ। ਸਿਰਫ਼ ਐਡਮਿਨ।",
    reportReceived: "ਰਿਪੋਰਟ ਮਿਲ ਗਈ। ਐਡਮਿਨ ਸਮੀਖਿਆ ਕਰੇਗਾ।",
    unknownCommand: "ਅਣਜਾਣ ਕਮਾਂਡ। /help ਲਿਖੋ।",
    help: "User: /help /rules /report /admin /status. Admin: /kick /ban /mute /warn /summary."
  },
  ta: {
    permissionDenied: "அனுமதி இல்லை. நிர்வாகி மட்டும்.",
    reportReceived: "புகார் பெறப்பட்டது. நிர்வாகி பரிசீலிப்பார்.",
    unknownCommand: "தெரியாத கட்டளை. /help எழுதுங்கள்.",
    help: "User: /help /rules /report /admin /status. Admin: /kick /ban /mute /warn /summary."
  },
  te: {
    permissionDenied: "అనుమతి లేదు. అడ్మిన్ మాత్రమే.",
    reportReceived: "రిపోర్ట్ అందింది. అడ్మిన్ పరిశీలిస్తారు.",
    unknownCommand: "తెలియని కమాండ్. /help టైప్ చేయండి.",
    help: "User: /help /rules /report /admin /status. Admin: /kick /ban /mute /warn /summary."
  },
  kn: {
    permissionDenied: "ಅನುಮತಿ ಇಲ್ಲ. ಅಡ್ಮಿನ್ ಮಾತ್ರ.",
    reportReceived: "ರಿಪೋರ್ಟ್ ಸ್ವೀಕರಿಸಲಾಗಿದೆ. ಅಡ್ಮಿನ್ ಪರಿಶೀಲಿಸುತ್ತಾರೆ.",
    unknownCommand: "ಅಪರಿಚಿತ ಕಮಾಂಡ್. /help ಟೈಪ್ ಮಾಡಿ.",
    help: "User: /help /rules /report /admin /status. Admin: /kick /ban /mute /warn /summary."
  },
  ml: {
    permissionDenied: "അനുമതി ഇല്ല. അഡ്മിൻ മാത്രം.",
    reportReceived: "റിപ്പോർട്ട് ലഭിച്ചു. അഡ്മിൻ പരിശോധിക്കും.",
    unknownCommand: "അറിയാത്ത കമാൻഡ്. /help ടൈപ്പ് ചെയ്യുക.",
    help: "User: /help /rules /report /admin /status. Admin: /kick /ban /mute /warn /summary."
  }
};

function detectLanguage(text = "") {
  if (/[ऀ-ॿ]/.test(text)) return "hi";
  if (/[\u0980-\u09FF]/.test(text)) return "bn";
  if (/[\u0A80-\u0AFF]/.test(text)) return "gu";
  if (/[\u0A00-\u0A7F]/.test(text)) return "pa";
  if (/[\u0B80-\u0BFF]/.test(text)) return "ta";
  if (/[\u0C00-\u0C7F]/.test(text)) return "te";
  if (/[\u0C80-\u0CFF]/.test(text)) return "kn";
  if (/[\u0D00-\u0D7F]/.test(text)) return "ml";
  if (/\b(kya|kaise|hai|nahi|madad|rules batao)\b/i.test(text)) return "hinglish";
  return "en";
}

function t(language, key) {
  const lang = SUPPORTED_LANGUAGES.includes(language) ? language : "en";
  return messages[lang]?.[key] || messages.en[key] || key;
}

module.exports = { SUPPORTED_LANGUAGES, detectLanguage, t };
