const panel = document.querySelector<HTMLElement>('.community-panel');
if (panel) startCommunity(panel);

const NICKNAME_KEY = 'malibu-nickname';

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
  let socket: WebSocket | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let heartbeat: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let ready = false;
  let sending = false;
  let attempts = 0;
  let generation = 0;
  let pulseGeneration: number | undefined;
  const seen = new Set<string>();

  function setStatus(label: string, connected = false) {
    badges.forEach(badge => {
      const target = badge.querySelector<HTMLElement>('[data-online-count-text]') || badge;
      target.textContent = label;
    });
    ready = connected;
    button.disabled = !ready || sending;
  }
  async function request(action: string, body?: object) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(`/api/community/${action}`, {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}), signal: controller.signal
      });
      const data = await response.json();
      if (!response.ok) throw Object.assign(new Error(data.error || 'No se pudo conectar.'), { status: response.status });
      return data;
    } finally { clearTimeout(timeout); }
  }
  function addMessage(event: any) {
    if (event?.type !== 'message' || typeof event.id !== 'string' || seen.has(event.id) ||
        typeof event.name !== 'string' || event.name.length > 24 || typeof event.text !== 'string' || event.text.length > 300 ||
        typeof event.sentAt !== 'string' || !Number.isFinite(Date.parse(event.sentAt))) return;
    const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
    seen.add(event.id);
    panel.querySelector('.community-empty')?.remove();
    const article = document.createElement('article');
    const author = document.createElement('strong');
    const time = document.createElement('time');
    const content = document.createElement('p');
    // User content is always text, never HTML or an executable link.
    author.textContent = event.name;
    time.dateTime = event.sentAt;
    time.textContent = new Date(event.sentAt).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
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

  async function pulse(current: number) {
    if (stopped || current !== generation || socket?.readyState !== WebSocket.OPEN || pulseGeneration === current) return;
    pulseGeneration = current;
    try {
      const data = await request('presence');
      if (stopped || current !== generation || socket?.readyState !== WebSocket.OPEN) return;
      if (!Number.isInteger(data.count) || data.count < 0) throw new Error('Conteo inválido');
      setStatus(`${data.count} ONLINE`, true);
      attempts = 0;
    } catch (error: any) {
      if (stopped || current !== generation) return;
      setStatus('Conexión interrumpida');
      if ([401, 409].includes(error.status)) { socket?.close(); return; }
    } finally {
      if (pulseGeneration === current) pulseGeneration = undefined;
    }
    if (!stopped && current === generation && socket?.readyState === WebSocket.OPEN) {
      clearTimeout(heartbeat);
      heartbeat = setTimeout(() => pulse(current), ready ? 25_000 : 5000);
    }
  }
  function scheduleReconnect(current: number) {
    if (stopped || current !== generation) return;
    clearTimeout(heartbeat);
    clearTimeout(retry);
    setStatus('Reconectando…');
    retry = setTimeout(connect, Math.min(30_000, 1000 * 2 ** Math.min(attempts++, 5)) + Math.random() * 500);
  }
  async function connect() {
    if (stopped) return;
    clearTimeout(retry);
    clearTimeout(heartbeat);
    const current = ++generation;
    socket?.close();
    setStatus(attempts ? 'Reconectando…' : 'Conectando…');
    try {
      // Serialize the first cookie creation across tabs of the same browser.
      const data = navigator.locks
        ? await navigator.locks.request('malibu-session', () => request('session'))
        : await request('session');
      if (stopped || current !== generation) return;
      const url = new URL(data.url);
      if (url.protocol !== 'wss:' && !(location.hostname === 'localhost' && url.protocol === 'ws:')) throw new Error('Conexión inválida');
      const ws = socket = new WebSocket(url);
      const opening = setTimeout(() => { if (ws.readyState !== WebSocket.OPEN) ws.close(); }, 10_000);
      ws.onopen = () => { clearTimeout(opening); if (current === generation) void pulse(current); };
      ws.onmessage = message => {
        if (current !== generation || stopped) return;
        try { addMessage(JSON.parse(message.data)); } catch { /* Ignore invalid service frames. */ }
      };
      ws.onerror = () => ws.close();
      ws.onclose = () => { clearTimeout(opening); scheduleReconnect(current); };
    } catch {
      scheduleReconnect(current);
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
      await request('message', { name: nameField.value, text: submitted });
      if (text.value === submitted) { text.value = ''; autosize(); }
      feedback.textContent = 'Mensaje enviado.';
      setEmojiPanel(false);
      text.focus();
    } catch (error: any) {
      feedback.textContent = error.name === 'AbortError'
        ? 'No pudimos confirmar el envío. Revisa el chat antes de volver a enviarlo.'
        : error.message || 'No se pudo enviar. Tu mensaje sigue aquí.';
      if ([401, 409].includes(error.status)) socket?.close();
    } finally { sending = false; button.disabled = !ready; }
  });
  window.addEventListener('pagehide', () => {
    stopped = true;
    generation++;
    clearTimeout(retry);
    clearTimeout(heartbeat);
    socket?.close();
  });
  window.addEventListener('pageshow', event => { if (event.persisted) { stopped = false; void connect(); } });
  window.addEventListener('online', () => { if (!stopped && !ready) void connect(); });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !stopped && socket?.readyState === WebSocket.OPEN) {
      clearTimeout(heartbeat); void pulse(generation);
    }
  });
  void connect();
}
