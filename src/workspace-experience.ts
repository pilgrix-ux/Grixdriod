import './workspace-experience.css';
import './workspace-polish.css';

type StoredSession = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user_id: string;
  email?: string;
};

type StoredApk = {
  name: string;
  id?: string | null;
  created_at?: string;
  updated_at?: string;
  metadata?: { size?: number; mimetype?: string };
};

type AppEntry = {
  path: string;
  filename: string;
  name: string;
  size: number;
  updatedAt?: string;
};

type ReadyDevice = {
  id: string;
  name: string;
  state: string;
  stream_state: string;
};

const PROJECT_URL = (import.meta.env.VITE_SUPABASE_URL || 'https://olbqxgnhozafcckcoapx.supabase.co').replace(/\/+$/, '');
const PUBLISHABLE_KEY = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_2SBpc33fTryZKwaSc6pl2w_yDZBJ22U').trim();
const SESSION_KEY = 'grixdroid.auth.session.v1';
const APP_GROUPS_KEY = 'grixdroid.app-groups.v1';
const APP_ASSIGNMENTS_KEY = 'grixdroid.app-assignments.v1';

function readSession(): StoredSession {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) throw new Error('Please sign in again to open your workspace.');
  const session = JSON.parse(raw) as Partial<StoredSession>;
  if (
    typeof session.access_token !== 'string' ||
    typeof session.refresh_token !== 'string' ||
    typeof session.expires_at !== 'number' ||
    typeof session.user_id !== 'string'
  ) {
    throw new Error('Your sign-in session is no longer valid. Please sign in again.');
  }
  return session as StoredSession;
}

async function accessToken(): Promise<string> {
  const session = readSession();
  if (session.expires_at * 1000 - Date.now() > 60_000) return session.access_token;

  const response = await fetch(PROJECT_URL + '/auth/v1/token?grant_type=refresh_token', {
    method: 'POST',
    headers: { apikey: PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: session.refresh_token }),
    cache: 'no-store',
  });
  const payload = await response.json().catch(() => ({})) as {
    access_token?: string; refresh_token?: string; expires_at?: number; expires_in?: number;
  };
  if (!response.ok || !payload.access_token || !payload.refresh_token) {
    localStorage.removeItem(SESSION_KEY);
    throw new Error('Your sign-in session expired. Please sign in again.');
  }

  const updated: StoredSession = {
    ...session,
    access_token: payload.access_token,
    refresh_token: payload.refresh_token,
    expires_at: Number(payload.expires_at) || Math.floor(Date.now() / 1000) + (Number(payload.expires_in) || 3600),
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(updated));
  return updated.access_token;
}

async function authenticatedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await accessToken();
  const headers = new Headers(init.headers);
  headers.set('apikey', PUBLISHABLE_KEY);
  headers.set('Authorization', 'Bearer ' + token);
  if (init.body && !(init.body instanceof Blob) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return fetch(PROJECT_URL + path, { ...init, headers, cache: 'no-store' });
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await authenticatedFetch('/rest/v1' + path, init);
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = payload && typeof payload === 'object'
      ? String((payload as { message?: string; details?: string }).message || (payload as { details?: string }).details || '')
      : '';
    throw new Error(detail || 'The workspace request could not be completed.');
  }
  return payload as T;
}

function escapePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

function create<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return 'APK file';
  if (value < 1024 * 1024) return Math.round(value / 1024) + ' KB';
  return (value / (1024 * 1024)).toFixed(1) + ' MB';
}

function formatDate(value?: string): string {
  if (!value) return 'Date unavailable';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date unavailable';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function showFeedback(target: HTMLElement, message: string, kind: 'info' | 'success' | 'error' = 'info'): void {
  target.textContent = message;
  target.dataset.kind = kind;
  target.hidden = false;
}

