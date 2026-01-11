// Service Worker for Push Notifications ONLY
// No caching, no offline storage - notifications only

const SW_VERSION = '6.5.9';

// Transaction notification translations
const NOTIFICATION_TRANSLATIONS = {
  en: { newTx: 'New transaction received', amount: 'Amount', from: 'From' },
  ar: { newTx: 'تم استلام معاملة جديدة', amount: 'المبلغ', from: 'من' },
  fr: { newTx: 'Nouvelle transaction reçue', amount: 'Montant', from: 'De' },
  de: { newTx: 'Neue Transaktion erhalten', amount: 'Betrag', from: 'Von' },
  es: { newTx: 'Nueva transacción recibida', amount: 'Cantidad', from: 'De' },
  tr: { newTx: 'Yeni işlem alındı', amount: 'Miktar', from: 'Gönderen' },
  ru: { newTx: 'Получена новая транзакция', amount: 'Сумма', from: 'От' },
  zh: { newTx: '收到新交易', amount: '金额', from: '来自' },
  ja: { newTx: '新しい取引を受信しました', amount: '金額', from: '送信元' },
  ko: { newTx: '새 거래가 수신되었습니다', amount: '금액', from: '발신' },
  pt: { newTx: 'Nova transação recebida', amount: 'Quantia', from: 'De' },
  hi: { newTx: 'नया लेनदेन प्राप्त हुआ', amount: 'राशि', from: 'से' },
  it: { newTx: 'Nuova transazione ricevuta', amount: 'Importo', from: 'Da' },
  id: { newTx: 'Transaksi baru diterima', amount: 'Jumlah', from: 'Dari' },
  pl: { newTx: 'Otrzymano nową transakcję', amount: 'Kwota', from: 'Od' }
};

