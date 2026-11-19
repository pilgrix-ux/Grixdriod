import './cloud-devices.css';

type AuthSession = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
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
  status: 'queued' | 'claimed' | 'starting' | 'fulfilled' | 'failed' | 'cancelled';
  created_at: string;
  failure_reason?: string | null;
};

type CloudDevice = {
  id: string;
  name: string;
  profile: 'compact' | 'standard';
  android_release: string | null;
  state: 'provisioning' | 'stopped' | 'starting' | 'running' | 'stopping' | 'error' | 'deleting';
  storage_state: 'pending' | 'attached' | 'snapshotting' | 'error';
  storage_bytes: number;
  stream_state: 'disabled' | 'starting' | 'ready' | 'error';
  created_at: string;
};

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
const WHEP_BASE_URL = (import.meta.env.VITE_GRIXDROID_WHEP_BASE_URL || '').replace(/\\/+$/, '');
const configured = Boolean(SUPABASE_URL && SUPABASE_KEY);
const authBase = SUPABASE_URL + '/auth/v1';
const restBase = SUPABASE_URL + '/rest/v1';

export function mountCloudDevicesPanel(app: HTMLElement): void {
  const root = document.createElement('section');
  root.id = 'grixdroid-cloud-devices';
  root.className = 'grix-cloud-panel';
  root.innerHTML = [
    '<div class="grix-cloud-heading">',
    '  <div><div class="grix-cloud-eyebrow">GRIXDROID CLOUD</div><h2>My Android devices</h2>',
    '  <p>Private device records, persistent-storage metadata and cross-device access.</p></div>',
    '  <span class="grix-cloud-status" id="grix-cloud-status">NOT CONFIGURED</span>',
    '</div>',
    '<div class="grix-cloud-notice" id="grix-cloud-notice" role="status"></div>',
    '<div class="grix-cloud-auth" id="grix-cloud-auth">',
    '  <form id="grix-cloud-auth-form" class="grix-cloud-auth-form">',
    '    <label>Email address<input id="grix-cloud-email" type="email" autocomplete="email" required maxlength="254" placeholder="you@example.com"></label>',
    '    <label>Password<input id="grix-cloud-password" type="password" autocomplete="current-password" required minlength="8" maxlength="128" placeholder="At least 8 characters"></label>',
    '    <div class="grix-cloud-auth-actions"><button class="grix-cloud-primary" id="grix-cloud-auth-submit" type="submit">Sign in</button>',
    '    <button class="grix-cloud-link" id="grix-cloud-auth-toggle" type="button">Create an account</button></div>',
    '  </form>',
    '</div>',
    '<div class="grix-cloud-dashboard" id="grix-cloud-dashboard" hidden>',
    '  <div class="grix-cloud-toolbar"><span id="grix-cloud-account"></span><div><button class="grix-cloud-secondary" id="grix-cloud-refresh" type="button">Refresh</button><button class="grix-cloud-secondary" id="grix-cloud-signout" type="button">Sign out</button></div></div>',
    '  <div class="grix-cloud-section-heading"><div><h3>Cloud devices</h3><p>Devices are owned by your account.</p></div></div>',
    '  <div class="grix-cloud-device-list" id="grix-cloud-device-list"><div class="grix-cloud-empty">No cloud devices yet.</div></div>',
    '  <div class="grix-cloud-request-box"><div><h3>Request an Android device</h3><p>This submits a provisioning request. It does not start an emulator by itself.</p></div>',
    '    <form id="grix-cloud-request-form" class="grix-cloud-request-form">',
    '      <label>Device name<input id="grix-cloud-device-name" type="text" required minlength="2" maxlength="40" placeholder="My Android"></label>',
    '      <label>Device profile<select id="grix-cloud-profile"><option value="compact">Compact · lower resource profile</option><option value="standard" selected>Standard · balanced profile</option></select></label>',
    '      <button class="grix-cloud-primary" id="grix-cloud-request-submit" type="submit">Submit request</button>',
    '    </form>',
    '  </div>',
    '  <div class="grix-cloud-section-heading"><div><h3>Provisioning requests</h3><p>Requests stay attached to your account.</p></div></div>',
    '  <div class="grix-cloud-request-list" id="grix-cloud-request-list"><div class="grix-cloud-empty">No requests yet.</div></div>',
    '  <div class="grix-cloud-viewer" id="grix-cloud-viewer" hidden>',
    '    <div class="grix-cloud-viewer-shell">',
    '      <div class="grix-cloud-viewer-toolbar"><strong id="grix-cloud-viewer-title">Android device</strong><button class="grix-cloud-secondary" id="grix-cloud-viewer-close" type="button">Close</button></div>',
    '      <video id="grix-cloud-viewer-video" autoplay playsinline muted></video>',
    '      <p id="grix-cloud-viewer-status" role="status">Connecting to the Android stream…</p>',
    '    </div>',
    '  </div>',
    '</div>',
    '<div class="grix-cloud-footnote">Device requests are handled by a separately installed Android worker. A queued request is not a live Android device. Google Play availability depends on a properly authorized Android image; GRIXDroid does not bundle Google proprietary apps.</div>',
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
  const authForm = get<HTMLFormElement>('#grix-cloud-auth-form');
  const authSubmit = get<HTMLButtonElement>('#grix-cloud-auth-submit');
  const authToggle = get<HTMLButtonElement>('#grix-cloud-auth-toggle');
  const requestForm = get<HTMLFormElement>('#grix-cloud-request-form');
  const requestSubmit = get<HTMLButtonElement>('#grix-cloud-request-submit');
  const deviceList = get<HTMLElement>('#grix-cloud-device-list');
  const requestList = get<HTMLElement>('#grix-cloud-request-list');
  const accountLabel = get<HTMLElement>('#grix-cloud-account');
  const viewer = get<HTMLElement>('#grix-cloud-viewer');
  const viewerTitle = get<HTMLElement>('#grix-cloud-viewer-title');
  const viewerStatus = get<HTMLElement>('#grix-cloud-viewer-status');
  const viewerVideo = get<HTMLVideoElement>('#grix-cloud-viewer-video');

  let viewerPeer: RTCPeerConnection | null = null;
  let viewerResource: string | null = null;
  let viewerToken: string | null = null;
  let authMode: 'signin' | 'signup' = 'signin';
  let authSession: AuthSession | null = null;
  let busy = false;

  function setNotice(message: string, kind: 'info' | 'success' | 'error' = 'info'): void {
    notice.textContent = message;
    notice.className = 'grix-cloud-notice ' + kind;
    notice.hidden = !message;
  }

  function setSignedIn(email: string | undefined): void {
    authPanel.hidden = Boolean(authSession);
    dashboard.hidden = !authSession;
    status.textContent = authSession ? 'ACCOUNT CONNECTED' : configured ? 'SIGN IN REQUIRED' : 'NOT CONFIGURED';
    status.classList.toggle('connected', Boolean(authSession));
    accountLabel.textContent = email ? 'Signed in as ' + email : 'Signed in';
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
    viewer.hidden = false;
    viewerTitle.textContent = device.name;
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

  function acceptSession(payload: AuthResponse): boolean {
    if (!payload.access_token || !payload.refresh_token) return false;
    const lifetime = Math.max(60, Number(payload.expires_in) || 3600);
    authSession = {
      access_token: payload.access_token,
      refresh_token: payload.refresh_token,
      expires_at: Number(payload.expires_at) || Math.floor(Date.now() / 1000) + lifetime,
    };
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
      meta.textContent = (device.android_release || 'Android release not reported') + ' · ' + device.profile + ' profile';
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
            setNotice(error instanceof Error ? error.message : 'Unable to open the Android stream.', 'error');
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
      detail.textContent = item.profile + ' profile · Requested ' + new Date(item.created_at).toLocaleString();
      card.append(top, detail);
      if (item.failure_reason) {
        const reason = document.createElement('p');
        reason.className = 'grix-cloud-error-detail';
        reason.textContent = item.failure_reason;
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
            setNotice('Provisioning request cancelled.', 'success');
          } catch (error) {
            setNotice(error instanceof Error ? error.message : 'Unable to cancel request.', 'error');
            cancel.disabled = false;
          }
        });
        card.append(cancel);
      }
      fragment.append(card);
    }
    requestList.replaceChildren(fragment);
  }

  async function reload(): Promise<void> {
    if (!authSession) return;
    const [devices, requests] = await Promise.all([
      restRequest<CloudDevice[]>('/cloud_devices?select=id,name,profile,android_release,state,storage_state,storage_bytes,stream_state,created_at&order=created_at.desc'),
      restRequest<DeviceRequest[]>('/cloud_device_requests?select=id,name,profile,status,created_at,failure_reason&order=created_at.desc'),
    ]);
    renderDevices(devices);
    renderRequests(requests);
  }

  if (!configured) {
    setSignedIn(undefined);
    setNotice('Cloud account setup is not connected yet. Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to the Vite environment. Never put a service-role key in the browser.', 'info');
    authForm.hidden = true;
    return;
  }

  authForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    const email = get<HTMLInputElement>('#grix-cloud-email').value.trim();
    const password = get<HTMLInputElement>('#grix-cloud-password').value;
    if (password.length < 8) return setNotice('Use a password with at least 8 characters.', 'error');
    busy = true;
    authSubmit.disabled = true;
    setNotice(authMode === 'signup' ? 'Creating your account…' : 'Signing in…');
    try {
      const endpoint = authMode === 'signup' ? '/signup' : '/token?grant_type=password';
      const payload = await authRequest(endpoint, { email, password });
      if (!acceptSession(payload)) {
        if (authMode === 'signup') {
          setNotice('Account created. Check your email for a confirmation link, then sign in.', 'success');
          authMode = 'signin';
          authSubmit.textContent = 'Sign in';
          authToggle.textContent = 'Create an account';
        } else {
          throw new Error(payload.error_description || payload.msg || 'Sign-in did not return a session.');
        }
      } else {
        setSignedIn(payload.user?.email || email);
        setNotice('Account connected. Loading your devices…', 'success');
        await reload();
        setNotice('Your private device workspace is ready. Device provisioning will remain queued until an Android worker is connected.', 'success');
      }
    } catch (error) {
      authSession = null;
      setSignedIn(undefined);
      setNotice(error instanceof Error ? error.message : 'Unable to authenticate.', 'error');
    } finally {
      busy = false;
      authSubmit.disabled = false;
    }
  });

  authToggle.addEventListener('click', () => {
    authMode = authMode === 'signin' ? 'signup' : 'signin';
    authSubmit.textContent = authMode === 'signup' ? 'Create account' : 'Sign in';
    authToggle.textContent = authMode === 'signup' ? 'I already have an account' : 'Create an account';
    get<HTMLInputElement>('#grix-cloud-password').autocomplete = authMode === 'signup' ? 'new-password' : 'current-password';
    setNotice(authMode === 'signup' ? 'Create an account with email and password. Email confirmation may be required.' : 'Sign in to view your private cloud workspace.');
  });

  requestForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!authSession || busy) return;
    const nameInput = get<HTMLInputElement>('#grix-cloud-device-name');
    const name = nameInput.value.trim();
    const profile = get<HTMLSelectElement>('#grix-cloud-profile').value;
    if (name.length < 2 || name.length > 40) return setNotice('Device names must contain 2–40 characters.', 'error');
    busy = true;
    requestSubmit.disabled = true;
    setNotice('Submitting your provisioning request…');
    try {
      await restRequest<DeviceRequest[]>('/cloud_device_requests', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ name, profile }),
      });
      nameInput.value = '';
      await reload();
      setNotice('Request saved to your account. It will remain queued until a compatible Android worker accepts it.', 'success');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Unable to submit the provisioning request.', 'error');
    } finally {
      busy = false;
      requestSubmit.disabled = false;
    }
  });

  get<HTMLButtonElement>('#grix-cloud-refresh').addEventListener('click', async () => {
    try {
      await reload();
      setNotice('Device information refreshed.', 'success');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Unable to refresh devices.', 'error');
    }
  });

  get<HTMLButtonElement>('#grix-cloud-viewer-close').addEventListener('click', () => { void closeViewer(); });

  get<HTMLButtonElement>('#grix-cloud-signout').addEventListener('click', async () => {
    await closeViewer();
    const current = authSession;
    authSession = null;
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

  setSignedIn(undefined);
  setNotice('Sign in to view the private cloud devices attached to your account.');
}
