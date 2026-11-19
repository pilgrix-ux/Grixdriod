type DeviceInfo = {
  serial: string;
  model: string;
  androidVersion: string;
  sdk: string;
  resolution: { width: number; height: number };
};

type DeviceSession = { id: string; status: string; device: DeviceInfo; expiresAt: string };

export function mountAndroidDevicePanel(app: HTMLElement): void {
  const root = document.createElement('section');
  root.id = 'android-device-console';
  root.className = 'android-cloud-panel';
  root.innerHTML = '<div class="android-panel-heading"><div><div class="android-eyebrow">GRIXDROID DEVICE BRIDGE</div><h2>Real Android device</h2><p>Connect an Android phone or emulator through a private ADB bridge.</p></div><span class="device-state" id="device-state">NOT CONNECTED</span></div>' +
    '<div class="bridge-settings"><label class="bridge-field"><span>Bridge API address</span><input id="bridge-url" type="url" value="http://127.0.0.1:8787" placeholder="https://your-private-bridge.example"></label>' +
    '<label class="bridge-field"><span>Access token <small>(only if configured on the bridge)</small></span><input id="bridge-token" type="password" autocomplete="off" placeholder="Private bridge token"></label>' +
    '<div class="bridge-actions"><button id="bridge-scan" class="bridge-button secondary" type="button">Find devices</button><button id="bridge-connect" class="bridge-button primary" type="button">Connect Android</button><button id="bridge-disconnect" class="bridge-button secondary" type="button" disabled>Disconnect</button></div></div>' +
    '<div class="bridge-message info" id="bridge-message" role="status">No Android device is connected. Start the bridge on a computer with Android Platform Tools and a phone or emulator attached.</div>' +
    '<div class="device-workspace"><div class="device-screen-column"><div class="device-toolbar"><div><strong id="device-name">Android device</strong><span id="device-meta">Waiting for bridge</span></div><span class="device-live-indicator"><i></i> LIVE SCREEN</span></div>' +
    '<div class="device-screen-frame" id="device-screen-frame"><img id="device-screen-image" alt="Live screen from the connected Android device" draggable="false"><div class="device-screen-placeholder" id="device-screen-placeholder"><div class="device-phone-glyph">▯</div><strong>Your Android screen appears here</strong><span>Connect a device to start screen mirroring.</span></div></div>' +
    '<div class="device-nav-controls"><button type="button" data-device-key="BACK" disabled>‹ <span>Back</span></button><button type="button" data-device-key="HOME" disabled>○ <span>Home</span></button><button type="button" data-device-key="APP_SWITCH" disabled>▢ <span>Recent</span></button><button type="button" id="device-refresh-screen" disabled>↻ <span>Refresh</span></button></div></div>' +
    '<aside class="device-tools"><div class="device-tool-card"><h3>Install an APK</h3><p>Install an APK directly on the connected Android device using ADB.</p><input id="device-apk-file" type="file" accept=".apk,application/vnd.android.package-archive" hidden><button id="device-select-apk" class="bridge-button primary full" type="button" disabled>Select APK</button><div class="device-upload-progress" id="device-upload-progress"></div></div>' +
    '<div class="device-tool-card"><h3>Launch an app</h3><p>Choose an installed third-party package on the device.</p><select id="device-packages" disabled><option value="">Connect a device first</option></select><button id="device-launch-app" class="bridge-button secondary full" type="button" disabled>Launch selected app</button><button id="device-refresh-packages" class="device-text-button" type="button" disabled>Refresh installed apps</button></div>' +
    '<div class="device-tool-card"><h3>Type on device</h3><form id="device-text-form" class="device-type-form"><input id="device-text-input" type="text" maxlength="120" placeholder="Type text on Android…" autocomplete="off" disabled><button class="bridge-button secondary" type="submit" disabled id="device-send-text">Send</button></form><small>For passwords and account secrets, type directly into the device.</small></div>' +
    '<div class="device-tool-card"><div class="device-logs-heading"><h3>Android logcat</h3><button id="device-refresh-logs" class="device-text-button" type="button" disabled>Refresh</button></div><pre id="device-log-output">Logs will appear after connecting.</pre></div></aside></div>' +
    '<div class="device-integration-note"><strong>What this connection does</strong><span>The bridge controls an Android device that already exists on the bridge host. A phone with Google Play keeps its own Play Store and Google account. This is a private development bridge, not a hosted multi-user cloud phone service.</span></div>';

  const header = app.querySelector('.header');
  if (header?.parentElement) header.insertAdjacentElement('afterend', root);
  else app.prepend(root);

  const get = <T extends HTMLElement>(selector: string): T => {
    const element = root.querySelector<T>(selector);
    if (!element) throw new Error('Missing device console element: ' + selector);
    return element;
  };

  const apiUrl = get<HTMLInputElement>('#bridge-url');
  const tokenInput = get<HTMLInputElement>('#bridge-token');
  const stateBadge = get<HTMLElement>('#device-state');
  const message = get<HTMLElement>('#bridge-message');
  const connectButton = get<HTMLButtonElement>('#bridge-connect');
  const scanButton = get<HTMLButtonElement>('#bridge-scan');
  const disconnectButton = get<HTMLButtonElement>('#bridge-disconnect');
  const screenImage = get<HTMLImageElement>('#device-screen-image');
  const screenPlaceholder = get<HTMLElement>('#device-screen-placeholder');
  const screenFrame = get<HTMLElement>('#device-screen-frame');
  const packagesSelect = get<HTMLSelectElement>('#device-packages');
  const apkInput = get<HTMLInputElement>('#device-apk-file');
  const uploadProgress = get<HTMLElement>('#device-upload-progress');
  const logOutput = get<HTMLElement>('#device-log-output');
  const maxApkBytes = 100 * 1024 * 1024;

  let session: DeviceSession | null = null;
  let screenshotTimer: number | null = null;
  let objectUrl: string | null = null;
  let busy = false;
  let pointerStart: { x: number; y: number; at: number } | null = null;

  function baseUrl(): string {
    const value = apiUrl.value.trim().replace(/\/+$/, '');
    if (!value) throw new Error('Enter the bridge API address.');
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1' && url.hostname !== '::1') {
      throw new Error('Use HTTPS for a remote bridge. HTTP is allowed only on localhost.');
    }
    return url.toString().replace(/\/+$/, '');
  }

  function requestHeaders(extra?: HeadersInit): Headers {
    const result = new Headers(extra);
    const token = tokenInput.value.trim();
    if (token) result.set('Authorization', 'Bearer ' + token);
    return result;
  }

  async function api<T>(route: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(baseUrl() + '/api/v1' + route, {
      ...init,
      headers: requestHeaders(init.headers),
      cache: 'no-store',
    });
    const contentType = response.headers.get('content-type') || '';
    const payload: unknown = contentType.includes('application/json') ? await response.json() : await response.text();
    if (!response.ok) {
      const detail = typeof payload === 'object' && payload !== null
        ? ((payload as { error?: string }).error || (payload as { message?: string }).message)
        : String(payload);
      throw new Error(detail || 'Bridge request failed (' + response.status + ').');
    }
    return payload as T;
  }

  function setMessage(text: string, kind: 'info' | 'success' | 'error' = 'info'): void {
    message.textContent = text;
    message.className = 'bridge-message ' + kind;
  }

  function setConnected(connected: boolean): void {
    stateBadge.textContent = connected ? 'DEVICE CONNECTED' : 'NOT CONNECTED';
    stateBadge.classList.toggle('connected', connected);
    disconnectButton.disabled = !connected;
    root.querySelectorAll<HTMLButtonElement>('[data-device-key]').forEach(button => { button.disabled = !connected; });
    get<HTMLButtonElement>('#device-refresh-screen').disabled = !connected;
    get<HTMLButtonElement>('#device-select-apk').disabled = !connected;
    packagesSelect.disabled = !connected;
    get<HTMLButtonElement>('#device-launch-app').disabled = !connected;
    get<HTMLButtonElement>('#device-refresh-packages').disabled = !connected;
    get<HTMLInputElement>('#device-text-input').disabled = !connected;
    get<HTMLButtonElement>('#device-send-text').disabled = !connected;
    get<HTMLButtonElement>('#device-refresh-logs').disabled = !connected;
    screenPlaceholder.classList.toggle('hidden', connected);
    screenImage.classList.toggle('visible', connected);
  }

  function clearScreen(): void {
    if (screenshotTimer !== null) window.clearTimeout(screenshotTimer);
    screenshotTimer = null;
    screenImage.removeAttribute('src');
    screenImage.classList.remove('visible');
    screenPlaceholder.classList.remove('hidden');
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }

  async function requestScreenshot(): Promise<void> {
    if (!session) return;
    try {
      const response = await fetch(baseUrl() + '/api/v1/sessions/' + encodeURIComponent(session.id) + '/screenshot?t=' + Date.now(), {
        headers: requestHeaders(),
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('Screen capture failed (' + response.status + ').');
      const blob = await response.blob();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = URL.createObjectURL(blob);
      screenImage.src = objectUrl;
      screenImage.classList.add('visible');
      screenPlaceholder.classList.add('hidden');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to refresh the Android screen.', 'error');
    }
    if (session) screenshotTimer = window.setTimeout(() => { void requestScreenshot(); }, 1000);
  }

  async function sendAction(action: Record<string, unknown>): Promise<void> {
    if (!session) throw new Error('Connect an Android device first.');
    await api('/sessions/' + encodeURIComponent(session.id) + '/actions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(action),
    });
  }

  async function loadPackages(): Promise<void> {
    if (!session) return;
    const result = await api<{ packages: string[] }>('/sessions/' + encodeURIComponent(session.id) + '/packages');
    packagesSelect.replaceChildren();
    if (!result.packages.length) {
      packagesSelect.add(new Option('No user apps found', ''));
      return;
    }
    for (const name of result.packages) packagesSelect.add(new Option(name, name));
  }

  async function refreshLogs(): Promise<void> {
    if (!session) return;
    const result = await api<{ logs: string }>('/sessions/' + encodeURIComponent(session.id) + '/logs');
    logOutput.textContent = result.logs || 'No log entries returned.';
    logOutput.scrollTop = logOutput.scrollHeight;
  }

  async function connect(): Promise<void> {
    if (busy) return;
    busy = true;
    connectButton.disabled = true;
    scanButton.disabled = true;
    setMessage('Checking the ADB bridge and attached Android devices…');
    try {
      const health = await api<{ status: string; adb: string }>('/health');
      const devices = await api<{ devices: DeviceInfo[] }>('/devices');
      if (!devices.devices.length) throw new Error('No authorized Android device found. Enable USB debugging, connect the phone, and accept its computer authorization prompt.');
      const selected = devices.devices[0];
      const created = await api<DeviceSession>('/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceSerial: selected.serial }),
      });
      session = created;
      get<HTMLElement>('#device-name').textContent = selected.model || 'Android device';
      get<HTMLElement>('#device-meta').textContent = 'Android ' + selected.androidVersion + ' · API ' + selected.sdk + ' · ' + selected.resolution.width + '×' + selected.resolution.height;
      setConnected(true);
      setMessage('Connected to ' + (selected.model || 'Android device') + '. ADB: ' + health.adb + '.', 'success');
      void requestScreenshot();
      await Promise.allSettled([loadPackages(), refreshLogs()]);
    } catch (error) {
      session = null;
      setConnected(false);
      setMessage(error instanceof Error ? error.message : 'Could not connect to Android.', 'error');
    } finally {
      busy = false;
      connectButton.disabled = false;
      scanButton.disabled = false;
    }
  }

  async function scanDevices(): Promise<void> {
    if (busy) return;
    busy = true;
    scanButton.disabled = true;
    setMessage('Looking for authorized Android devices…');
    try {
      const devices = await api<{ devices: DeviceInfo[] }>('/devices');
      if (!devices.devices.length) setMessage('No authorized device detected. Connect a phone with USB debugging enabled or start an Android emulator on the bridge host.');
      else {
        setMessage(devices.devices.length + ' device(s) detected. Select Connect Android to open a session.', 'success');
        get<HTMLElement>('#device-name').textContent = devices.devices.map(item => item.model || item.serial).join(', ');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Device scan failed.', 'error');
    } finally {
      busy = false;
      scanButton.disabled = false;
    }
  }

  async function disconnect(): Promise<void> {
    const oldSession = session;
    session = null;
    clearScreen();
    setConnected(false);
    packagesSelect.replaceChildren(new Option('Connect a device first', ''));
    logOutput.textContent = 'Logs will appear after connecting.';
    get<HTMLElement>('#device-name').textContent = 'Android device';
    get<HTMLElement>('#device-meta').textContent = 'Waiting for bridge';
    if (oldSession) {
      try {
        await api('/sessions/' + encodeURIComponent(oldSession.id), { method: 'DELETE' });
        setMessage('Device session closed. The Android device itself remains on.', 'success');
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'Local session closed; bridge cleanup could not be confirmed.', 'error');
      }
    }
  }

  connectButton.addEventListener('click', () => { void connect(); });
  scanButton.addEventListener('click', () => { void scanDevices(); });
  disconnectButton.addEventListener('click', () => { void disconnect(); });

  root.querySelectorAll<HTMLButtonElement>('[data-device-key]').forEach(button => {
    button.addEventListener('click', () => {
      const key = button.dataset.deviceKey;
      if (key) void sendAction({ type: 'key', key }).catch(error => setMessage(String(error), 'error'));
    });
  });

  get<HTMLButtonElement>('#device-refresh-screen').addEventListener('click', () => { void requestScreenshot(); });
  get<HTMLButtonElement>('#device-refresh-packages').addEventListener('click', () => {
    void loadPackages().catch(error => setMessage(String(error), 'error'));
  });
  get<HTMLButtonElement>('#device-refresh-logs').addEventListener('click', () => {
    void refreshLogs().catch(error => setMessage(String(error), 'error'));
  });

  get<HTMLButtonElement>('#device-select-apk').addEventListener('click', () => apkInput.click());
  apkInput.addEventListener('change', async () => {
    const file = apkInput.files?.[0];
    if (!file || !session) return;
    if (!file.name.toLowerCase().endsWith('.apk') || file.size > maxApkBytes) {
      setMessage('Choose an APK file smaller than 100 MB.', 'error');
      apkInput.value = '';
      return;
    }
    uploadProgress.textContent = 'Installing ' + file.name + '…';
    try {
      const result = await api<{ message: string }>('/sessions/' + encodeURIComponent(session.id) + '/apk', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/vnd.android.package-archive', 'X-APK-Filename': encodeURIComponent(file.name) },
        body: file,
      });
      uploadProgress.textContent = result.message;
      setMessage(result.message, 'success');
      await loadPackages();
    } catch (error) {
      uploadProgress.textContent = '';
      setMessage(error instanceof Error ? error.message : 'APK installation failed.', 'error');
    } finally {
      apkInput.value = '';
    }
  });

  get<HTMLButtonElement>('#device-launch-app').addEventListener('click', async () => {
    const packageName = packagesSelect.value;
    if (!packageName || !session) return;
    try {
      const result = await api<{ message: string }>('/sessions/' + encodeURIComponent(session.id) + '/launch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageName }),
      });
      setMessage(result.message, 'success');
      void requestScreenshot();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not launch app.', 'error');
    }
  });

  get<HTMLFormElement>('#device-text-form').addEventListener('submit', async event => {
    event.preventDefault();
    const input = get<HTMLInputElement>('#device-text-input');
    if (!input.value.trim()) return;
    try {
      await sendAction({ type: 'text', text: input.value });
      input.value = '';
      setMessage('Text sent to Android.', 'success');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Text input failed.', 'error');
    }
  });

  screenFrame.addEventListener('pointerdown', event => {
    if (!session || !screenImage.classList.contains('visible')) return;
    const rect = screenImage.getBoundingClientRect();
    pointerStart = {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
      at: Date.now(),
    };
    screenFrame.setPointerCapture(event.pointerId);
  });
  screenFrame.addEventListener('pointerup', event => {
    if (!pointerStart || !session) return;
    const rect = screenImage.getBoundingClientRect();
    const end = {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    };
    const start = pointerStart;
    pointerStart = null;
    const distance = Math.hypot(end.x - start.x, end.y - start.y);
    const action = distance > 0.025
      ? { type: 'swipe', x: start.x, y: start.y, endX: end.x, endY: end.y, durationMs: Math.min(900, Math.max(120, Date.now() - start.at)) }
      : { type: 'tap', x: end.x, y: end.y };
    void sendAction(action).catch(error => setMessage(String(error), 'error'));
  });
  screenFrame.addEventListener('pointercancel', () => { pointerStart = null; });

  apiUrl.addEventListener('change', () => {
    try { window.localStorage.setItem('grixdroid.bridgeUrl', baseUrl()); } catch { /* storage may be disabled */ }
  });
  try {
    const saved = window.localStorage.getItem('grixdroid.bridgeUrl');
    if (saved) apiUrl.value = saved;
  } catch { /* storage may be disabled */ }

  window.addEventListener('beforeunload', () => {
    if (screenshotTimer !== null) window.clearTimeout(screenshotTimer);
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  });

  setConnected(false);
}
