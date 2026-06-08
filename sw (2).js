// ═══════════════════════════════════════════════════════════════
// VITA PRO — Service Worker v2.0
// Maneja notificaciones en background aunque la app esté cerrada
// ═══════════════════════════════════════════════════════════════
const SW_VERSION = 'vita-sw-v2';

// ── Instalación y activación inmediata ──
self.addEventListener('install', e => {
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(self.clients.claim());
});

// ── Recibir mensajes desde la app (index.html) ──
self.addEventListener('message', e => {
  const { type, payload } = e.data || {};

  if (type === 'SCHEDULE_AGENDA') {
    // Recibe el arreglo de eventos del horario para hoy
    scheduleAgendaNotifs(payload.items, payload.motiv);
  }

  if (type === 'CANCEL_ALL') {
    cancelAll();
  }

  if (type === 'TEST_NOTIF') {
    self.registration.showNotification('VITA PRO ✦', {
      body: '¡Las notificaciones funcionan! Te avisaré antes de cada actividad.',
      icon: './apple-touch-icon.png',
      badge: './apple-touch-icon.png',
      tag: 'vita-test',
      vibrate: [200, 100, 200],
    });
  }
});

// ── Push desde servidor (Web Push API) ──
self.addEventListener('push', e => {
  const data = e.data ? e.data.json() : {};
  e.waitUntil(
    self.registration.showNotification(data.title || 'VITA PRO', {
      body: data.body || '',
      icon: './apple-touch-icon.png',
      badge: './apple-touch-icon.png',
      tag: data.tag || 'vita-push',
      vibrate: [200, 100, 200],
      data: data,
    })
  );
});

// ── Click en notificación → abrir app ──
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      if (clients.length > 0) {
        return clients[0].focus();
      }
      return self.clients.openWindow('./');
    })
  );
});

// ═══════════════════════════════════════════════════════════════
// SCHEDULER — Programa alarmas para los eventos del horario
// Usa setTimeout dentro del SW (funciona mientras el SW está vivo,
// que en Android Chrome puede ser varias horas en background)
// ═══════════════════════════════════════════════════════════════
let _timers = [];

function cancelAll() {
  _timers.forEach(t => clearTimeout(t));
  _timers = [];
}

function scheduleAgendaNotifs(items, motivMsgs) {
  cancelAll();
  if (!items || !items.length) return;

  const now = new Date();
  const todayStr = now.toDateString();

  items.forEach(item => {
    if (!item.time) return;

    const [h, m] = item.time.split(':').map(Number);

    // ── Notificación exacta al inicio ──
    const startTime = new Date(now);
    startTime.setHours(h, m, 0, 0);
    const msToStart = startTime - now;

    if (msToStart > 0 && msToStart < 16 * 60 * 60 * 1000) {
      const t1 = setTimeout(() => {
        const durLabel = item.endTime ? ` · ${getDur(item.time, item.endTime)}` : '';
        self.registration.showNotification('⏰ ¡Empieza ahora! — VITA PRO', {
          body: item.title + (item.sub ? '\n' + item.sub : '') + durLabel,
          icon: './apple-touch-icon.png',
          badge: './apple-touch-icon.png',
          tag: 'vita-agenda-' + item.id,
          vibrate: [300, 100, 300, 100, 200],
          silent: false,
          data: { url: './' },
        });
      }, msToStart);
      _timers.push(t1);
    }

    // ── Aviso 5 minutos antes ──
    const preTime = new Date(startTime.getTime() - 5 * 60 * 1000);
    const msToPre = preTime - now;

    if (msToPre > 0 && msToPre < 16 * 60 * 60 * 1000) {
      const t2 = setTimeout(() => {
        self.registration.showNotification('🔔 En 5 min — VITA PRO', {
          body: item.title + (item.sub ? ' · ' + item.sub : ''),
          icon: './apple-touch-icon.png',
          badge: './apple-touch-icon.png',
          tag: 'vita-pre-' + item.id,
          vibrate: [100, 50, 100],
          silent: false,
          data: { url: './' },
        });
      }, msToPre);
      _timers.push(t2);
    }
  });

  // ── Mensajes de motivación cada 90 min entre 7am–10pm ──
  if (motivMsgs && motivMsgs.length) {
    scheduleMotivacion(motivMsgs, now);
  }
}

function scheduleMotivacion(msgs, now) {
  const startH = 7, endH = 22;
  let cursor = new Date(now);

  // Avanzar al siguiente múltiplo de 90 min
  const totalMin = cursor.getHours() * 60 + cursor.getMinutes();
  const nextSlot = Math.ceil(totalMin / 90) * 90;
  cursor.setHours(Math.floor(nextSlot / 60), nextSlot % 60, 0, 0);

  let msgIdx = 0;
  while (cursor.getHours() < endH) {
    if (cursor > now && cursor.getHours() >= startH) {
      const delay = cursor - now;
      const msg = msgs[msgIdx % msgs.length];
      msgIdx++;
      const capturedMsg = msg;
      const capturedDelay = delay;
      const t = setTimeout(() => {
        self.registration.showNotification(capturedMsg.icon + ' Vita te recuerda ✦', {
          body: capturedMsg.msg,
          icon: './apple-touch-icon.png',
          badge: './apple-touch-icon.png',
          tag: 'vita-motiv-' + Date.now(),
          vibrate: [100, 50, 100],
          silent: false,
          data: { url: './' },
        });
      }, capturedDelay);
      _timers.push(t);
    }
    cursor = new Date(cursor.getTime() + 90 * 60 * 1000);
    if (cursor.getHours() >= endH) break;
  }
}

// Helper: duración legible
function getDur(start, end) {
  if (!start || !end) return '';
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const mins = (eh * 60 + em) - (sh * 60 + sm);
  if (mins <= 0) return '';
  if (mins < 60) return mins + 'min';
  const hr = Math.floor(mins / 60), mr = mins % 60;
  return mr ? hr + 'h ' + mr + 'm' : hr + 'h';
}
