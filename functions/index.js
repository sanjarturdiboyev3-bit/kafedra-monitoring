const functions = require("firebase-functions");
const admin = require("firebase-admin");
const axios = require("axios");

admin.initializeApp();
const db = admin.firestore();

const BOT_TOKEN = "9068326631:AAFF32-GOtwQ6Xdp9tAw5X8Xr04HBap7Wy0";
const API_URL = `https://api.telegram.org/bot${BOT_TOKEN}`;

// 1. Webhook: Bot xabarlarini qabul qilish
exports.telegramWebhook = functions.https.onRequest(async (req, res) => {
  const msg = req.body.message;
  if (!msg) return res.sendStatus(200);

  const chatId = msg.chat.id;

  if (msg.text === "/start") {
    await axios.post(`${API_URL}/sendMessage`, {
      chat_id: chatId,
      text: "Assalomu alaykum! Tizimga ulanish uchun telefon raqamingizni yuboring.",
      reply_markup: {
        keyboard: [[{ text: "📱 Telefon raqamni yuborish", request_contact: true }]],
        resize_keyboard: true,
        one_time_keyboard: true
      }
    });
  }

  if (msg.contact) {
    let phone = msg.contact.phone_number;
    if (!phone.startsWith("+")) phone = "+" + phone;

    const teachersRef = db.collection("teachers");
    const snapshot = await teachersRef.where("phone", "==", phone).get();

    if (snapshot.empty) {
      await axios.post(`${API_URL}/sendMessage`, {
        chat_id: chatId,
        text: "❌ Kechirasiz, bu raqam tizimda topilmadi. Administratorga murojaat qiling."
      });
    } else {
      const docId = snapshot.docs[0].id;
      await teachersRef.doc(docId).update({ chatId: String(chatId) });
      await axios.post(`${API_URL}/sendMessage`, {
        chat_id: chatId,
        text: "✅ Muvaffaqiyatli ro'yxatdan o'tdingiz! Endi tizim sizga vazifalar haqida eslatmalar yuboradi.",
        reply_markup: { remove_keyboard: true }
      });
    }
  }

  res.sendStatus(200);
});

// 2. Avtomatik eslatma (Har dushanba 09:00)
exports.weeklyReminder = functions.pubsub.schedule("0 9 * * 1").timeZone("Asia/Tashkent").onRun(async (context) => {
  const teachersSnap = await db.collection("teachers").get();
  const itemsSnap = await db.collection("items").get();
  const compsSnap = await db.collection("completions").get();

  const items = itemsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const comps = compsSnap.docs.map(d => d.data());

  for (const doc of teachersSnap.docs) {
    const teacher = { id: doc.id, ...doc.data() };
    if (!teacher.chatId) continue;

    const myItems = items.filter(i => i.teacher === teacher.id && !i.override);
    const openItems = myItems.filter(it => {
      const amount = comps.filter(c => c.item === it.id).reduce((sum, c) => sum + (Number(c.amount) || 0), 0);
      return (it.mode === "qty" && amount < it.target) || (it.mode === "bin" && amount === 0);
    });

    if (openItems.length === 0) continue;

    let text = `📋 Assalomu alaykum, ${teacher.name.split(" ")[1] || teacher.name}!\n\n`;
    text += `Sizning shaxsiy rejangiz bo'yicha bajarilmagan vazifalar:\n\n`;
    
    openItems.slice(0, 10).forEach(it => {
      text += `⏳ ${it.title}\n`;
    });
    
    if (openItems.length > 10) text += `... va yana ${openItems.length - 10} ta.\n`;
    text += `\nIltimos, ishlarni o'z vaqtida yakunlang.`;

    try {
      await axios.post(`${API_URL}/sendMessage`, { chat_id: teacher.chatId, text: text });
    } catch (e) {
      console.error(e.message);
    }
  }
});
