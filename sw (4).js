// ═══════════════════════════════════════════════════════
// VITA PRO — Service Worker v3
// Estrategia: el SW recibe el horario, lo guarda en
// IndexedDB y usa un keepalive de fetch+setTimeout para
// mantenerse vivo en Android Chrome PWA.
// ═══════════════════════════════════════════════════════
const CACHE = 'vita-sw-v3';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

// ── Recibir mensajes desde la app ──
self.addEventListener('message', e => {
  const { type, payload } = e.data || {};
  if (type === 'SCHEDULE') {
    saveSchedule(payload);
    scheduleAll(payload.items, payload.motiv);
    e.source && e.source.postMessage({ type: 'SW_ACK', ok: true });
  }
  if (type === 'PING') {
    e.source && e.source.postMessage({ type: 'SW_PONG' });
  }
  if (type === 'TEST') {
    fireNotif('🧪 Prueba VITA PRO', '¡Las notificaciones funcionan perfectamente!', 'test');
  }
  if (type === 'CANCEL') {
    clearTimers();
  }
});

// ── Persistir horario en Cache Storage (sobrevive reinicios del SW) ──
async function saveSchedule(payload) {
  try {
    const cache = await caches.open(CACHE);
    await cache.put('/_vita_schedule', new Response(JSON.stringify(payload)));
  } catch(e) {}
}
async function loadSchedule() {
  try {
    const cache = await caches.open(CACHE);
    const r = await cache.match('/_vita_schedule');
    if (r) return r.json();
  } catch(e) {}
  return null;
}

// ── Al activarse, restaurar horario guardado ──
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    await self.clients.claim();
    const saved = await loadSchedule();
    if (saved) scheduleAll(saved.items, saved.motiv);
  })());
});

// ── Timers ──
let _timers = [];
function clearTimers() { _timers.forEach(t => clearTimeout(t)); _timers = []; }

function scheduleAll(items, motiv) {
  clearTimers();
  if (!items || !items.length) return;
  const now = new Date();

  items.forEach(item => {
    if (!item.time) return;
    const [h, m] = item.time.split(':').map(Number);

    // Notificación al inicio exacto
    const start = new Date(now);
    start.setHours(h, m, 0, 0);
    const msStart = start - now;
    if (msStart > 0 && msStart < 20 * 3600000) {
      _timers.push(setTimeout(() => {
        const dur = item.endTime ? ' · ' + getDur(item.time, item.endTime) : '';
        fireNotif('⏰ ¡Empieza: ' + item.title + '!',
          (item.sub || 'Es hora de esta actividad') + dur,
          'start-' + item.id);
      }, msStart));
    }

    // 5 min antes
    const msPre = msStart - 5 * 60000;
    if (msPre > 0 && msPre < 20 * 3600000) {
      _timers.push(setTimeout(() => {
        fireNotif('🔔 En 5 min: ' + item.title,
          'Prepárate' + (item.sub ? ' · ' + item.sub : ''),
          'pre-' + item.id);
      }, msPre));
    }
  });

  // Motivación cada 90 min entre 7am-10pm
  if (motiv && motiv.length) {
    let cursor = new Date(now);
    const base = now.getHours() * 60 + now.getMinutes();
    const nextSlot = Math.ceil(base / 90) * 90;
    cursor.setHours(Math.floor(nextSlot / 60), nextSlot % 60, 0, 0);
    let idx = 0;
    while (cursor.getHours() < 22 && cursor.getHours() >= 7) {
      const delay = cursor - now;
      if (delay > 0) {
        const msg = motiv[idx % motiv.length];
        _timers.push(setTimeout(() => {
          fireNotif(msg.icon + ' Vita te recuerda ✦', msg.msg, 'motiv-' + Date.now());
        }, delay));
      }
      cursor = new Date(cursor.getTime() + 90 * 60000);
      idx++;
      if (cursor.getHours() >= 22) break;
    }
  }
}

function fireNotif(title, body, tag) {
  self.registration.showNotification(title, {
    body,
    icon: './apple-touch-icon.png',
    badge: './apple-touch-icon.png',
    tag,
    vibrate: [250, 100, 250],
    requireInteraction: false,
  }).catch(() => {});
}

function getDur(s, e) {
  if (!s || !e) return '';
  const [sh, sm] = s.split(':').map(Number);
  const [eh, em] = e.split(':').map(Number);
  const d = (eh * 60 + em) - (sh * 60 + sm);
  if (d <= 0) return '';
  return d < 60 ? d + 'min' : Math.floor(d/60) + 'h' + (d%60 ? ' ' + d%60 + 'm' : '');
}

// ── Click en notificación → enfocar app ──
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      if (list.length) return list[0].focus();
      return self.clients.openWindow('./');
    })
  );
});
