import './cloud-devices.css';
import './workspace.css';

type AuthSession = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user_id: string;
  email?: string;
};

type AuthResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  expires_at?: number;
  error_description?: string;
  msg?: string;
  message?: string;
  user?: { id: string; email?: string };
};

type DeviceRequest = {
  id: string;
  name: string;
  profile: 'compact' | 'standard';
  android_version: string;
  device_model: string;
  status: 'queued' | 'claimed' | 'starting' | 'fulfilled' | 'failed' | 'cancelled';
  created_at: string;
};

type DeviceTarget = {
  android_version: string;
  device_model: string;
};

type DeviceOptionsResponse = {
  targets?: DeviceTarget[];
};

type CloudDevice = {
  id: string;
  name: string;
  profile: 'compact' | 'standard';
  android_release: string | null;
  device_model: string;
  state: 'provisioning' | 'stopped' | 'starting' | 'running' | 'stopping' | 'error' | 'deleting';
  storage_state: 'pending' | 'attached' | 'snapshotting' | 'error';
  storage_bytes: number;
  stream_state: 'disabled' | 'starting' | 'ready' | 'error';
  created_at: string;
};

type CloudDeviceAction = {
  id: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  failure_reason: string | null;
};

const DEFAULT_SUPABASE_PROJECT_REF = 'olbqxgnhozafcckcoapx';
const DEFAULT_SUPABASE_URL = 'https://olbqxgnhozafcckcoapx.supabase.co';
const DEFAULT_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_2SBpc33fTryZKwaSc6pl2w_yDZBJ22U';
const ANDROID_VERSION_LABELS: Record<string, string> = {
  '12': 'Android 12',
  '12L': 'Android 12L',
  '13': 'Android 13',
  '14': 'Android 14',
  '15': 'Android 15',
  '16': 'Android 16',
};
const DEVICE_MODEL_LABELS: Record<string, string> = {
  pixel_6: 'Google Pixel 6',
  pixel_6_pro: 'Google Pixel 6 Pro',
  pixel_7: 'Google Pixel 7',
  pixel_7_pro: 'Google Pixel 7 Pro',
  pixel_8: 'Google Pixel 8',
  pixel_8_pro: 'Google Pixel 8 Pro',
  pixel_9: 'Google Pixel 9',
  pixel_9_pro: 'Google Pixel 9 Pro',
  samsung_galaxy_s22: 'Samsung Galaxy S22 · real device required',
  samsung_galaxy_s23: 'Samsung Galaxy S23 · real device required',
  samsung_galaxy_s24: 'Samsung Galaxy S24 · real device required',
  samsung_galaxy_s24_ultra: 'Samsung Galaxy S24 Ultra · real device required',
  oppo_find_x8_pro: 'OPPO Find X8 Pro · real device required',
  xiaomi_14_ultra: 'Xiaomi 14 Ultra · real device required',
};

const GOOGLE_ICON_MARKUP = '<svg class="grix-cloud-google-mark" viewBox="0 0 48 48" aria-hidden="true" focusable="false"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.74 7.18l7.73 6c4.51-4.18 7.05-10.33 7.05-17.65z"/><path fill="#34A853" d="M10.53 28.59A14.4 14.4 0 0 1 9.75 24c0-1.59.27-3.13.75-4.59l-7.98-6.19C.91 16.67 0 20.21 0 24s.91 7.33 2.52 10.78l8.01-6.19z"/><path fill="#FBBC05" d="M24 48c6.48 0 11.93-2.13 15.91-5.8l-7.73-6c-2.15 1.45-4.9 2.3-8.18 2.3-6.26 0-11.57-4.22-13.46-9.91l-8.01 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';