// Re-engagement notification translations
const RE_ENGAGEMENT_TRANSLATIONS = {
  en: {
    day3: { title: 'Access Network', body: 'Your session is ready! Tap to start a new activity.' },
    day5: { title: 'Welcome back!', body: 'Access Network is waiting for you. Start your session now.' },
    day7: { title: 'We miss you!', body: 'Your Access Network activity awaits. Come back and explore!' },
    day14: { title: 'Long time no see!', body: 'Access Network has updates for you. Tap to check in!' },
    day30: { title: 'Access Network', body: 'Your account is still active. Ready to continue?' }
  },
  ar: {
    day3: { title: 'Access Network', body: 'جلستك جاهزة! اضغط لبدء نشاط جديد.' },
    day5: { title: 'مرحباً بعودتك!', body: 'شبكة Access في انتظارك. ابدأ جلستك الآن.' },
    day7: { title: 'نفتقدك!', body: 'نشاطك في شبكة Access بانتظارك. عُد واستكشف!' },
    day14: { title: 'مدة طويلة!', body: 'لديك تحديثات في شبكة Access. اضغط للاطلاع!' },
    day30: { title: 'Access Network', body: 'حسابك لا يزال نشطاً. هل أنت مستعد للمتابعة؟' }
  },
  fr: {
    day3: { title: 'Access Network', body: 'Votre session est prête ! Appuyez pour démarrer.' },
    day5: { title: 'Bon retour !', body: 'Access Network vous attend. Commencez maintenant.' },
    day7: { title: 'Vous nous manquez !', body: 'Votre activité Access Network vous attend.' },
    day14: { title: 'Ça fait longtemps !', body: 'Access Network a des mises à jour pour vous.' },
    day30: { title: 'Access Network', body: 'Votre compte est toujours actif. Prêt à continuer ?' }
  },
  de: {
    day3: { title: 'Access Network', body: 'Ihre Sitzung ist bereit! Tippen Sie, um zu starten.' },
    day5: { title: 'Willkommen zurück!', body: 'Access Network wartet auf Sie.' },
    day7: { title: 'Wir vermissen dich!', body: 'Ihre Access Network-Aktivität wartet.' },
    day14: { title: 'Lange nicht gesehen!', body: 'Access Network hat Updates für Sie.' },
    day30: { title: 'Access Network', body: 'Ihr Konto ist noch aktiv. Bereit weiterzumachen?' }
  },
  es: {
    day3: { title: 'Access Network', body: '¡Tu sesión está lista! Toca para iniciar.' },
    day5: { title: '¡Bienvenido de nuevo!', body: 'Access Network te espera. Comienza ahora.' },
    day7: { title: '¡Te extrañamos!', body: 'Tu actividad en Access Network te espera.' },
    day14: { title: '¡Cuánto tiempo!', body: 'Access Network tiene actualizaciones para ti.' },
    day30: { title: 'Access Network', body: 'Tu cuenta sigue activa. ¿Listo para continuar?' }
  },
  tr: {
    day3: { title: 'Access Network', body: 'Oturumunuz hazır! Başlamak için dokunun.' },
    day5: { title: 'Tekrar hoş geldiniz!', body: 'Access Network sizi bekliyor.' },
    day7: { title: 'Sizi özledik!', body: 'Access Network aktiviteniz sizi bekliyor.' },
    day14: { title: 'Uzun zaman oldu!', body: 'Access Network sizin için güncellemeler var.' },
    day30: { title: 'Access Network', body: 'Hesabınız hala aktif. Devam etmeye hazır mısınız?' }
  },
  ru: {
    day3: { title: 'Access Network', body: 'Ваша сессия готова! Нажмите, чтобы начать.' },
    day5: { title: 'С возвращением!', body: 'Access Network ждет вас.' },
    day7: { title: 'Мы скучаем по вам!', body: 'Ваша активность в Access Network ждет.' },
    day14: { title: 'Давно не виделись!', body: 'Access Network имеет обновления для вас.' },
    day30: { title: 'Access Network', body: 'Ваш аккаунт все еще активен. Готовы продолжить?' }
  },
  zh: {
    day3: { title: 'Access Network', body: '您的会话已准备就绪！点击开始。' },
    day5: { title: '欢迎回来！', body: 'Access Network 正在等您。' },
    day7: { title: '我们想念您！', body: '您的 Access Network 活动正在等待您。' },
    day14: { title: '好久不见！', body: 'Access Network 有更新给您。' },
    day30: { title: 'Access Network', body: '您的账户仍然活跃。准备好继续了吗？' }
  },
  ja: {
    day3: { title: 'Access Network', body: 'セッションの準備ができました！タップして開始。' },
    day5: { title: 'おかえりなさい！', body: 'Access Network がお待ちしています。' },
    day7: { title: 'お待ちしておりました！', body: 'Access Network でのアクティビティがお待ちしています。' },
    day14: { title: 'お久しぶりです！', body: 'Access Network に更新があります。' },
    day30: { title: 'Access Network', body: 'アカウントはまだアクティブです。続ける準備はできましたか？' }
  },
  ko: {
    day3: { title: 'Access Network', body: '세션이 준비되었습니다! 탭하여 시작하세요.' },
    day5: { title: '다시 오신 것을 환영합니다!', body: 'Access Network가 기다리고 있습니다.' },
    day7: { title: '보고 싶었어요!', body: 'Access Network 활동이 기다리고 있습니다.' },
    day14: { title: '오랜만이에요!', body: 'Access Network에 업데이트가 있습니다.' },
    day30: { title: 'Access Network', body: '계정이 아직 활성 상태입니다. 계속할 준비가 되셨나요?' }
  },
  pt: {
    day3: { title: 'Access Network', body: 'Sua sessão está pronta! Toque para iniciar.' },
    day5: { title: 'Bem-vindo de volta!', body: 'Access Network está esperando por você.' },
    day7: { title: 'Sentimos sua falta!', body: 'Sua atividade no Access Network está esperando.' },
    day14: { title: 'Há quanto tempo!', body: 'Access Network tem atualizações para você.' },
    day30: { title: 'Access Network', body: 'Sua conta ainda está ativa. Pronto para continuar?' }
  },
  hi: {
    day3: { title: 'Access Network', body: 'आपका सत्र तैयार है! शुरू करने के लिए टैप करें।' },
    day5: { title: 'वापसी पर स्वागत है!', body: 'Access Network आपका इंतजार कर रहा है।' },
    day7: { title: 'हम आपको याद करते हैं!', body: 'आपकी Access Network गतिविधि आपका इंतजार कर रही है।' },
    day14: { title: 'बहुत समय हो गया!', body: 'Access Network में आपके लिए अपडेट हैं।' },
    day30: { title: 'Access Network', body: 'आपका खाता अभी भी सक्रिय है। जारी रखने के लिए तैयार?' }
  },
  it: {
    day3: { title: 'Access Network', body: 'La tua sessione è pronta! Tocca per iniziare.' },
    day5: { title: 'Bentornato!', body: 'Access Network ti aspetta.' },
    day7: { title: 'Ci manchi!', body: 'La tua attività su Access Network ti aspetta.' },
    day14: { title: 'È passato tanto tempo!', body: 'Access Network ha aggiornamenti per te.' },
    day30: { title: 'Access Network', body: 'Il tuo account è ancora attivo. Pronto a continuare?' }
  },
  id: {
    day3: { title: 'Access Network', body: 'Sesi Anda siap! Ketuk untuk memulai.' },
    day5: { title: 'Selamat datang kembali!', body: 'Access Network menunggu Anda.' },
    day7: { title: 'Kami rindu Anda!', body: 'Aktivitas Access Network Anda menunggu.' },
    day14: { title: 'Sudah lama!', body: 'Access Network punya pembaruan untuk Anda.' },
    day30: { title: 'Access Network', body: 'Akun Anda masih aktif. Siap melanjutkan?' }
  },
  pl: {
    day3: { title: 'Access Network', body: 'Twoja sesja jest gotowa! Dotknij, aby rozpocząć.' },
    day5: { title: 'Witaj ponownie!', body: 'Access Network czeka na Ciebie.' },
    day7: { title: 'Tęsknimy za Tobą!', body: 'Twoja aktywność w Access Network czeka.' },
    day14: { title: 'Dawno Cię nie było!', body: 'Access Network ma dla Ciebie aktualizacje.' },
    day30: { title: 'Access Network', body: 'Twoje konto jest nadal aktywne. Gotowy kontynuować?' }
  }
};