export function mountWorkspaceExperience(): void {
  const root = document.querySelector<HTMLElement>('#grixdroid-cloud-devices');
  const dashboard = root?.querySelector<HTMLElement>('#grix-cloud-dashboard');
  if (!root || !dashboard) return;

  const toolbar = dashboard.querySelector<HTMLElement>('.grix-cloud-toolbar');
  const account = toolbar?.querySelector<HTMLElement>('#grix-cloud-account');
  const signOut = toolbar?.querySelector<HTMLButtonElement>('#grix-cloud-signout');
  const refresh = toolbar?.querySelector<HTMLButtonElement>('#grix-cloud-refresh');
  const sectionHeadings = dashboard.querySelectorAll<HTMLElement>('.grix-cloud-section-heading');
  const deviceHeading = sectionHeadings[0];
  const requestHeading = sectionHeadings[1];
  const deviceList = dashboard.querySelector<HTMLElement>('#grix-cloud-device-list');
  const requestBox = dashboard.querySelector<HTMLElement>('.grix-cloud-request-box');
  const requestList = dashboard.querySelector<HTMLElement>('#grix-cloud-request-list');
  const viewer = dashboard.querySelector<HTMLElement>('#grix-cloud-viewer');

  if (!deviceHeading || !requestHeading || !deviceList || !requestBox || !requestList || !viewer) return;

  const shell = create('div', 'grix-workspace-shell');
  shell.innerHTML = [
    '<aside class="grix-workspace-sidebar" aria-label="Workspace navigation">',
    '  <div class="grix-workspace-side-brand"><span class="grix-workspace-mark">G</span><span><strong>Grixdriod</strong><small>ANDROID WORKSPACE</small></span></div>',
    '  <div class="grix-workspace-side-label">WORKSPACE</div>',
    '  <nav class="grix-workspace-nav">',
    '    <button class="grix-workspace-nav-item active" type="button" data-page="apps"><span class="grix-workspace-nav-icon">▦</span><span>Apps</span></button>',
    '    <button class="grix-workspace-nav-item" type="button" data-page="sandbox"><span class="grix-workspace-nav-icon">▣</span><span>Device Sandbox</span></button>',
    '    <button class="grix-workspace-nav-item" type="button" data-page="sessions"><span class="grix-workspace-nav-icon">◷</span><span>Session History</span></button>',
    '  </nav>',
    '  <div class="grix-workspace-side-note"><span class="grix-workspace-side-dot"></span><span>Private workspace</span></div>',
    '</aside>',
    '<main class="grix-workspace-main">',
    '  <header class="grix-workspace-topbar">',
    '    <div><span class="grix-workspace-breadcrumb">GRIXDRIOD <i>/</i> WORKSPACE</span><h1 id="grix-workspace-page-title">Apps</h1></div>',
    '    <div class="grix-workspace-account" id="grix-workspace-account"></div>',
    '  </header>',
    '  <div class="grix-workspace-pages">',
    '    <section class="grix-workspace-page" data-page-panel="apps">',
    '      <div class="grix-workspace-page-intro"><div><h2>Your apps</h2><p>Keep your Android builds together and install them on a test device.</p></div><div class="grix-workspace-actions"><button class="grix-workspace-button secondary" id="grix-app-add-group" type="button">＋ New group</button><button class="grix-workspace-button primary" id="grix-app-upload" type="button">↑ Upload APK</button></div></div>',
    '      <div class="grix-app-group-form" id="grix-app-group-form" hidden><form id="grix-app-group-create"><label for="grix-app-group-name">Group name</label><input id="grix-app-group-name" maxlength="32" placeholder="e.g. Releases" required><button class="grix-workspace-button primary" type="submit">Create group</button><button class="grix-workspace-button text" id="grix-app-group-cancel" type="button">Cancel</button></form></div>',
    '      <div class="grix-app-library-tools"><label class="grix-app-search"><span>⌕</span><input id="grix-app-search" type="search" placeholder="Search your apps"></label><label class="grix-app-install-target"><span>Install to</span><select id="grix-app-target"><option value="">Finding ready devices…</option></select></label></div>',
    '      <div class="grix-app-group-filters" id="grix-app-group-filters"></div>',
    '      <div class="grix-app-feedback" id="grix-app-feedback" role="status" hidden></div>',
    '      <div class="grix-app-grid" id="grix-app-grid"><div class="grix-workspace-empty"><span class="grix-workspace-empty-icon">▧</span><strong>Your app library is empty</strong><p>Upload an APK to add your first Android app.</p></div></div>',
    '      <input id="grix-app-file-input" type="file" accept=".apk,application/vnd.android.package-archive" multiple hidden>',
    '      <p class="grix-workspace-footnote">APK files are private to your account. Groups are saved in this browser. Maximum APK size: 50 MB.</p>',
    '    </section>',
    '    <section class="grix-workspace-page" data-page-panel="sandbox" hidden>',
    '      <div class="grix-workspace-page-intro"><div><h2>Device Sandbox</h2><p>Request an Android device, then open its screen when it is ready.</p></div></div>',
    '      <div class="grix-workspace-device-section" id="grix-workspace-device-section"></div>',
    '      <div class="grix-workspace-request-section" id="grix-workspace-request-section"></div>',
    '      <div class="grix-workspace-requests-section" id="grix-workspace-requests-section"></div>',
    '      <p class="grix-workspace-footnote">A request enters the setup queue. A live device is available only when a compatible worker and stream are online.</p>',
    '    </section>',
    '    <section class="grix-workspace-page" data-page-panel="sessions" hidden>',
    '      <div class="grix-workspace-page-intro"><div><h2>Session History</h2><p>Review Android sessions recorded for your account.</p></div><button class="grix-workspace-button secondary" id="grix-session-reload" type="button">Reload history</button></div>',
    '      <div class="grix-session-feedback" id="grix-session-feedback" role="status" hidden></div>',
    '      <div class="grix-session-list" id="grix-session-list"><div class="grix-workspace-empty"><span class="grix-workspace-empty-icon">◷</span><strong>No sessions recorded yet</strong><p>When a device session is recorded, it will appear here.</p></div></div>',
    '    </section>',
    '  </div>',
    '</main>',
    '</div>',
  ].join('');

  const accountSlot = shell.querySelector<HTMLElement>('#grix-workspace-account');
  if (account && accountSlot) accountSlot.append(account);
  if (signOut && accountSlot) accountSlot.append(signOut);
  refresh?.remove();
  toolbar?.remove();
  const sandboxIntro = shell.querySelector<HTMLElement>('[data-page-panel="sandbox"] .grix-workspace-page-intro');
  if (refresh && sandboxIntro) {
    refresh.className = 'grix-workspace-button secondary';
    refresh.textContent = 'Refresh devices';
    refresh.setAttribute('aria-label', 'Refresh devices and Android version/model availability');
    sandboxIntro.append(refresh);
  }

  const deviceSection = shell.querySelector<HTMLElement>('#grix-workspace-device-section');
  const requestSection = shell.querySelector<HTMLElement>('#grix-workspace-request-section');
  const requestsSection = shell.querySelector<HTMLElement>('#grix-workspace-requests-section');
  deviceHeading.querySelector('h3')!.textContent = 'Your Android devices';
  deviceHeading.querySelector('p')!.textContent = 'Open a device to test your app when the live screen is ready.';
  requestHeading.querySelector('h3')!.textContent = 'Recent requests';
  requestHeading.querySelector('p')!.textContent = 'See the progress of devices you have requested.';
  const requestTitle = requestBox.querySelector('h3');
  const requestCopy = requestBox.querySelector('p');
  if (requestTitle) requestTitle.textContent = 'Create a device';
  if (requestCopy) requestCopy.textContent = 'Choose a name, performance profile, Android version and Pixel model. This creates a new device and leaves your existing devices unchanged.';
  const requestSubmit = requestBox.querySelector<HTMLButtonElement>('#grix-cloud-request-submit');
  if (requestSubmit) requestSubmit.textContent = 'Request device';
  const profileSelect = requestBox.querySelector<HTMLSelectElement>('#grix-cloud-profile');
  if (profileSelect) {
    profileSelect.innerHTML = '<option value="compact">Lightweight</option><option value="standard" selected>Balanced</option>';
  }
  deviceSection?.append(deviceHeading, deviceList);
  requestSection?.append(requestBox);
  requestsSection?.append(requestHeading, requestList);
  dashboard.replaceChildren(shell);
  if (deviceSection) deviceSection.append(viewer);

  // Appetize-style device workspace: keep the real device inventory, request
  // queue and live viewer, but arrange them around a focused device stage.
  const sandboxPage = shell.querySelector<HTMLElement>('[data-page-panel="sandbox"]');
  if (sandboxPage && deviceSection && requestSection && requestsSection) {
    const sandboxLayout = create('div', 'grix-appetize-layout');
    const stage = create('section', 'grix-appetize-stage');
    const stageHeader = create('div', 'grix-appetize-stage-header');
    const stageTitle = create('div', 'grix-appetize-stage-title');
    stageTitle.append(
      create('strong', '', 'Android device'),
      create('span', '', 'Choose a ready device to open its live screen')
    );
    const stageStatus = create('span', 'grix-appetize-status', 'Waiting for device');
    stageHeader.append(stageTitle, stageStatus);
    const preview = create('div', 'grix-appetize-preview');
    preview.innerHTML = '<div class="grix-appetize-phone"><div class="grix-appetize-phone-screen"><span class="grix-appetize-camera"></span><span class="grix-appetize-android-mark">G</span><strong>GRIXDroid</strong><small>Your Android session appears here</small><span class="grix-appetize-preview-note">Live preview starts when a device stream is ready</span></div></div>';
    const deviceInventory = create('div', 'grix-appetize-inventory');
    deviceInventory.append(deviceSection);
    stage.append(stageHeader, preview, deviceInventory);
    const inspector = create('aside', 'grix-appetize-inspector');
    const inspectorHeading = create('div', 'grix-appetize-inspector-heading');
    inspectorHeading.append(create('strong', '', 'Session tools'), create('span', '', 'DEVICE SETUP'));
    inspector.append(inspectorHeading, requestSection);
    const activity = create('section', 'grix-appetize-activity');
    activity.append(requestsSection);
    sandboxLayout.append(stage, inspector, activity);
    const footnote = sandboxPage.querySelector<HTMLElement>('.grix-workspace-footnote');
    sandboxPage.insertBefore(sandboxLayout, footnote || null);
  }

  const brandHeader = root.querySelector<HTMLElement>('.grix-cloud-heading');
  const syncBrandVisibility = () => {
    if (brandHeader) brandHeader.hidden = !dashboard.hidden;
  };
  syncBrandVisibility();
  new MutationObserver(syncBrandVisibility).observe(dashboard, { attributes: true, attributeFilter: ['hidden'] });

  const pageTitle = shell.querySelector<HTMLElement>('#grix-workspace-page-title');
  const pages = [...shell.querySelectorAll<HTMLElement>('[data-page-panel]')];
  const navButtons = [...shell.querySelectorAll<HTMLButtonElement>('[data-page]')];
  const appsGrid = shell.querySelector<HTMLElement>('#grix-app-grid')!;
  const appFeedback = shell.querySelector<HTMLElement>('#grix-app-feedback')!;
  const groupFilters = shell.querySelector<HTMLElement>('#grix-app-group-filters')!;
  const appSearch = shell.querySelector<HTMLInputElement>('#grix-app-search')!;
  const groupForm = shell.querySelector<HTMLElement>('#grix-app-group-form')!;
  const groupNameInput = shell.querySelector<HTMLInputElement>('#grix-app-group-name')!;
  const appTarget = shell.querySelector<HTMLSelectElement>('#grix-app-target')!;
  const sessionList = shell.querySelector<HTMLElement>('#grix-session-list')!;
  const sessionFeedback = shell.querySelector<HTMLElement>('#grix-session-feedback')!;
  const fileInput = shell.querySelector<HTMLInputElement>('#grix-app-file-input')!;

  let activePage = 'apps';
  let apps: AppEntry[] = [];
  let groups: string[] = [];
  let assignments: Record<string, string> = {};
  let activeGroup = 'all';
  let readyDevices: ReadyDevice[] = [];
  let loadingApps = false;
  let installingPath: string | null = null;

  function loadLocalOrganization(): void {
    const userId = readSession().user_id;
    try {
      const allGroups = JSON.parse(localStorage.getItem(APP_GROUPS_KEY) || '{}') as Record<string, string[]>;
      const allAssignments = JSON.parse(localStorage.getItem(APP_ASSIGNMENTS_KEY) || '{}') as Record<string, Record<string, string>>;
      groups = Array.isArray(allGroups[userId]) ? allGroups[userId] : [];
      assignments = allAssignments[userId] && typeof allAssignments[userId] === 'object' ? allAssignments[userId] : {};
    } catch {
      groups = [];
      assignments = {};
    }
  }

  function saveLocalOrganization(): void {
    const userId = readSession().user_id;
    try {
      const allGroups = JSON.parse(localStorage.getItem(APP_GROUPS_KEY) || '{}') as Record<string, string[]>;
      const allAssignments = JSON.parse(localStorage.getItem(APP_ASSIGNMENTS_KEY) || '{}') as Record<string, Record<string, string>>;
      allGroups[userId] = groups;
      allAssignments[userId] = assignments;
      localStorage.setItem(APP_GROUPS_KEY, JSON.stringify(allGroups));
      localStorage.setItem(APP_ASSIGNMENTS_KEY, JSON.stringify(allAssignments));
    } catch {
      showFeedback(appFeedback, 'Your browser could not save app groups on this device.', 'error');
    }
  }

  function renderGroupFilters(): void {
    groupFilters.replaceChildren();
    const options = [{ name: 'All apps', value: 'all' }, { name: 'Ungrouped', value: 'ungrouped' }, ...groups.map((name) => ({ name, value: name }))];
    for (const item of options) {
      const button = create('button', 'grix-app-filter' + (activeGroup === item.value ? ' active' : ''), item.name);
      button.type = 'button';
      button.addEventListener('click', () => {
        activeGroup = item.value;
        renderGroupFilters();
        renderApps();
      });
      groupFilters.append(button);
    }
  }

  function displayName(filename: string): string {
    return filename.replace(/^[0-9a-f-]{36}_/i, '');
  }

  function renderApps(): void {
    const query = appSearch.value.trim().toLowerCase();
    const visible = apps.filter((app) => {
      const group = assignments[app.path] || '';
      const matchesGroup = activeGroup === 'all'
        || (activeGroup === 'ungrouped' && !group)
        || group === activeGroup;
      return matchesGroup && (!query || app.name.toLowerCase().includes(query));
    });
    appsGrid.replaceChildren();

    if (!apps.length) {
      const empty = create('div', 'grix-workspace-empty');
      empty.innerHTML = '<span class="grix-workspace-empty-icon">▧</span><strong>Your app library is empty</strong><p>Upload an APK to add your first Android app.</p><button class="grix-workspace-button primary" type="button">Upload an APK</button>';
      empty.querySelector('button')?.addEventListener('click', () => fileInput.click());
      appsGrid.append(empty);
      return;
    }
    if (!visible.length) {
      appsGrid.append(create('div', 'grix-workspace-empty', 'No apps match this search or group.'));
      return;
    }

    for (const app of visible) {
      const card = create('article', 'grix-app-card');
      const appIcon = create('div', 'grix-app-icon', 'A');
      const information = create('div', 'grix-app-information');
      information.append(create('strong', 'grix-app-name', app.name), create('span', 'grix-app-meta', formatBytes(app.size)));
      const top = create('div', 'grix-app-card-top');
      top.append(appIcon, information);
      const actionRow = create('div', 'grix-app-card-actions');
      const groupSelect = create('select', 'grix-app-card-group') as HTMLSelectElement;
      groupSelect.setAttribute('aria-label', 'Choose group for ' + app.name);
      const ungrouped = create('option', '', 'Ungrouped') as HTMLOptionElement;
      ungrouped.value = '';
      groupSelect.append(ungrouped);
      for (const group of groups) {
        const option = create('option', '', group) as HTMLOptionElement;
        option.value = group;
        groupSelect.append(option);
      }
      groupSelect.value = assignments[app.path] || '';
      groupSelect.addEventListener('change', () => {
        if (groupSelect.value) assignments[app.path] = groupSelect.value;
        else delete assignments[app.path];
        saveLocalOrganization();
        renderGroupFilters();
      });

      const install = create('button', 'grix-workspace-button primary', installingPath === app.path ? 'Installing…' : 'Install');
      install.type = 'button';
      install.disabled = !appTarget.value || installingPath !== null;
      install.addEventListener('click', () => { void installApp(app); });
      actionRow.append(groupSelect, install);
      card.append(top, actionRow);
      appsGrid.append(card);
    }
  }

  async function listApps(): Promise<AppEntry[]> {
    const userId = readSession().user_id;
    const prefix = userId + '/apps/';
    const response = await authenticatedFetch('/storage/v1/object/list/grixdroid-apks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix, limit: 100, offset: 0, sortBy: { column: 'created_at', order: 'desc' } }),
    });
    const payload = await response.json().catch(() => []);
    if (!response.ok) throw new Error('Your private APK library could not be loaded.');
    return (Array.isArray(payload) ? payload as StoredApk[] : [])
      .filter((item) => typeof item.name === 'string' && item.name.toLowerCase().endsWith('.apk'))
      .map((item) => {
        const name = item.name.startsWith(prefix) ? item.name.slice(prefix.length) : item.name;
        const path = item.name.startsWith(userId + '/') ? item.name : prefix + name;
        return {
          path,
          filename: name,
          name: displayName(name),
          size: Number(item.metadata?.size) || 0,
          updatedAt: item.updated_at || item.created_at,
        };
      });
  }

  async function loadApps(): Promise<void> {
    if (loadingApps) return;
    loadingApps = true;
    showFeedback(appFeedback, 'Loading your app library…');
    try {
      apps = await listApps();
      renderGroupFilters();
      renderApps();
      appFeedback.hidden = true;
    } catch (error) {
      showFeedback(appFeedback, error instanceof Error ? error.message : 'Unable to load your apps.', 'error');
    } finally {
      loadingApps = false;
    }
  }

  async function loadReadyDevices(): Promise<void> {
    appTarget.replaceChildren();
    const placeholder = create('option') as HTMLOptionElement;
    placeholder.value = '';
    placeholder.textContent = 'Checking devices…';
    appTarget.append(placeholder);
    try {
      readyDevices = await api<ReadyDevice[]>('/cloud_devices?select=id,name,state,stream_state&order=created_at.desc');
      readyDevices = readyDevices.filter((device) => device.state === 'running' && device.stream_state === 'ready');
      appTarget.replaceChildren();
      const option = create('option') as HTMLOptionElement;
      option.value = '';
      option.textContent = readyDevices.length ? 'Choose a ready Android device' : 'No ready device available';
      appTarget.append(option);
      for (const device of readyDevices) {
        const deviceOption = create('option') as HTMLOptionElement;
        deviceOption.value = device.id;
        deviceOption.textContent = device.name;
        appTarget.append(deviceOption);
      }
      renderApps();
    } catch {
      appTarget.replaceChildren();
      const option = create('option') as HTMLOptionElement;
      option.value = '';
      option.textContent = 'Devices are unavailable';
      appTarget.append(option);
      readyDevices = [];
      renderApps();
    }
  }

  async function installApp(app: AppEntry): Promise<void> {
    const device = readyDevices.find((item) => item.id === appTarget.value);
    if (!device) {
      showFeedback(appFeedback, 'Choose a ready Android device first.', 'error');
      return;
    }
    installingPath = app.path;
    showFeedback(appFeedback, 'Preparing ' + app.name + ' for ' + device.name + '…');
    renderApps();
    try {
      const source = await authenticatedFetch('/storage/v1/object/authenticated/grixdroid-apks/' + escapePath(app.path));
      if (!source.ok) throw new Error('The APK could not be downloaded from your private library.');
      const file = await source.blob();
      const targetPath = readSession().user_id + '/' + device.id + '/' + crypto.randomUUID() + '.apk';
      const uploaded = await authenticatedFetch('/storage/v1/object/grixdroid-apks/' + escapePath(targetPath), {
        method: 'POST',
        headers: { 'Content-Type': 'application/vnd.android.package-archive', 'x-upsert': 'false' },
        body: file,
      });
      if (!uploaded.ok) throw new Error('The APK could not be prepared for this device.');

      const actions = await api<Array<{ id: string }>>('/cloud_device_actions', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          device_id: device.id,
          command: { type: 'install_apk', object_path: targetPath, filename: app.filename },
        }),
      });
      const actionId = actions?.[0]?.id;
      if (!actionId) throw new Error('The install request could not be added to the device queue.');
      showFeedback(appFeedback, 'Installing ' + app.name + ' on ' + device.name + '…');
      const deadline = Date.now() + 180_000;
      while (Date.now() < deadline) {
        const rows = await api<Array<{ status: string; failure_reason: string | null }>>(
          '/cloud_device_actions?id=eq.' + encodeURIComponent(actionId) + '&select=status,failure_reason',
        );
        const action = rows[0];
        if (action?.status === 'completed') {
          showFeedback(appFeedback, app.name + ' was installed successfully.', 'success');
          return;
        }
        if (action?.status === 'failed') {
          throw new Error(action.failure_reason || 'Android could not install this APK.');
        }
        await new Promise((resolve) => window.setTimeout(resolve, 1400));
      }
      showFeedback(appFeedback, 'The APK was sent to the device. Installation is still processing; check the device again shortly.');
    } catch (error) {
      showFeedback(appFeedback, error instanceof Error ? error.message : 'The app could not be installed.', 'error');
    } finally {
      installingPath = null;
      renderApps();
    }
  }

  async function uploadApps(files: FileList | null): Promise<void> {
    if (!files?.length) return;
    const filesToUpload = [...files];
    let completed = 0;
    let failed = 0;
    for (const file of filesToUpload) {
      if (!file.name.toLowerCase().endsWith('.apk')) {
        failed += 1;
        showFeedback(appFeedback, file.name + ' is not an APK file.', 'error');
        continue;
      }
      if (file.size <= 0 || file.size > 50 * 1024 * 1024) {
        failed += 1;
        showFeedback(appFeedback, file.name + ' must be between 1 byte and 50 MB.', 'error');
        continue;
      }
      const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, '-').slice(-100);
      const objectPath = readSession().user_id + '/apps/' + crypto.randomUUID() + '_' + safeName;
      showFeedback(appFeedback, 'Uploading ' + file.name + '…');
      try {
        const response = await authenticatedFetch('/storage/v1/object/grixdroid-apks/' + escapePath(objectPath), {
          method: 'POST',
          headers: { 'Content-Type': 'application/vnd.android.package-archive', 'x-upsert': 'false' },
          body: file,
        });
        if (!response.ok) {
          const detail = await response.json().catch(() => null) as { message?: string } | null;
          throw new Error(detail?.message || file.name + ' could not be uploaded.');
        }
        completed += 1;
      } catch (error) {
        failed += 1;
        showFeedback(appFeedback, error instanceof Error ? error.message : file.name + ' could not be uploaded.', 'error');
      }
    }
    fileInput.value = '';
    await loadApps();
    if (completed && failed) showFeedback(appFeedback, completed + ' app(s) added. ' + failed + ' file(s) could not be uploaded.', 'info');
    else if (completed) showFeedback(appFeedback, completed + (completed === 1 ? ' app was' : ' apps were') + ' added to your library.', 'success');
    else if (failed) showFeedback(appFeedback, 'No apps were added. Check the file types and try again.', 'error');
  }

  async function loadSessions(): Promise<void> {
    showFeedback(sessionFeedback, 'Loading session history…');
    try {
      const [sessions, devices] = await Promise.all([
        api<Array<{ id: string; device_id: string; state: string; started_at: string; expires_at: string | null; last_seen_at: string | null }>>(
          '/cloud_device_sessions?select=id,device_id,state,started_at,expires_at,last_seen_at&order=started_at.desc&limit=100',
        ),
        api<Array<{ id: string; name: string }>>('/cloud_devices?select=id,name'),
      ]);
      const names = new Map(devices.map((device) => [device.id, device.name]));
      sessionList.replaceChildren();
      if (!sessions.length) {
        const empty = create('div', 'grix-workspace-empty');
        empty.innerHTML = '<span class="grix-workspace-empty-icon">◷</span><strong>No sessions recorded yet</strong><p>When a device session is recorded for your account, it will appear here.</p>';
        sessionList.append(empty);
      } else {
        for (const session of sessions) {
          const card = create('article', 'grix-session-card');
          const heading = create('div', 'grix-session-card-head');
          heading.append(create('strong', '', names.get(session.device_id) || 'Android device'));
          const state = create('span', 'grix-session-state state-' + session.state, session.state.replace(/_/g, ' '));
          heading.append(state);
          const detail = create('div', 'grix-session-card-detail');
          detail.append(create('span', '', 'Started ' + formatDate(session.started_at)));
          detail.append(create('span', '', 'Last active ' + formatDate(session.last_seen_at || session.started_at)));
          card.append(heading, detail);
          sessionList.append(card);
        }
      }
      sessionFeedback.hidden = true;
    } catch (error) {
      showFeedback(sessionFeedback, error instanceof Error ? error.message : 'Session history could not be loaded.', 'error');
    }
  }

  function switchPage(page: string): void {
    activePage = page;
    for (const item of navButtons) {
      const selected = item.dataset.page === page;
      item.classList.toggle('active', selected);
      item.setAttribute('aria-current', selected ? 'page' : 'false');
    }
    for (const panel of pages) panel.hidden = panel.dataset.pagePanel !== page;
    const titles: Record<string, string> = { apps: 'Apps', sandbox: 'Device Sandbox', sessions: 'Session History' };
    if (pageTitle) pageTitle.textContent = titles[page] || 'Workspace';
    if (dashboard?.hidden === false && page === 'apps') {
      void loadApps();
      void loadReadyDevices();
    } else if (dashboard?.hidden === false && page === 'sessions') {
      void loadSessions();
    }
  }

  window.addEventListener('grixdroid:workspace-ready', () => {
    if (activePage === 'apps') {
      void loadApps();
      void loadReadyDevices();
    } else if (activePage === 'sessions') {
      void loadSessions();
    }
  });

  navButtons.forEach((button) => button.addEventListener('click', () => switchPage(button.dataset.page || 'apps')));
  shell.querySelector<HTMLButtonElement>('#grix-app-upload')?.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => { void uploadApps(fileInput.files); });
  appSearch.addEventListener('input', renderApps);
  appTarget.addEventListener('change', renderApps);

  shell.querySelector<HTMLButtonElement>('#grix-app-add-group')?.addEventListener('click', () => {
    groupForm.hidden = !groupForm.hidden;
    if (!groupForm.hidden) groupNameInput.focus();
  });
  shell.querySelector<HTMLButtonElement>('#grix-app-group-cancel')?.addEventListener('click', () => {
    groupForm.hidden = true;
    groupNameInput.value = '';
  });
  shell.querySelector<HTMLFormElement>('#grix-app-group-create')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = groupNameInput.value.trim().replace(/\s+/g, ' ');
    if (!name) return;
    if (groups.some((group) => group.toLowerCase() === name.toLowerCase())) {
      showFeedback(appFeedback, 'That group already exists.', 'error');
      return;
    }
    groups.push(name);
    saveLocalOrganization();
    activeGroup = name;
    groupNameInput.value = '';
    groupForm.hidden = true;
    renderGroupFilters();
    renderApps();
    showFeedback(appFeedback, 'Group created.', 'success');
  });
  shell.querySelector<HTMLButtonElement>('#grix-session-reload')?.addEventListener('click', () => { void loadSessions(); });

  // Add an unobtrusive preview-size selector to the existing live device settings.
  const viewerSettings = root.querySelector<HTMLElement>('#grix-cloud-session-settings');
  const phoneWrap = root.querySelector<HTMLElement>('#grix-cloud-phone-wrap');
  if (viewerSettings && phoneWrap && !root.querySelector('#grix-workspace-preview-size')) {
    const sizeRow = create('div', 'grix-appetize-setting-row grix-workspace-size-row');
    const copy = create('div');
    copy.append(create('strong', '', 'Preview size'), create('small', '', 'Adjust the phone display to fit your screen'));
    const sizeSelect = create('select', 'grix-workspace-size-select') as HTMLSelectElement;
    sizeSelect.id = 'grix-workspace-preview-size';
    for (const [value, label] of [['1', 'Auto'], ['0.85', '85%'], ['0.7', '70%'], ['0.55', '55%']]) {
      const option = create('option') as HTMLOptionElement;
      option.value = value;
      option.textContent = label;
      sizeSelect.append(option);
    }
    sizeSelect.addEventListener('change', () => phoneWrap.style.setProperty('--device-scale', sizeSelect.value));
    sizeRow.append(copy, sizeSelect);
    viewerSettings.append(sizeRow);
    new MutationObserver(() => {
      if (!viewer.hidden) phoneWrap.style.setProperty('--device-scale', sizeSelect.value);
    }).observe(viewer, { attributes: true, attributeFilter: ['hidden'] });
  }

  loadLocalOrganization();
  renderGroupFilters();
  switchPage('apps');
}