function normalizeSupabaseUrl(value: string): string | null {
  const cleaned = value.trim().replace(/^["']|["']$/g, '').replace(/\/+$/, '');
  if (!cleaned || /your[_-]?project[_-]?ref|example\.com/i.test(cleaned)) return null;
  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(cleaned) ? cleaned : 'https://' + cleaned;
  try {
    const parsed = new URL(candidate);
    if (parsed.hostname.toLowerCase() === DEFAULT_SUPABASE_PROJECT_REF) return DEFAULT_SUPABASE_URL;
    if (!parsed.hostname || (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')) return null;
    if (parsed.protocol === 'http:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

const SUPABASE_URL = normalizeSupabaseUrl(import.meta.env.VITE_SUPABASE_URL || '') || DEFAULT_SUPABASE_URL;
const SUPABASE_KEY = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '').trim() || DEFAULT_SUPABASE_PUBLISHABLE_KEY;
const DEFAULT_GRIXDROID_SITE_URL = 'https://grixdriod.vercel.app';

function normalizeGrixdroidSiteUrl(value: string): string | null {
  const cleaned = value.trim().replace(/^["']|["']$/g, '').replace(/\/+$/, '');
  if (!cleaned) return null;
  try {
    const parsed = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(cleaned) ? cleaned : 'https://' + cleaned);
    if (parsed.protocol !== 'https:' || !parsed.hostname) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

const GRIXDROID_SITE_URL = normalizeGrixdroidSiteUrl(import.meta.env.VITE_GRIXDROID_SITE_URL || '') || DEFAULT_GRIXDROID_SITE_URL;
const GOOGLE_SIGNIN_START_PARAM = 'grix-google-start';
const WHEP_BASE_URL = (import.meta.env.VITE_GRIXDROID_WHEP_BASE_URL || '').replace(/\/+$/, '');
const configured = Boolean(SUPABASE_URL && SUPABASE_KEY);
const authBase = SUPABASE_URL + '/auth/v1';
const SESSION_STORAGE_KEY = 'grixdroid.auth.session.v1';
const GOOGLE_OAUTH_VERIFIER_KEY = 'grixdroid.google.oauth.verifier.v1';
const restBase = SUPABASE_URL + '/rest/v1';

export function mountCloudDevicesPanel(app: HTMLElement): void {
  const root = document.createElement('section');
  root.id = 'grixdroid-cloud-devices';
  root.className = 'grix-cloud-panel';
  root.innerHTML = [
    '<header class="grix-cloud-heading">',
    '  <div class="grix-cloud-brand"><span class="grix-cloud-brand-mark">G</span><div><strong>GRIXDROID</strong><small>ANDROID WORKSPACE</small></div></div>',
    '  <span class="grix-cloud-status" id="grix-cloud-status">SIGN IN REQUIRED</span>',
    '</header>',
    '<div class="grix-cloud-notice" id="grix-cloud-notice" role="status"></div>',
    '<section class="grix-cloud-welcome" id="grix-cloud-welcome">',
    '  <div class="grix-cloud-welcome-inner">',
    '    <div class="grix-cloud-welcome-copy">',
    '      <div class="grix-cloud-eyebrow">YOUR PRIVATE ANDROID WORKSPACE</div>',
    '      <h1>Welcome to GRIXDroid.</h1>',
    '      <p class="grix-cloud-lead">Your Android devices, app builds and sessions — all in one focused workspace.</p>',
    '      <div class="grix-cloud-auth" id="grix-cloud-auth">',
    '        <button class="grix-cloud-google" id="grix-cloud-google" type="button">' + GOOGLE_ICON_MARKUP + '<span>Continue with Google</span></button>',
    '        <p class="grix-cloud-auth-caption">Secure sign-in with your Google account.</p>',
    '      </div>',
    '      <div class="grix-cloud-trust-row"><span>SECURE GOOGLE SIGN-IN</span><i></i><span>PRIVATE WORKSPACE</span></div>',
    '    </div>',
    '  </div>',
    '</section>',

    '<div class="grix-cloud-dashboard" id="grix-cloud-dashboard" hidden>',
    '  <div class="grix-cloud-toolbar"><span id="grix-cloud-account"></span><div><button class="grix-cloud-secondary" id="grix-cloud-refresh" type="button">Refresh</button><button class="grix-cloud-secondary" id="grix-cloud-signout" type="button">Sign out</button></div></div>',
    '  <div class="grix-cloud-section-heading"><div><h3>Cloud devices</h3><p>Devices are owned by your account.</p></div></div>',
    '  <div class="grix-cloud-device-list" id="grix-cloud-device-list"><div class="grix-cloud-empty">No cloud devices yet.</div></div>',
    '  <div class="grix-cloud-request-box"><div><h3>Request an Android device</h3><p>Add a device to your workspace with a profile that fits your needs.</p></div>',
    '    <form id="grix-cloud-request-form" class="grix-cloud-request-form">',
    '      <label>Device name<input id="grix-cloud-device-name" type="text" required minlength="2" maxlength="40" placeholder="My Android"></label>',
    '      <label>Device profile<select id="grix-cloud-profile"><option value="compact">Lightweight</option><option value="standard" selected>Balanced</option></select></label>',
    '      <label>Android version<select id="grix-cloud-android-version" required><option value="">Checking worker options…</option></select></label>',
    '      <label>Device model<select id="grix-cloud-device-model" required><option value="">Checking worker options…</option></select></label>',
    '      <button class="grix-cloud-primary" id="grix-cloud-request-submit" type="submit" disabled>Request device</button>',
    '      <p class="grix-cloud-target-status" id="grix-cloud-target-status" role="status">Checking connected Android workers…</p>',
    '      <p class="grix-cloud-ios-note"><strong>iOS simulator plans:</strong> iPhone 11, 12, 13, 14 and 15. These will become selectable when a dedicated macOS iOS worker is connected.</p>',
    '    <p class="grix-cloud-ios-note"><strong>OEM Android devices:</strong> Samsung, OPPO and Xiaomi targets require a connected physical phone running its matching OEM firmware and Android build. Generic emulator screen profiles are not treated as those devices.</p>',
    '    </form>',
    '  </div>',
    '  <div class="grix-cloud-section-heading"><div><h3>Provisioning requests</h3><p>Requests stay attached to your account.</p></div></div>',
    '  <div class="grix-cloud-request-list" id="grix-cloud-request-list"><div class="grix-cloud-empty">No requests yet.</div></div>',
    '  <div class="grix-cloud-viewer" id="grix-cloud-viewer" hidden>',
    '    <div class="grix-cloud-viewer-shell grix-appetize-shell" role="dialog" aria-modal="true" aria-label="GRIXDroid live Android device">',
    '      <header class="grix-appetize-header">',
    '        <div class="grix-appetize-brand"><span class="grix-appetize-brand-mark">G</span><strong>GRIXDROID</strong></div>',
    '        <div class="grix-appetize-header-actions"><span class="grix-appetize-connection"><i></i> LIVE SESSION</span><button id="grix-cloud-viewer-menu" class="grix-appetize-menu" type="button" aria-label="Toggle session settings">☰</button><button class="grix-appetize-close" id="grix-cloud-viewer-close" type="button">Close</button></div>',
    '      </header>',
    '      <section class="grix-appetize-settings" id="grix-cloud-session-settings">',
    '        <div class="grix-appetize-setting-row"><div><strong>Show Device Controls</strong><small>Power, navigation, rotation and device tools</small></div><div class="grix-appetize-show-hide"><button id="grix-cloud-controls-show" class="selected" type="button">Show</button><button id="grix-cloud-controls-hide" type="button">Hide</button></div></div>',
    '        <div class="grix-appetize-setting-row"><div><strong>Show Developer Tools</strong><small>Android version, screen, storage and stream details</small></div><div class="grix-appetize-show-hide"><button id="grix-cloud-devtools-show" type="button">Show</button><button id="grix-cloud-devtools-hide" class="selected" type="button">Hide</button></div></div>',
    '      </section>',
    '      <section class="grix-appetize-device-area">',
    '        <div class="grix-appetize-app-title"><span class="grix-appetize-app-checkbox"></span><strong id="grix-cloud-viewer-title">Android device preview</strong><span class="grix-appetize-app-version">v1.0</span></div>',
    '        <div class="grix-appetize-device-stage">',
    '          <div class="grix-appetize-phone-wrap" id="grix-cloud-phone-wrap">',
    '            <div class="grix-appetize-phone-frame"><span class="grix-appetize-camera" aria-hidden="true"></span><video id="grix-cloud-viewer-video" autoplay playsinline muted tabindex="0" aria-label="Live Android phone screen. Tap or swipe to control Android."></video></div>',
    '          </div>',
    '          <aside class="grix-appetize-controls" id="grix-cloud-device-controls" aria-label="Android device controls">',
    '            <button class="grix-appetize-control" id="grix-cloud-action-home" type="button" title="Home" aria-label="Home"><span>⌂</span></button>',
    '            <button class="grix-appetize-control" id="grix-cloud-action-power" type="button" title="Lock or wake" aria-label="Lock or wake"><span>♙</span></button>',
    '            <button class="grix-appetize-control" id="grix-cloud-screenshot" type="button" title="Take screenshot" aria-label="Take screenshot"><span>▣</span></button>',
    '            <button class="grix-appetize-control" id="grix-cloud-action-rotate" type="button" title="Rotate screen" aria-label="Rotate screen"><span>↻</span></button>',
    '            <button class="grix-appetize-control" id="grix-cloud-action-edit" type="button" title="Type text" aria-label="Type text"><span>✎</span></button>',
    '            <button class="grix-appetize-control" id="grix-cloud-action-language" type="button" title="Language details" aria-label="Language details"><span>文</span></button>',
    '            <button class="grix-appetize-control" id="grix-cloud-action-night" type="button" title="Toggle dark mode" aria-label="Toggle dark mode"><span>☾</span></button>',
    '            <button class="grix-appetize-control" id="grix-cloud-action-font" type="button" title="Change text size" aria-label="Change text size"><span>Tt</span></button>',
    '            <button class="grix-appetize-control" id="grix-cloud-action-vibrate" type="button" title="Vibrate device" aria-label="Vibrate device"><span>▥</span></button>',
    '            <button class="grix-appetize-control" id="grix-cloud-action-upload" type="button" title="Install APK" aria-label="Install APK"><span>⇧</span></button>',
    '            <button class="grix-appetize-control" id="grix-cloud-action-fingerprint" type="button" title="Simulate fingerprint" aria-label="Simulate fingerprint"><span>◎</span></button>',
    '            <input id="grix-cloud-apk-input" type="file" accept=".apk,application/vnd.android.package-archive" hidden>',
    '          </aside>',
    '        </div>',
    '        <div class="grix-appetize-input-area">',
    '          <form id="grix-cloud-viewer-text-form" class="grix-cloud-viewer-text-form"><input id="grix-cloud-viewer-text" type="text" autocomplete="off" maxlength="120" placeholder="Type text into Android"><button class="grix-cloud-primary" type="submit">Send</button></form>',
    '          <p id="grix-cloud-viewer-input-status" role="status">Tap or swipe the phone screen to control Android.</p>',
    '          <p id="grix-cloud-viewer-status" role="status">Connecting to the Android stream…</p>',
    '        </div>',
    '      </section>',
    '      <section class="grix-appetize-devtools" id="grix-cloud-devtools" hidden aria-label="Android developer information">',
    '        <div class="grix-appetize-devtools-title">DEVELOPER TOOLS <span>LIVE RUNTIME INSPECTOR</span></div>',
    '        <dl>',
    '          <div><dt>Runtime device</dt><dd id="grix-cloud-detail-device">No device selected</dd></div>',
    '          <div><dt>Android version</dt><dd id="grix-cloud-detail-android">Not reported</dd></div>',
    '          <div><dt>Device model</dt><dd id="grix-cloud-detail-model">Not reported</dd></div>',
    '          <div><dt>Profile</dt><dd id="grix-cloud-detail-profile">—</dd></div>',
    '          <div><dt>Device state</dt><dd id="grix-cloud-detail-state">Waiting</dd></div>',
    '          <div><dt>Stream</dt><dd id="grix-cloud-detail-stream">WebRTC</dd></div>',
    '          <div><dt>Storage</dt><dd id="grix-cloud-detail-storage">Persistent</dd></div>',
    '        </dl>',
    '      </section>',
    '    </div>',
    '  </div>',
    '</div>',
  ].join('');

  const header = app.querySelector('.header');
  if (header?.parentElement) header.insertAdjacentElement('afterend', root);
  else app.prepend(root);

  const get = <T extends HTMLElement>(selector: string): T => {
    const element = root.querySelector<T>(selector);
    if (!element) throw new Error('Missing cloud device element: ' + selector);
    return element;
  };

  const notice = get<HTMLElement>('#grix-cloud-notice');
  const status = get<HTMLElement>('#grix-cloud-status');
  const authPanel = get<HTMLElement>('#grix-cloud-auth');
  const dashboard = get<HTMLElement>('#grix-cloud-dashboard');
  const welcome = get<HTMLElement>('#grix-cloud-welcome');
  const googleButton = get<HTMLButtonElement>('#grix-cloud-google');
  const requestForm = get<HTMLFormElement>('#grix-cloud-request-form');
  const requestSubmit = get<HTMLButtonElement>('#grix-cloud-request-submit');
  const deviceList = get<HTMLElement>('#grix-cloud-device-list');
  const requestList = get<HTMLElement>('#grix-cloud-request-list');
  const accountLabel = get<HTMLElement>('#grix-cloud-account');
  const viewer = get<HTMLElement>('#grix-cloud-viewer');
  const viewerTitle = get<HTMLElement>('#grix-cloud-viewer-title');
  const viewerStatus = get<HTMLElement>('#grix-cloud-viewer-status');
  const viewerInputStatus = get<HTMLElement>('#grix-cloud-viewer-input-status');
  const viewerVideo = get<HTMLVideoElement>('#grix-cloud-viewer-video');
  const viewerTextForm = get<HTMLFormElement>('#grix-cloud-viewer-text-form');
  const viewerTextInput = get<HTMLInputElement>('#grix-cloud-viewer-text');

  let viewerPeer: RTCPeerConnection | null = null;
  let viewerResource: string | null = null;
  let viewerToken: string | null = null;
  let viewerDeviceId: string | null = null;
  let pointerStart: { x: number; y: number; at: number } | null = null;
  let screenOrientation: 'portrait' | 'landscape' = 'portrait';
  let nightModeEnabled = false;
  const fontScales = [1, 1.15, 1.3];
  let fontScaleIndex = 0;
  let authSession: AuthSession | null = null;
  let busy = false;
  let availableTargets: DeviceTarget[] = [];

  function setNotice(message: string, kind: 'info' | 'success' | 'error' = 'info'): void {
    notice.textContent = message;
    notice.className = 'grix-cloud-notice ' + kind;
    notice.hidden = !message;
  }

  function setSignedIn(email: string | undefined): void {
    welcome.hidden = Boolean(authSession);
    authPanel.hidden = Boolean(authSession);
    dashboard.hidden = !authSession;
    status.textContent = authSession ? 'ACCOUNT CONNECTED' : configured ? 'SIGN IN REQUIRED' : 'SIGN-IN UNAVAILABLE';
    status.classList.toggle('connected', Boolean(authSession));
    const accountEmail = email || authSession?.email;
    accountLabel.textContent = accountEmail ? 'Signed in as ' + accountEmail : 'Signed in';
  }

  async function waitForIceGathering(peer: RTCPeerConnection): Promise<void> {
    if (peer.iceGatheringState === 'complete') return;
    await new Promise<void>((resolve) => {
      const timeout = window.setTimeout(finish, 7000);
      function finish(): void {
        window.clearTimeout(timeout);
        peer.removeEventListener('icegatheringstatechange', onChange);
        resolve();
      }
      function onChange(): void {
        if (peer.iceGatheringState === 'complete') finish();
      }
      peer.addEventListener('icegatheringstatechange', onChange);
      onChange();
    });
  }

  async function closeViewer(): Promise<void> {
    const resource = viewerResource;
    const token = viewerToken;
    viewerResource = null;
    viewerToken = null;
    viewerDeviceId = null;
    pointerStart = null;
    viewerInputStatus.textContent = 'Tap or swipe the screen to control Android.';
    if (viewerPeer) viewerPeer.close();
    viewerPeer = null;
    viewerVideo.srcObject = null;
    viewer.hidden = true;
    if (resource && token) {
      await fetch(resource, {
        method: 'DELETE',
        headers: { Authorization: 'Bearer ' + token },
        cache: 'no-store',
      }).catch(() => undefined);
    }
  }

  async function openViewer(device: CloudDevice): Promise<void> {
    if (!WHEP_BASE_URL) throw new Error('Set VITE_GRIXDROID_WHEP_BASE_URL to the HTTPS MediaMTX address to enable browser streaming.');
    if (!authSession) throw new Error('Sign in before opening a device stream.');
    if (device.state !== 'running' || device.stream_state !== 'ready') throw new Error('This Android device does not currently have a ready WebRTC stream.');

    await closeViewer();
    viewerDeviceId = device.id;
    viewer.hidden = false;
    viewerTitle.textContent = device.name;
    screenOrientation = 'portrait';
    nightModeEnabled = false;
    fontScaleIndex = 0;
    get<HTMLElement>('#grix-cloud-session-settings').hidden = false;
    get<HTMLElement>('#grix-cloud-device-controls').hidden = false;
    get<HTMLElement>('#grix-cloud-devtools').hidden = true;
    get<HTMLButtonElement>('#grix-cloud-controls-show').classList.add('selected');
    get<HTMLButtonElement>('#grix-cloud-controls-hide').classList.remove('selected');
    get<HTMLButtonElement>('#grix-cloud-devtools-show').classList.remove('selected');
    get<HTMLButtonElement>('#grix-cloud-devtools-hide').classList.add('selected');
    get<HTMLElement>('#grix-cloud-phone-wrap').style.setProperty('--device-scale', '1');
    get<HTMLElement>('#grix-cloud-phone-wrap').style.setProperty('--device-ratio', '9 / 16');
    get<HTMLElement>('#grix-cloud-viewer-menu').setAttribute('aria-expanded', 'true');
    get<HTMLElement>('#grix-cloud-detail-device').textContent = 'Cloud Android · ' + device.name;
    get<HTMLElement>('#grix-cloud-detail-android').textContent = device.android_release ? 'Android ' + device.android_release : 'Not reported';
    get<HTMLElement>('#grix-cloud-detail-model').textContent = device.device_model
      ? (DEVICE_MODEL_LABELS[device.device_model] || device.device_model.replace(/_/g, ' '))
      : 'Not reported';
    get<HTMLElement>('#grix-cloud-detail-profile').textContent = device.profile;
    get<HTMLElement>('#grix-cloud-detail-state').textContent = device.state;
    get<HTMLElement>('#grix-cloud-detail-stream').textContent = device.stream_state;
    get<HTMLElement>('#grix-cloud-detail-storage').textContent = device.storage_state;
    viewerInputStatus.textContent = 'Tap or swipe the phone screen to control Android.';
    viewerStatus.textContent = 'Negotiating a secure WebRTC connection…';
    const token = await accessToken();
    const peer = new RTCPeerConnection();
    viewerPeer = peer;
    peer.addTransceiver('video', { direction: 'recvonly' });
    peer.ontrack = (event) => {
      viewerVideo.srcObject = event.streams[0] || new MediaStream([event.track]);
      viewerStatus.textContent = 'Connected · live Android screen';
      void viewerVideo.play().catch(() => undefined);
    };
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'failed' || peer.connectionState === 'disconnected') {
        viewerStatus.textContent = 'Connection lost. Close this viewer and try again.';
      }
    };

    try {
      await peer.setLocalDescription(await peer.createOffer());
      await waitForIceGathering(peer);
      const endpoint = WHEP_BASE_URL + '/' + encodeURIComponent(device.id) + '/whep';
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/sdp',
          Authorization: 'Bearer ' + token,
        },
        body: peer.localDescription?.sdp || '',
        cache: 'no-store',
      });
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(detail || 'WebRTC playback request failed (' + response.status + ').');
      }
      const answer = await response.text();
      const location = response.headers.get('Location');
      if (location) viewerResource = new URL(location, endpoint).toString();
      viewerToken = token;
      await peer.setRemoteDescription({ type: 'answer', sdp: answer });
    } catch (error) {
      await closeViewer();
      throw error;
    }
  }

  function normalizedScreenPoint(event: PointerEvent): { x: number; y: number } | null {
    const rect = viewerVideo.getBoundingClientRect();
    const videoWidth = viewerVideo.videoWidth;
    const videoHeight = viewerVideo.videoHeight;
    if (!videoWidth || !videoHeight || !rect.width || !rect.height) return null;

    // Account for the letterboxing caused by object-fit: contain.
    const scale = Math.min(rect.width / videoWidth, rect.height / videoHeight);
    const renderedWidth = videoWidth * scale;
    const renderedHeight = videoHeight * scale;
    const left = rect.left + (rect.width - renderedWidth) / 2;
    const top = rect.top + (rect.height - renderedHeight) / 2;
    const x = (event.clientX - left) / renderedWidth;
    const y = (event.clientY - top) / renderedHeight;
    if (x < 0 || x > 1 || y < 0 || y > 1) return null;
    return { x, y };
  }

  async function sendViewerCommand(command: Record<string, string | number | boolean>): Promise<void> {
    if (!viewerDeviceId || !authSession) throw new Error('Open a signed-in Android device before sending input.');
    viewerInputStatus.textContent = 'Sending input to Android…';
    await restRequest<unknown>('/cloud_device_actions', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ device_id: viewerDeviceId, command }),
    });
    viewerInputStatus.textContent = 'Input queued for the Android worker.';
  }

  async function uploadAndInstallApk(file: File): Promise<void> {
    if (!authSession || !viewerDeviceId) throw new Error('Open a signed-in Android device before installing an APK.');
    if (!file.name.toLowerCase().endsWith('.apk')) throw new Error('Choose an Android .apk file.');
    if (file.size <= 0 || file.size > 50 * 1024 * 1024) throw new Error('APK files must be between 1 byte and 50 MB.');
    const token = await accessToken();
    const objectPath = authSession.user_id + '/' + viewerDeviceId + '/' + crypto.randomUUID() + '.apk';
    viewerInputStatus.textContent = 'Uploading APK securely to your private GRIXDroid storage…';
    const encodedPath = objectPath.split('/').map(encodeURIComponent).join('/');
    const upload = await fetch(SUPABASE_URL + '/storage/v1/object/grixdroid-apks/' + encodedPath, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: 'Bearer ' + token,
        'Content-Type': file.type || 'application/vnd.android.package-archive',
        'x-upsert': 'false',
      },
      body: file,
      cache: 'no-store',
    });
    const uploadPayload = await readPayload(upload);
    if (!upload.ok) throw new Error(responseMessage(uploadPayload));
    const safeFilename = file.name.replace(/[^A-Za-z0-9._ -]/g, '_');
    const queued = await restRequest<CloudDeviceAction[]>('/cloud_device_actions', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        device_id: viewerDeviceId,
        command: { type: 'install_apk', object_path: objectPath, filename: safeFilename },
      }),
    });
    const actionId = queued?.[0]?.id;
    if (!actionId) throw new Error('The APK was uploaded, but the worker command could not be queued.');
    viewerInputStatus.textContent = 'APK uploaded. Waiting for Android package installation…';
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      const [action] = await restRequest<CloudDeviceAction[]>(
        '/cloud_device_actions?id=eq.' + encodeURIComponent(actionId) + '&select=id,status,failure_reason',
      );
      if (action?.status === 'completed') {
        viewerInputStatus.textContent = 'APK installed successfully on the Android device.';
        return;
      }
      if (action?.status === 'failed') {
        throw new Error(action.failure_reason || 'Android package installation failed.');
      }
      await new Promise<void>((resolve) => window.setTimeout(resolve, 1200));
    }
    viewerInputStatus.textContent = 'APK upload is complete. The worker is still processing the install request; refresh the device later to confirm.';
  }

  function userFacingError(error: unknown, fallback: string): string {
    const message = error && typeof error === 'object' && 'message' in error
      ? String((error as { message?: unknown }).message ?? '')
      : String(error ?? '');
    const normalized = message.toLowerCase();

    if (/invalid login credentials|invalid_credentials|invalid_grant|invalid password/.test(normalized)) {
      return 'The email or password is incorrect.';
    }
    if (/email not confirmed|email_not_confirmed/.test(normalized)) {
      return 'Please confirm your email address before signing in.';
    }
    if (/already registered|user already exists|email already exists/.test(normalized)) {
      return 'An account with this email already exists. Sign in instead.';
    }
    if (/too many requests|rate limit|over_email_send_rate_limit/.test(normalized)) {
      return 'Too many attempts. Please wait a moment and try again.';
    }
    if (/session expired|jwt expired/.test(normalized)) {
      return 'Your session expired. Please sign in again.';
    }
    if (/failed to fetch|networkerror|network request failed|not_found|fra1::|vercel|internal server error|bad gateway|service unavailable|gateway timeout|\b(500|502|503|504)\b/.test(normalized)) {
      return 'GRIXDroid is temporarily unavailable. Please try again shortly.';
    }
    return fallback;
  }

  function responseMessage(payload: unknown): string {
    if (typeof payload === 'string') return payload;
    if (payload && typeof payload === 'object') {
      const value = payload as { message?: string; msg?: string; error_description?: string; error?: string; details?: string };
      return value.error_description || value.message || value.msg || value.details || value.error || 'The request could not be completed.';
    }
    return 'The request could not be completed.';
  }

  async function readPayload(response: Response): Promise<unknown> {
    const type = response.headers.get('content-type') || '';
    if (type.includes('application/json')) return response.json();
    return response.text();
  }

  async function authRequest(path: string, body: Record<string, string>): Promise<AuthResponse> {
    const response = await fetch(authBase + path, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
    const payload = await readPayload(response);
    if (!response.ok) throw new Error(responseMessage(payload));
    return payload as AuthResponse;
  }

  function persistSession(): void {
    if (!authSession) return;
    try {
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(authSession));
    } catch {
      // The active in-memory session still works if browser storage is disabled.
    }
  }

  function restoreSession(): AuthSession | null {
    try {
      const raw = localStorage.getItem(SESSION_STORAGE_KEY);
      if (!raw) return null;
      const stored = JSON.parse(raw) as Partial<AuthSession>;
      const validUserId = typeof stored.user_id === 'string'
        && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(stored.user_id);
      if (
        typeof stored.access_token !== 'string'
        || typeof stored.refresh_token !== 'string'
        || typeof stored.expires_at !== 'number'
        || !validUserId
      ) {
        localStorage.removeItem(SESSION_STORAGE_KEY);
        return null;
      }
      const restored: AuthSession = {
        access_token: stored.access_token,
        refresh_token: stored.refresh_token,
        expires_at: stored.expires_at,
        user_id: stored.user_id as string,
        email: typeof stored.email === 'string' ? stored.email : undefined,
      };
      authSession = restored;
      return restored;
    } catch {
      try { localStorage.removeItem(SESSION_STORAGE_KEY); } catch { /* Ignore unavailable storage. */ }
      authSession = null;
      return null;
    }
  }

  function acceptSession(payload: AuthResponse): boolean {
    if (!payload.access_token || !payload.refresh_token) return false;
    const lifetime = Math.max(60, Number(payload.expires_in) || 3600);
    let userId = payload.user?.id || '';
    if (!userId) {
      try {
        const encoded = payload.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        userId = JSON.parse(atob(encoded)).sub || '';
      } catch {
        userId = '';
      }
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) return false;
    authSession = {
      access_token: payload.access_token,
      refresh_token: payload.refresh_token,
      expires_at: Number(payload.expires_at) || Math.floor(Date.now() / 1000) + lifetime,
      user_id: userId,
      email: payload.user?.email || authSession?.email,
    };
    persistSession();
    return true;
  }

  function base64Url(bytes: Uint8Array): string {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function readOAuthVerifierCookie(): string | null {
    const prefix = encodeURIComponent(GOOGLE_OAUTH_VERIFIER_KEY) + '=';
    const item = document.cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith(prefix));
    return item ? decodeURIComponent(item.slice(prefix.length)) : null;
  }

  function clearOAuthVerifier(): void {
    try { sessionStorage.removeItem(GOOGLE_OAUTH_VERIFIER_KEY); } catch { /* Storage may be blocked. */ }
    try { localStorage.removeItem(GOOGLE_OAUTH_VERIFIER_KEY); } catch { /* Storage may be blocked. */ }
    try {
      document.cookie = encodeURIComponent(GOOGLE_OAUTH_VERIFIER_KEY) + '=; Path=/; Max-Age=0; SameSite=Lax; Secure';
    } catch { /* Cookie storage may be blocked. */ }
  }

  function storeOAuthVerifier(verifier: string): void {
    clearOAuthVerifier();

    try {
      sessionStorage.setItem(GOOGLE_OAUTH_VERIFIER_KEY, verifier);
      return;
    } catch { /* Fall back to the other browser storage mechanisms. */ }

    try {
      localStorage.setItem(GOOGLE_OAUTH_VERIFIER_KEY, verifier);
      return;
    } catch { /* Fall back to a short-lived same-site cookie. */ }

    try {
      document.cookie = encodeURIComponent(GOOGLE_OAUTH_VERIFIER_KEY) + '='
        + encodeURIComponent(verifier) + '; Path=/; Max-Age=300; SameSite=Lax; Secure';
      if (readOAuthVerifierCookie() === verifier) return;
    } catch { /* Fall through to a clear browser-storage error. */ }

    throw new Error('This browser is blocking temporary sign-in storage. Enable cookies and site storage for GRIXDroid, then try again.');
  }

  function takeOAuthVerifier(): string | null {
    let verifier: string | null = null;
    try { verifier = sessionStorage.getItem(GOOGLE_OAUTH_VERIFIER_KEY); } catch { /* Try fallback storage. */ }
    if (!verifier) {
      try { verifier = localStorage.getItem(GOOGLE_OAUTH_VERIFIER_KEY); } catch { /* Try cookie storage. */ }
    }
    if (!verifier) {
      try { verifier = readOAuthVerifierCookie(); } catch { /* Ignore inaccessible cookies. */ }
    }
    clearOAuthVerifier();
    return verifier;
  }

  async function beginGoogleSignIn(): Promise<void> {
    if (!configured || busy) return;

    const canonicalSite = new URL(GRIXDROID_SITE_URL);
    if (window.location.origin !== canonicalSite.origin) {
      const startOnProduction = new URL('/', canonicalSite.origin);
      startOnProduction.searchParams.set(GOOGLE_SIGNIN_START_PARAM, '1');
      window.location.assign(startOnProduction.toString());
      return;
    }

    if (!window.isSecureContext || !window.crypto?.getRandomValues || !window.crypto?.subtle) {
      setNotice('Secure Google sign-in needs a modern browser on an HTTPS connection. Open GRIXDroid in Chrome and try again.', 'error');
      return;
    }

    let stage = 'preparing a secure sign-in challenge';
    googleButton.disabled = true;
    googleButton.textContent = 'Connecting to Google…';
    setNotice('Preparing secure Google sign-in…');
    try {
      const random = new Uint8Array(32);
      window.crypto.getRandomValues(random);
      const verifier = base64Url(random);
      const verifierBytes = new Uint8Array(verifier.length);
      for (let index = 0; index < verifier.length; index += 1) {
        verifierBytes[index] = verifier.charCodeAt(index);
      }
      const digest = await window.crypto.subtle.digest('SHA-256', verifierBytes);
      const challenge = base64Url(new Uint8Array(digest));

      stage = 'saving the temporary sign-in verifier';
      storeOAuthVerifier(verifier);

      stage = 'building the Supabase authorization URL';
      const supabaseOrigin = new URL(SUPABASE_URL);
      if (supabaseOrigin.protocol !== 'https:' && supabaseOrigin.hostname !== 'localhost') {
        throw new Error('The configured Supabase URL must use HTTPS.');
      }
      const authorizeUrl = new URL('/auth/v1/authorize', supabaseOrigin.origin);
      authorizeUrl.searchParams.set('provider', 'google');
      authorizeUrl.searchParams.set('redirect_to', new URL('/', GRIXDROID_SITE_URL).toString());
      authorizeUrl.searchParams.set('code_challenge', challenge);
      authorizeUrl.searchParams.set('code_challenge_method', 's256');
      authorizeUrl.searchParams.set('scopes', 'openid email profile');

      stage = 'opening Google sign-in';
      window.location.href = authorizeUrl.toString();
    } catch (error) {
      clearOAuthVerifier();
      googleButton.disabled = false;
      googleButton.innerHTML = GOOGLE_ICON_MARKUP + '<span>Continue with Google</span>';
      if (import.meta.env.DEV) {
        console.error('[GRIXDroid] Google sign-in startup failed during ' + stage, error);
      }
      setNotice('Google sign-in is temporarily unavailable. Please try again.', 'error');
    }
  }

  function cleanOAuthCallbackUrl(url: URL): void {
    for (const key of ['code', 'error', 'error_code', 'error_description', 'state', 'sb_flow_id']) {
      url.searchParams.delete(key);
    }
    window.history.replaceState({}, document.title, url.pathname + url.search + url.hash);
  }

  async function finishGoogleSignInRedirect(): Promise<boolean> {
    const callbackUrl = new URL(window.location.href);
    const code = callbackUrl.searchParams.get('code');
    const error = callbackUrl.searchParams.get('error_description') || callbackUrl.searchParams.get('error');
    if (!code && !error) return false;

    cleanOAuthCallbackUrl(callbackUrl);
    if (error) {
      sessionStorage.removeItem(GOOGLE_OAUTH_VERIFIER_KEY);
      setNotice('Google sign-in was not completed. Please try again.', 'error');
      return true;
    }
    if (!code) {
      sessionStorage.removeItem(GOOGLE_OAUTH_VERIFIER_KEY);
      setNotice('Google sign-in could not be completed. Please start again.', 'error');
      return true;
    }

    const verifier = takeOAuthVerifier();
    if (!verifier) {
      setNotice('Your Google sign-in session expired. Please start again.', 'error');
      return true;
    }

    setNotice('Finishing Google sign-in…');
    try {
      const payload = await authRequest('/token?grant_type=pkce', {
        auth_code: code,
        code_verifier: verifier,
      });
      if (!acceptSession(payload)) throw new Error('No session was returned.');
      setSignedIn(payload.user?.email || authSession?.email);
      setNotice('Google sign-in successful. Loading your workspace…', 'success');
      await loadDeviceOptions();
      await reload();
      window.dispatchEvent(new CustomEvent('grixdroid:workspace-ready'));
      setNotice('You are signed in with Google. Your private workspace is ready.', 'success');
    } catch {
      authSession = null;
      try { localStorage.removeItem(SESSION_STORAGE_KEY); } catch { /* Ignore unavailable storage. */ }
      setSignedIn(undefined);
      setNotice('Google sign-in could not be completed. Please try again.', 'error');
    }
    return true;
  }

  async function refreshSession(): Promise<boolean> {
    if (!authSession?.refresh_token) return false;
    const refreshToken = authSession.refresh_token;
    try {
      const payload = await authRequest('/token?grant_type=refresh_token', { refresh_token: refreshToken });
      return acceptSession(payload);
    } catch {
      authSession = null;
      try { localStorage.removeItem(SESSION_STORAGE_KEY); } catch { /* Ignore unavailable storage. */ }
      return false;
    }
  }

  async function accessToken(): Promise<string> {
    if (!authSession) throw new Error('Sign in to your GRIXDroid account first.');
    if (authSession.expires_at * 1000 - Date.now() < 60_000) {
      if (!(await refreshSession()) || !authSession) throw new Error('Your session expired. Please sign in again.');
    }
    return authSession.access_token;
  }

  async function restRequest<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
    const token = await accessToken();
    const headers = new Headers(init.headers);
    headers.set('apikey', SUPABASE_KEY);
    headers.set('Authorization', 'Bearer ' + token);
    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    const response = await fetch(restBase + path, { ...init, headers, cache: 'no-store' });
    const payload = await readPayload(response);
    if (response.status === 401 && retry && await refreshSession()) {
      return restRequest<T>(path, init, false);
    }
    if (!response.ok) throw new Error(responseMessage(payload));
    return payload as T;
  }

  function addEmpty(target: HTMLElement, message: string): void {
    const empty = document.createElement('div');
    empty.className = 'grix-cloud-empty';
    empty.textContent = message;
    target.replaceChildren(empty);
  }

  function makeStatus(value: string): HTMLElement {
    const pill = document.createElement('span');
    pill.className = 'grix-cloud-state grix-cloud-state-' + value;
    pill.textContent = value.replace(/_/g, ' ');
    return pill;
  }

  function renderDevices(devices: CloudDevice[]): void {
    if (!devices.length) return addEmpty(deviceList, 'No Android devices have been provisioned for this account yet.');
    const fragment = document.createDocumentFragment();
    for (const device of devices) {
      const card = document.createElement('article');
      card.className = 'grix-cloud-device-card';
      const top = document.createElement('div');
      top.className = 'grix-cloud-card-top';
      const name = document.createElement('strong');
      name.textContent = device.name;
      top.append(name, makeStatus(device.state));
      const meta = document.createElement('p');
      const modelLabel = DEVICE_MODEL_LABELS[device.device_model] || device.device_model || 'Device model not reported';
      meta.textContent = (device.android_release ? 'Android ' + device.android_release : 'Android release not reported')
        + ' · ' + modelLabel + ' · ' + device.profile + ' profile';
      const storage = document.createElement('p');
      const bytes = Number(device.storage_bytes) || 0;
      storage.textContent = 'Persistent data volume · ' + (device.storage_state || 'pending') + ' · ' + (bytes > 0 ? (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB reported' : 'size not reported');
      const stream = document.createElement('p');
      stream.textContent = 'WebRTC stream · ' + (device.stream_state || 'disabled');
      card.append(top, meta, storage, stream);
      if (WHEP_BASE_URL && device.state === 'running' && device.stream_state === 'ready') {
        const watch = document.createElement('button');
        watch.className = 'grix-cloud-secondary';
        watch.type = 'button';
        watch.textContent = 'Open Android screen';
        watch.addEventListener('click', async () => {
          watch.disabled = true;
          try {
            await openViewer(device);
          } catch (error) {
            setNotice(userFacingError(error, 'Unable to open the Android stream.'), 'error');
          } finally {
            watch.disabled = false;
          }
        });
        card.append(watch);
      }
      fragment.append(card);
    }
    deviceList.replaceChildren(fragment);
  }

  function renderRequests(requests: DeviceRequest[]): void {
    if (!requests.length) return addEmpty(requestList, 'No provisioning requests yet.');
    const fragment = document.createDocumentFragment();
    for (const item of requests) {
      const card = document.createElement('article');
      card.className = 'grix-cloud-request-card';
      const top = document.createElement('div');
      top.className = 'grix-cloud-card-top';
      const name = document.createElement('strong');
      name.textContent = item.name;
      top.append(name, makeStatus(item.status));
      const detail = document.createElement('p');
      const versionLabel = ANDROID_VERSION_LABELS[item.android_version] || ('Android ' + item.android_version);
      const modelLabel = DEVICE_MODEL_LABELS[item.device_model] || item.device_model.replace(/_/g, ' ');
      detail.textContent = versionLabel + ' · ' + modelLabel + ' · ' + item.profile + ' profile · Requested ' + new Date(item.created_at).toLocaleString();
      card.append(top, detail);
      if (item.status === 'failed') {
        const reason = document.createElement('p');
        reason.className = 'grix-cloud-error-detail';
        reason.textContent = 'We could not start this device. Please try again later.';
        card.append(reason);
      }
      if (item.status === 'queued') {
        const cancel = document.createElement('button');
        cancel.className = 'grix-cloud-link';
        cancel.type = 'button';
        cancel.textContent = 'Cancel request';
        cancel.addEventListener('click', async () => {
          cancel.disabled = true;
          try {
            await restRequest<unknown>('/cloud_device_requests?id=eq.' + encodeURIComponent(item.id) + '&status=eq.queued', { method: 'DELETE' });
            await reload();
      window.dispatchEvent(new CustomEvent('grixdroid:workspace-ready'));
            setNotice('Provisioning request cancelled.', 'success');
          } catch (error) {
            setNotice(userFacingError(error, 'Unable to cancel request.'), 'error');
            cancel.disabled = false;
          }
        });
        card.append(cancel);
      }
      fragment.append(card);
    }
    requestList.replaceChildren(fragment);
  }

  function renderDeviceTargetOptions(): void {
    const versionSelect = get<HTMLSelectElement>('#grix-cloud-android-version');
    const modelSelect = get<HTMLSelectElement>('#grix-cloud-device-model');
    const targetStatus = get<HTMLElement>('#grix-cloud-target-status');
    const previousVersion = versionSelect.value;
    const order = ['12', '12L', '13', '14', '15', '16'];
    const versions = [...new Set(availableTargets.map((target) => target.android_version))]
      .sort((a, b) => order.indexOf(a) - order.indexOf(b));

    versionSelect.replaceChildren();
    if (!versions.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'No worker available';
      versionSelect.append(option);
      modelSelect.replaceChildren();
      const modelOption = document.createElement('option');
      modelOption.value = '';
      modelOption.textContent = 'No worker available';
      modelSelect.append(modelOption);
      versionSelect.disabled = true;
      modelSelect.disabled = true;
      targetStatus.textContent = 'No compatible Android worker is online. Pixel emulator targets appear when an Android Emulator worker connects. Samsung, OPPO and Xiaomi targets appear only from a verified real-device worker running the matching model and firmware.';
      requestSubmit.disabled = true;
      return;
    }

    for (const version of versions) {
      const option = document.createElement('option');
      option.value = version;
      option.textContent = ANDROID_VERSION_LABELS[version] || ('Android ' + version);
      versionSelect.append(option);
    }
    versionSelect.value = versions.includes(previousVersion) ? previousVersion : versions[0];
    versionSelect.disabled = false;

    const previousModel = modelSelect.value;
    const models = [...new Set(availableTargets
      .filter((target) => target.android_version === versionSelect.value)
      .map((target) => target.device_model))].sort();
    modelSelect.replaceChildren();
    for (const model of models) {
      const option = document.createElement('option');
      option.value = model;
      option.textContent = DEVICE_MODEL_LABELS[model] || model.replace(/_/g, ' ');
      modelSelect.append(option);
    }
    modelSelect.value = models.includes(previousModel) ? previousModel : (models[0] || '');
    modelSelect.disabled = models.length === 0;
    targetStatus.textContent = 'Only targets verified by an active worker are selectable. Samsung, OPPO and Xiaomi targets require a real device with its matching OEM firmware and Android build; generic AVD screen profiles are not accepted. iPhone 11–15 simulators require a separate macOS iOS worker.';
    requestSubmit.disabled = busy || !availableTargets.some((target) =>
      target.android_version === versionSelect.value && target.device_model === modelSelect.value);
  }

  async function loadDeviceOptions(): Promise<void> {
    if (!authSession) return;
    const targetStatus = get<HTMLElement>('#grix-cloud-target-status');
    targetStatus.textContent = 'Checking connected Android workers…';
    try {
      const response = await restRequest<DeviceOptionsResponse>('/rpc/grixdroid_get_device_options', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      availableTargets = Array.isArray(response?.targets)
        ? response.targets.filter((target) =>
          typeof target.android_version === 'string' && typeof target.device_model === 'string')
        : [];
      renderDeviceTargetOptions();
    } catch {
      availableTargets = [];
      renderDeviceTargetOptions();
      targetStatus.textContent = 'Could not read worker capabilities. Refresh the workspace and try again.';
    }
  }

  async function reload(): Promise<void> {
    if (!authSession) return;
    const [devices, requests] = await Promise.all([
      restRequest<CloudDevice[]>('/cloud_devices?select=id,name,profile,android_release,device_model,state,storage_state,storage_bytes,stream_state,created_at&order=created_at.desc'),
      restRequest<DeviceRequest[]>('/cloud_device_requests?select=id,name,profile,android_version,device_model,status,created_at&order=created_at.desc'),
    ]);
    renderDevices(devices);
    renderRequests(requests);
  }

  if (!configured) {
    googleButton.hidden = true;
    setSignedIn(undefined);
    setNotice('Sign-in is temporarily unavailable. Please try again later.', 'info');
    return;
  }

  googleButton.addEventListener('click', () => { void beginGoogleSignIn(); });
  get<HTMLSelectElement>('#grix-cloud-android-version').addEventListener('change', renderDeviceTargetOptions);
  get<HTMLSelectElement>('#grix-cloud-device-model').addEventListener('change', renderDeviceTargetOptions);

  requestForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!authSession || busy) return;
    const nameInput = get<HTMLInputElement>('#grix-cloud-device-name');
    const name = nameInput.value.trim();
    const profile = get<HTMLSelectElement>('#grix-cloud-profile').value;
    const androidVersion = get<HTMLSelectElement>('#grix-cloud-android-version').value;
    const deviceModel = get<HTMLSelectElement>('#grix-cloud-device-model').value;
    const targetIsAvailable = availableTargets.some((target) =>
      target.android_version === androidVersion && target.device_model === deviceModel);
    if (name.length < 2 || name.length > 40) return setNotice('Device names must contain 2–40 characters.', 'error');
    if (!targetIsAvailable) return setNotice('Choose an Android version and device model supported by an online worker.', 'error');
    busy = true;
    requestSubmit.disabled = true;
    setNotice('Submitting your provisioning request…');
    try {
      await restRequest<DeviceRequest[]>('/cloud_device_requests', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ name, profile, android_version: androidVersion, device_model: deviceModel }),
      });
      nameInput.value = '';
      await reload();
      window.dispatchEvent(new CustomEvent('grixdroid:workspace-ready'));
      setNotice('Your device request has been saved to your workspace.', 'success');
    } catch (error) {
      setNotice(userFacingError(error, 'Unable to submit the provisioning request.'), 'error');
    } finally {
      busy = false;
      renderDeviceTargetOptions();
    }
  });

  get<HTMLButtonElement>('#grix-cloud-refresh').addEventListener('click', async () => {
    try {
      await loadDeviceOptions();
      await reload();
      window.dispatchEvent(new CustomEvent('grixdroid:workspace-ready'));
      setNotice('Device information refreshed.', 'success');
    } catch (error) {
      setNotice(userFacingError(error, 'Unable to refresh devices.'), 'error');
    }
  });

  const setShowHide = (showId: string, hideId: string, panelId: string, visible: boolean) => {
    get<HTMLElement>('#' + panelId).hidden = !visible;
    get<HTMLButtonElement>('#' + showId).classList.toggle('selected', visible);
    get<HTMLButtonElement>('#' + hideId).classList.toggle('selected', !visible);
  };
  get<HTMLButtonElement>('#grix-cloud-controls-show').addEventListener('click', () => setShowHide('grix-cloud-controls-show', 'grix-cloud-controls-hide', 'grix-cloud-device-controls', true));
  get<HTMLButtonElement>('#grix-cloud-controls-hide').addEventListener('click', () => setShowHide('grix-cloud-controls-show', 'grix-cloud-controls-hide', 'grix-cloud-device-controls', false));
  get<HTMLButtonElement>('#grix-cloud-devtools-show').addEventListener('click', () => setShowHide('grix-cloud-devtools-show', 'grix-cloud-devtools-hide', 'grix-cloud-devtools', true));
  get<HTMLButtonElement>('#grix-cloud-devtools-hide').addEventListener('click', () => setShowHide('grix-cloud-devtools-show', 'grix-cloud-devtools-hide', 'grix-cloud-devtools', false));
  get<HTMLButtonElement>('#grix-cloud-viewer-menu').addEventListener('click', () => {
    const settings = get<HTMLElement>('#grix-cloud-session-settings');
    settings.hidden = !settings.hidden;
  });

  get<HTMLButtonElement>('#grix-cloud-screenshot').addEventListener('click', () => {
    if (!viewerVideo.videoWidth || !viewerVideo.videoHeight) {
      viewerInputStatus.textContent = 'The Android display is not ready for a screenshot yet.';
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = viewerVideo.videoWidth;
    canvas.height = viewerVideo.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) {
      viewerInputStatus.textContent = 'Screenshot capture is not supported by this browser.';
      return;
    }
    context.drawImage(viewerVideo, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) {
        viewerInputStatus.textContent = 'Could not create the Android screenshot.';
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'grixdroid-android-screenshot.png';
      link.click();
      URL.revokeObjectURL(url);
      viewerInputStatus.textContent = 'Screenshot captured from the live Android screen.';
    }, 'image/png');
  });

  viewerVideo.addEventListener('pointerdown', (event) => {
    if (!viewerDeviceId) return;
    const point = normalizedScreenPoint(event);
    if (!point) return;
    pointerStart = { ...point, at: Date.now() };
    viewerVideo.setPointerCapture(event.pointerId);
  });

  viewerVideo.addEventListener('pointerup', (event) => {
    const start = pointerStart;
    pointerStart = null;
    const end = normalizedScreenPoint(event);
    if (!start || !end || !viewerDeviceId) return;

    const distance = Math.hypot(end.x - start.x, end.y - start.y);
    const durationMs = Math.max(80, Math.min(1500, Date.now() - start.at));
    const command: Record<string, string | number> = distance > 0.02
      ? { type: 'swipe', x: start.x, y: start.y, endX: end.x, endY: end.y, durationMs }
      : { type: 'tap', x: end.x, y: end.y };

    void sendViewerCommand(command).catch((error) => {
      viewerInputStatus.textContent = userFacingError(error, 'Android input could not be sent.');
    });
  });

  viewerVideo.addEventListener('pointercancel', () => { pointerStart = null; });
  viewerVideo.addEventListener('lostpointercapture', () => { pointerStart = null; });

  get<HTMLButtonElement>('#grix-cloud-action-home').addEventListener('click', () => {
    void sendViewerCommand({ type: 'key', key: 'HOME' }).catch((error) => {
      viewerInputStatus.textContent = userFacingError(error, 'Home command failed.');
    });
  });
  get<HTMLButtonElement>('#grix-cloud-action-power').addEventListener('click', () => {
    void sendViewerCommand({ type: 'key', key: 'POWER' }).catch((error) => {
      viewerInputStatus.textContent = userFacingError(error, 'Power command failed.');
    });
  });
  get<HTMLButtonElement>('#grix-cloud-action-rotate').addEventListener('click', () => {
    screenOrientation = screenOrientation === 'portrait' ? 'landscape' : 'portrait';
    void sendViewerCommand({ type: 'rotate', orientation: screenOrientation }).then(() => {
      get<HTMLElement>('#grix-cloud-phone-wrap').style.setProperty('--device-ratio', screenOrientation === 'portrait' ? '9 / 16' : '16 / 9');
      viewerInputStatus.textContent = 'Android display rotated to ' + screenOrientation + '.';
    }).catch((error) => {
      screenOrientation = screenOrientation === 'portrait' ? 'landscape' : 'portrait';
      viewerInputStatus.textContent = userFacingError(error, 'Rotation failed.');
    });
  });
  get<HTMLButtonElement>('#grix-cloud-action-edit').addEventListener('click', () => {
    viewerTextInput.focus();
    viewerInputStatus.textContent = 'Type into the field below the phone and press Send.';
  });
  get<HTMLButtonElement>('#grix-cloud-action-language').addEventListener('click', () => {
    viewerInputStatus.textContent = 'Android language switching is not exposed by this emulator worker yet.';
  });
  get<HTMLButtonElement>('#grix-cloud-action-night').addEventListener('click', () => {
    nightModeEnabled = !nightModeEnabled;
    void sendViewerCommand({ type: 'night_mode', enabled: nightModeEnabled }).catch((error) => {
      nightModeEnabled = !nightModeEnabled;
      viewerInputStatus.textContent = userFacingError(error, 'Dark mode could not be changed.');
    });
  });
  get<HTMLButtonElement>('#grix-cloud-action-font').addEventListener('click', () => {
    fontScaleIndex = (fontScaleIndex + 1) % fontScales.length;
    void sendViewerCommand({ type: 'font_scale', scale: fontScales[fontScaleIndex] }).then(() => {
      viewerInputStatus.textContent = 'Android text size set to ' + Math.round(fontScales[fontScaleIndex] * 100) + '%.';
    }).catch((error) => {
      fontScaleIndex = (fontScaleIndex + fontScales.length - 1) % fontScales.length;
      viewerInputStatus.textContent = userFacingError(error, 'Text size could not be changed.');
    });
  });
  get<HTMLButtonElement>('#grix-cloud-action-fingerprint').addEventListener('click', () => {
    void sendViewerCommand({ type: 'fingerprint' }).catch((error) => {
      viewerInputStatus.textContent = userFacingError(error, 'Fingerprint simulation failed.');
    });
  });
  get<HTMLButtonElement>('#grix-cloud-action-upload').addEventListener('click', () => {
    get<HTMLInputElement>('#grix-cloud-apk-input').click();
  });
  get<HTMLInputElement>('#grix-cloud-apk-input').addEventListener('change', async (event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      await uploadAndInstallApk(file);
    } catch (error) {
      viewerInputStatus.textContent = userFacingError(error, 'APK installation request failed.');
    }
  });
  get<HTMLButtonElement>('#grix-cloud-action-vibrate').disabled = true;
  get<HTMLButtonElement>('#grix-cloud-action-vibrate').title = 'Vibration hardware is unavailable in this virtual device profile';
  viewerVideo.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' || event.key === 'Backspace') {
      event.preventDefault();
      void sendViewerCommand({ type: 'key', key: 'BACK' }).catch((error) => {
        viewerInputStatus.textContent = userFacingError(error, 'Back command failed.');
      });
    }
  });

  viewerTextForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = viewerTextInput.value.trim();
    if (!text) return;
    void sendViewerCommand({ type: 'text', text }).then(() => {
      viewerTextInput.value = '';
    }).catch((error) => {
      viewerInputStatus.textContent = userFacingError(error, 'Text could not be sent to Android.');
    });
  });

    get<HTMLButtonElement>('#grix-cloud-viewer-close').addEventListener('click', () => { void closeViewer(); });

  get<HTMLButtonElement>('#grix-cloud-signout').addEventListener('click', async () => {
    await closeViewer();
    const current = authSession;
    authSession = null;
    availableTargets = [];
    renderDeviceTargetOptions();
    try { localStorage.removeItem(SESSION_STORAGE_KEY); } catch { /* Ignore unavailable storage. */ }
    setSignedIn(undefined);
    addEmpty(deviceList, 'Sign in to view your cloud devices.');
    addEmpty(requestList, 'Sign in to view your requests.');
    if (current) {
      await fetch(authBase + '/logout', {
        method: 'POST',
        headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + current.access_token },
        cache: 'no-store',
      }).catch(() => undefined);
    }
    setNotice('Signed out. Your cloud device records remain stored in your account.', 'success');
  });

  void (async () => {
    let callbackHandled = false;
    try {
      callbackHandled = await finishGoogleSignInRedirect();
    } catch {
      callbackHandled = true;
      setNotice('Google sign-in could not be completed. Please try again.', 'error');
    }
    if (callbackHandled) return;

    const launchUrl = new URL(window.location.href);
    if (launchUrl.searchParams.get(GOOGLE_SIGNIN_START_PARAM) === '1') {
      launchUrl.searchParams.delete(GOOGLE_SIGNIN_START_PARAM);
      window.history.replaceState({}, document.title, launchUrl.pathname + launchUrl.search + launchUrl.hash);
      void beginGoogleSignIn();
      return;
    }

    const restoredSession = restoreSession();
    if (!restoredSession) {
      setSignedIn(undefined);
      setNotice('');
      return;
    }
    authSession = restoredSession;

    setSignedIn(restoredSession.email);
    setNotice('Restoring your private workspace…');
    try {
      if (restoredSession.expires_at * 1000 - Date.now() < 60_000) {
        if (!(await refreshSession()) || !authSession) throw new Error('Session expired.');
      }
      await loadDeviceOptions();
      await reload();
      window.dispatchEvent(new CustomEvent('grixdroid:workspace-ready'));
      setNotice('Your private workspace is ready.', 'success');
    } catch {
      setNotice('Your session could not be restored. Please sign in again.', 'error');
      authSession = null;
      try { localStorage.removeItem(SESSION_STORAGE_KEY); } catch { /* Ignore unavailable storage. */ }
      setSignedIn(undefined);
    }
  })();
}