function getTranslation(lang) {
  const shortLang = (lang || 'en').substring(0, 2).toLowerCase();
  return NOTIFICATION_TRANSLATIONS[shortLang] || NOTIFICATION_TRANSLATIONS.en;
}

function getReEngagementMessage(lang, daysInactive) {
  const shortLang = (lang || 'en').substring(0, 2).toLowerCase();
  const messages = RE_ENGAGEMENT_TRANSLATIONS[shortLang] || RE_ENGAGEMENT_TRANSLATIONS.en;
  
  if (daysInactive >= 15) return messages.day30;
  if (daysInactive >= 11) return messages.day14;
  if (daysInactive >= 7) return messages.day7;
  if (daysInactive >= 5) return messages.day5;
  return messages.day3;
}

self.addEventListener('install', (event) => {
  console.log('Service Worker: Installed for notifications v' + SW_VERSION);
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('Service Worker: Activated for notifications');
  // حذف أي كاش قديم إذا وجد
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => caches.delete(cacheName))
      );
    }).then(() => self.clients.claim())
  );
});

// 🔔 FACEBOOK/INSTAGRAM STYLE: Auto-renew subscription when it expires
// This is THE KEY to making push notifications work like big apps
self.addEventListener('pushsubscriptionchange', async (event) => {
  console.log('🔄 Push subscription changed/expired - auto-renewing...');
  
  event.waitUntil((async () => {
    try {
      // Get VAPID public key from server
      const response = await fetch('/api/push/public-key');
      const data = await response.json();
      
      if (!data.success || !data.publicKey) {
        console.error('Failed to get VAPID public key for renewal');
        return;
      }
      
      // Convert VAPID key to Uint8Array
      const vapidPublicKey = urlBase64ToUint8Array(data.publicKey);
      
      // Create new subscription
      const newSubscription = await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: vapidPublicKey
      });
      
      console.log('✅ New subscription created automatically');
      
      // Get user ID from IndexedDB or localStorage via client
      const clients = await self.clients.matchAll({ type: 'window' });
      if (clients.length > 0) {
        // Ask client for user ID
        clients[0].postMessage({
          type: 'SUBSCRIPTION_RENEWED',
          subscription: newSubscription.toJSON()
        });
      }
      
      // Also try to save directly to server
      try {
        // Try to get userId from the old subscription's endpoint stored in DB
        await fetch('/api/push/renew-subscription', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            oldEndpoint: event.oldSubscription?.endpoint,
            newSubscription: newSubscription.toJSON()
          })
        });
        console.log('✅ Subscription renewed on server');
      } catch (saveError) {
        console.log('Will save subscription when client is active');
      }
      
    } catch (error) {
      console.error('Auto-renewal failed:', error);
    }
  })());
});

