import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getDatabase, ref, push, set, onValue, onDisconnect, query, orderByChild, startAt, endAt, limitToLast, get, remove, serverTimestamp } from 'firebase/database';

const panel = document.querySelector<HTMLElement>('.community-panel');

const NICKNAME_KEY = 'malibu-nickname';
const RETENTION_MS = 18 * 60 * 60 * 1000;

const firebaseConfig = {
  apiKey: import.meta.env.PUBLIC_FIREBASE_API_KEY,
  authDomain: import.meta.env.PUBLIC_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.PUBLIC_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.PUBLIC_FIREBASE_APP_ID,
};

if (panel) startCommunity(panel);

function startCommunity(panel: HTMLElement) {
  const form = panel.querySelector<HTMLFormElement>('form')!;
  const nameField = panel.querySelector<HTMLInputElement>('[name="name"]')!;
  const text = panel.querySelector<HTMLTextAreaElement>('[name="text"]')!;
  const button = panel.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const feedback = panel.querySelector<HTMLElement>('.community-feedback')!;
  const log = panel.querySelector<HTMLElement>('[role="log"]')!;
  const badges = document.querySelectorAll<HTMLElement>('[data-online-count]');
  const nicknameInitial = panel.querySelector<HTMLElement>('[data-nickname-initial]')!;
  const nicknameButton = panel.querySelector<HTMLButtonElement>('[data-open-nickname]')!;
  const dialog = document.querySelector<HTMLDialogElement>('[data-nickname-dialog]');
  const nicknameForm = dialog?.querySelector<HTMLFormElement>('[data-nickname-form]');
  const nicknameInput = dialog?.querySelector<HTMLInputElement>('[data-nickname-input]');
  const nicknameError = dialog?.querySelector<HTMLElement>('[data-nickname-error]');
  const nicknameCancel = dialog?.querySelector<HTMLButtonElement>('[data-nickname-cancel]');
  const emojiToggle = panel.querySelector<HTMLButtonElement>('[data-emoji-toggle]');
  const emojiPanel = panel.querySelector<HTMLElement>('[data-emoji-panel]');
  let unsubscribeMessages: (() => void) | undefined;
  let unsubscribePresence: (() => void) | undefined;
  let removeOwnPresence: (() => Promise<void>) | undefined;
  let stopped = false;
  let ready = false;
  let sending = false;
  let firebaseUid = '';
  let lastSentAt = 0;
  const seen = new Set<string>();

  function setStatus(label: string, connected = false) {
    badges.forEach(badge => {
      const target = badge.querySelector<HTMLElement>('[data-online-count-text]') || badge;
      target.textContent = label;
    });
    ready = connected;
    button.disabled = !ready || sending;
  }
  function addMessage(event: any) {
    if (event?.type !== 'message' || typeof event.id !== 'string' || seen.has(event.id) ||
        typeof event.name !== 'string' || event.name.length > 24 || typeof event.text !== 'string' || event.text.length > 300 ||
        !Number.isFinite(typeof event.sentAt === 'number' ? event.sentAt : Number(event.sentAt))) return;
    const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
    seen.add(event.id);
    panel.querySelector('.community-empty')?.remove();
    const article = document.createElement('article');
    const author = document.createElement('strong');
    const time = document.createElement('time');
    const content = document.createElement('p');
    // User content is always text, never HTML or an executable link.
    author.textContent = event.name;
    const sentAt = typeof event.sentAt === 'number' ? event.sentAt : Number(event.sentAt);
    time.dateTime = new Date(sentAt).toISOString();
    time.textContent = new Date(sentAt).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
    content.textContent = event.text;
    article.append(author, time, content);
    log.append(article);
    if (log.children.length > 100) log.firstElementChild?.remove();
    if (seen.size > 200) seen.delete(seen.values().next().value!);
    if (nearBottom) log.scrollTop = log.scrollHeight;
  }

  /* ---------- Apodo ---------- */

  function storeNickname(value: string) {
    try { localStorage.setItem(NICKNAME_KEY, value); } catch { /* Almacenamiento no disponible. */ }
  }
  function readNickname() {
    try { return localStorage.getItem(NICKNAME_KEY) || ''; } catch { return ''; }
  }
  function paintNickname(value: string) {
    nameField.value = value;
    nicknameInitial.textContent = value ? value.trim().charAt(0) : '?';
    nicknameButton.setAttribute(
      'aria-label',
      value ? `Tu apodo es ${value}. Cambiar apodo` : 'Elegir apodo'
    );
    nicknameButton.title = value ? `Apodo: ${value}` : 'Elegir apodo';
  }
  function openNickname() {
    if (!dialog || !nicknameInput) return;
    nicknameInput.value = nameField.value;
    if (nicknameError) nicknameError.textContent = '';
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
    nicknameButton.setAttribute('aria-expanded', 'true');
    nicknameInput.focus();
    nicknameInput.select();
  }
  let dismissedNicknameAt = 0;
  function closeNickname(saved = false) {
    if (!dialog) return;
    if (!saved) dismissedNicknameAt = Date.now();
    nicknameButton.setAttribute('aria-expanded', 'false');
    if (typeof dialog.close === 'function' && dialog.open) dialog.close();
    else dialog.removeAttribute('open');
  }
  function saveNickname() {
    if (!nicknameInput) return;
    const value = nicknameInput.value.trim().replace(/\s+/g, ' ');
    if (value.length < 2 || value.length > 24) {
      if (nicknameError) nicknameError.textContent = 'Escribe un apodo de 2 a 24 caracteres.';
      nicknameInput.focus();
      return;
    }
    if (/[\u0000-\u001f\u007f]/.test(value)) {
      if (nicknameError) nicknameError.textContent = 'El apodo tiene caracteres no permitidos.';
      return;
    }
    storeNickname(value);
    paintNickname(value);
    closeNickname(true);
    if (ready) text.focus();
  }

  function restoreNickname() {
    if (nameField.value) return true;
    const stored = readNickname();
    if (!stored) return false;
    paintNickname(stored);
    return true;
  }

  restoreNickname();
  // Algunos navegadores publican localStorage un instante después del primer render.
  addEventListener('load', restoreNickname);
  addEventListener('pageshow', restoreNickname);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) restoreNickname();
  });

  nicknameForm?.addEventListener('submit', event => {
    // `method="dialog"` cerraría el popup: validamos antes de que lo haga.
    event.preventDefault();
    saveNickname();
  });
  nicknameCancel?.addEventListener('click', () => closeNickname());
  dialog?.addEventListener('close', () => {
    nicknameButton.setAttribute('aria-expanded', 'false');
    dismissedNicknameAt = Date.now();
  });
  dialog?.addEventListener('click', event => {
    // Clic fuera de la tarjeta: cerrar sin elegir apodo.
    if (event.target === dialog) closeNickname();
  });
  nicknameButton.addEventListener('click', openNickname);

  // El apodo se pide cuando la persona intenta escribir, no al cargar la página.
  function askNickname() {
    if (nameField.value || !dialog) return false;
    openNickname();
    return true;
  }
  text.addEventListener('focus', () => {
    if (Date.now() - dismissedNicknameAt < 600) return;
    askNickname();
  });
  text.addEventListener('click', () => {
    if (Date.now() - dismissedNicknameAt < 600) return;
    askNickname();
  });
  text.addEventListener('beforeinput', event => {
    if (!nameField.value) {
      event.preventDefault();
      askNickname();
    }
  });

  /* ---------- Emojis ---------- */

  function setEmojiPanel(open: boolean) {
    if (!emojiPanel || !emojiToggle) return;
    emojiPanel.hidden = !open;
    emojiToggle.setAttribute('aria-expanded', String(open));
  }
  function insertEmoji(emoji: string) {
    if (!nameField.value) {
      askNickname();
      return;
    }
    const start = text.selectionStart ?? text.value.length;
    const end = text.selectionEnd ?? start;
    text.setRangeText(emoji, start, end, 'end');
    if (text.value.length > text.maxLength) text.value = text.value.slice(0, text.maxLength);
    text.focus();
    text.dispatchEvent(new Event('input', { bubbles: true }));
  }
  emojiToggle?.addEventListener('click', () => setEmojiPanel(emojiPanel?.hidden ?? true));
  emojiPanel?.addEventListener('click', event => {
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-emoji]');
    if (!target) return;
    insertEmoji(target.dataset.emoji || '');
  });
  document.addEventListener('click', event => {
    if (!emojiPanel || emojiPanel.hidden) return;
    const target = event.target as Node;
    if (!emojiPanel.contains(target) && !emojiToggle?.contains(target)) setEmojiPanel(false);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && emojiPanel && !emojiPanel.hidden) {
      setEmojiPanel(false);
      emojiToggle?.focus();
    }
  });

  // Enter envía; Mayús + Enter hace un salto de línea.
  text.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    if (form.requestSubmit) form.requestSubmit();
    else form.dispatchEvent(new Event('submit', { cancelable: true }));
  });

  // La caja crece con el texto, hasta el alto máximo permitido por el CSS.
  function autosize() {
    text.style.height = 'auto';
    // +2 px para los bordes: evita que aparezca scroll por un desfase de redondeo.
    const needed = text.scrollHeight + 2;
    text.style.height = `${Math.min(needed, 120)}px`;
  }
  text.addEventListener('input', autosize);
  autosize();

  async function connect() {
    if (stopped) return;
    setStatus('Conectando…');
    try {
      const required = Object.values(firebaseConfig).every(Boolean);
      if (!required) throw new Error('Falta la configuración pública de Firebase.');
      const app = initializeApp(firebaseConfig);
      const auth = getAuth(app);
      const credential = await signInAnonymously(auth);
      if (stopped) return;
      firebaseUid = credential.user.uid;
      const db = getDatabase(app);
      const presenceRef = ref(db, `MalibuWeb Chat/presence/${firebaseUid}`);
      await onDisconnect(presenceRef).remove();
      await set(presenceRef, { connectedAt: serverTimestamp() });
      removeOwnPresence = () => remove(presenceRef);
      unsubscribePresence = onValue(ref(db, 'MalibuWeb Chat/presence'), snapshot => {
        let count = 0;
        snapshot.forEach(() => { count++; });
        setStatus(`${count} ONLINE`, true);
      }, () => setStatus('Conexión interrumpida'));

      const cutoff = Date.now() - RETENTION_MS;
      const messagesRef = ref(db, 'MalibuWeb Chat/messages');
      const recentMessages = query(messagesRef, orderByChild('sentAt'), startAt(cutoff), limitToLast(100));
      unsubscribeMessages = onValue(recentMessages, snapshot => {
        log.replaceChildren();
        seen.clear();
        const messages: any[] = [];
        snapshot.forEach(child => {
          const value = child.val();
          if (value && Number(value.sentAt) >= Date.now() - RETENTION_MS) messages.push({ ...value, id: child.key });
        });
        messages.forEach(addMessage);
        if (!messages.length) {
          const empty = document.createElement('p');
          empty.className = 'community-empty';
          empty.textContent = 'Los mensajes recientes aparecerán aquí cuando estés conectado.';
          log.append(empty);
        }
        // Best-effort cleanup: rules must allow deletion only after expiry.
        snapshot.forEach(child => {
          const value = child.val();
          if (value && Number(value.sentAt) < Date.now() - RETENTION_MS) {
            void remove(ref(db, `MalibuWeb Chat/messages/${child.key}`)).catch(() => {});
          }
        });
      }, () => setStatus('No se pudo cargar el chat'));
      const expiredMessages = await get(query(messagesRef, orderByChild('sentAt'), endAt(cutoff), limitToLast(100)));
      expiredMessages.forEach(child => {
          void remove(ref(db, `MalibuWeb Chat/messages/${child.key}`)).catch(() => {});
      });
    } catch (error: any) {
      setStatus(error?.message || 'No se pudo conectar');
    }
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!nameField.value) {
      openNickname();
      feedback.textContent = 'Elige un apodo para enviar tu mensaje.';
      return;
    }
    if (!ready || sending || !form.reportValidity()) return;
    sending = true;
    button.disabled = true;
    feedback.textContent = 'Enviando…';
    const submitted = text.value;
    try {
      if (Date.now() - lastSentAt < 3000) throw new Error('Espera unos segundos antes de enviar otro mensaje.');
      const db = getDatabase();
      const messageRef = push(ref(db, 'MalibuWeb Chat/messages'));
      const sentAt = Date.now();
      await set(messageRef, { type: 'message', id: messageRef.key, name: nameField.value, text: submitted, sentAt });
      lastSentAt = sentAt;
      if (text.value === submitted) { text.value = ''; autosize(); }
      feedback.textContent = 'Mensaje enviado.';
      setEmojiPanel(false);
      text.focus();
    } catch (error: any) {
      feedback.textContent = error.name === 'AbortError'
        ? 'No pudimos confirmar el envío. Revisa el chat antes de volver a enviarlo.'
        : error.message || 'No se pudo enviar. Tu mensaje sigue aquí.';
    } finally { sending = false; button.disabled = !ready; }
  });
  window.addEventListener('pagehide', () => {
    stopped = true;
    unsubscribeMessages?.();
    unsubscribePresence?.();
    void removeOwnPresence?.();
  });
  window.addEventListener('pageshow', event => { if (event.persisted) { stopped = false; void connect(); } });
  window.addEventListener('online', () => { if (!stopped && !ready) void connect(); });
  void connect();
}