// Helper function for VAPID key conversion
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// No caching - pass all requests to network
self.addEventListener('fetch', (event) => {
  return;
});

// Handle push notifications from server
self.addEventListener('push', (event) => {
  console.log('Push notification received:', event);
  
  // If no data, this is a silent test push - don't show notification
  if (!event.data) {
    console.log('Silent push received (no data) - ignoring');
    return;
  }
  
  let data = {};
  try {
    data = event.data.json();
  } catch (e) {
    console.error('Error parsing push data:', e);
    return; // Don't show notification if data is invalid
  }

  // Don't show notification if no meaningful content
  if (!data.type && !data.hash && !data.amount && !data.daysInactive) {
    console.log('Push with empty data - ignoring');
    return;
  }

  // Get device language
  const deviceLang = self.navigator?.language || 'en';
  
  let title = 'Access Network';
  let body = '';
  
  // Handle different notification types
  if (data.type === 'transaction_received' && data.amount) {
    // Transaction notification
    const t = getTranslation(deviceLang);
    const fromShort = data.from ? 
      `${data.from.substring(0, 6)}...${data.from.substring(data.from.length - 4)}` : 
      '???';
    body = `${t.newTx}\n${t.amount}: ${data.amount} ACCESS\n${t.from}: ${fromShort}`;
  } else if (data.type === 're-engagement' && data.daysInactive) {
    // Re-engagement notification - translate based on device language
    const msg = getReEngagementMessage(deviceLang, data.daysInactive);
    title = msg.title;
    body = msg.body;
  } else if (data.body) {
    body = data.body;
    if (data.title) title = data.title;
  } else {
    const t = getTranslation(deviceLang);
    body = t.newTx;
  }

  const options = {
    body: body,
    icon: '/access-logo-1ipfs.png',
    vibrate: [200, 100, 200],
    tag: data.tag || 'access-notification',
    requireInteraction: true,
    data: data
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
  console.log('Notification clicked:', event.notification.tag);
  event.notification.close();

  // Open the app or focus existing window
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Try to focus existing window
        for (let client of clientList) {
          if ('focus' in client) {
            return client.focus();
          }
        }
        // Open new window if none exists
        if (clients.openWindow) {
          return clients.openWindow('/');
        }
      })
  );
});

// Handle messages from the main page to show notifications
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
    const { title, body, tag, icon, data } = event.data;
    
    self.registration.showNotification(title, {
      body: body,
      icon: icon || '/access-logo-1ipfs.png',
      tag: tag || 'access-notification',
      requireInteraction: true,
      vibrate: [200, 100, 200],
      data: data || {}
    });
  }
});
