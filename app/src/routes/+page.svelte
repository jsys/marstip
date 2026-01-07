<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';

  const isTauri = () => '__TAURI_INTERNALS__' in window;

  // TEST MODE: mettre à true pour simuler différents scénarios
  const TEST_NO_DEVICE = false;      // Simule aucun device trouvé
  const TEST_CONNECTION_ERROR = false; // Simule erreur de connexion après discovery

  interface DiscoveredDevice {
    ip: string;
    port: number;
    device?: string;
    ver?: number;
  }

  interface DashboardData {
    device: {
      device?: string;
      ver?: number;
      ip?: string;
    };
    battery: {
      soc?: number;
      charg_flag?: boolean;
      dischrg_flag?: boolean;
      bat_temp?: number;
      bat_capacity?: number;
      rated_capacity?: number;
    };
    energy: {
      bat_soc?: number;
      ongrid_power?: number;
      total_grid_output_energy?: number;
      total_grid_input_energy?: number;
    };
    mode: {
      mode?: string;
    };
    meter: {
      ct_state?: number;
      a_power?: number;
      b_power?: number;
      c_power?: number;
      total_power?: number;
    };
    wifi: {
      ssid?: string;
      rssi?: number;
    };
    timestamp: string;
  }

  let data: DashboardData | null = $state(null);
  let error: string | null = $state(null);
  let loading = $state(true);
  let interval: ReturnType<typeof setInterval>;

  // Derived values
  let soc = $derived((data as DashboardData | null)?.battery?.soc ?? (data as DashboardData | null)?.energy?.bat_soc ?? 0);
  let isCharging = $derived(((data as DashboardData | null)?.energy?.ongrid_power ?? 0) < 0);
  let isDischarging = $derived(((data as DashboardData | null)?.energy?.ongrid_power ?? 0) > 0);
  let socColor = $derived(soc < 20 ? 'bg-red-500' : soc < 50 ? 'bg-yellow-500' : 'bg-green-500');

  // Auto-discovery states
  let discovering = $state(true);
  let deviceConfigured = $state(false);
  let discoveryError = $state<string | null>(null);
  let manualIp = $state('');
  let manualPort = $state('30000');
  let foundDevice: DiscoveredDevice | null = $state(null);
  let allDevices: DiscoveredDevice[] = $state([]);
  let showDeviceSelector = $state(false);
  let connecting = $state(false);
  let fetching = $state(false);
  let lastResponseTime = $state(0);
  let currentInterval = $state(3000);

  // Mode change states
  let showModeModal = $state(false);
  let pendingMode = $state<string | null>(null);
  let changingMode = $state(false);
  let modeError = $state<string | null>(null);

  // Manual mode config
  let manualConfig = $state({
    time_num: 0,
    start_time: '22:00',
    end_time: '06:00',
    week_set: 127, // Tous les jours
    power: 800,
    isCharge: true, // true = charge (power négatif envoyé), false = décharge
    enable: 1
  });

  // Passive mode config
  let passiveConfig = $state({
    power: 800,
    isCharge: false, // true = charge, false = décharge
    cd_time: 300
  });

  // Saved configs in localStorage
  let hasSavedManualConfig = $state(false);
  let hasSavedPassiveConfig = $state(false);

  // Storage keys
  const STORAGE_KEY_MANUAL = 'marstip_manual_config';
  const STORAGE_KEY_PASSIVE = 'marstip_passive_config';

  function loadSavedConfigs() {
    try {
      const savedManual = localStorage.getItem(STORAGE_KEY_MANUAL);
      if (savedManual) {
        const parsed = JSON.parse(savedManual);
        Object.assign(manualConfig, parsed);
        hasSavedManualConfig = true;
      }
      const savedPassive = localStorage.getItem(STORAGE_KEY_PASSIVE);
      if (savedPassive) {
        const parsed = JSON.parse(savedPassive);
        Object.assign(passiveConfig, parsed);
        hasSavedPassiveConfig = true;
      }
    } catch (e) {
      console.error('Error loading saved configs:', e);
    }
  }

  function saveManualConfig() {
    try {
      localStorage.setItem(STORAGE_KEY_MANUAL, JSON.stringify(manualConfig));
      hasSavedManualConfig = true;
    } catch (e) {
      console.error('Error saving manual config:', e);
    }
  }

  function savePassiveConfig() {
    try {
      localStorage.setItem(STORAGE_KEY_PASSIVE, JSON.stringify(passiveConfig));
      hasSavedPassiveConfig = true;
    } catch (e) {
      console.error('Error saving passive config:', e);
    }
  }

  // Jours de la semaine pour week_set
  const weekDays = [
    { bit: 1, label: 'Lun' },
    { bit: 2, label: 'Mar' },
    { bit: 4, label: 'Mer' },
    { bit: 8, label: 'Jeu' },
    { bit: 16, label: 'Ven' },
    { bit: 32, label: 'Sam' },
    { bit: 64, label: 'Dim' }
  ];

  // Calcule l'intervalle optimal selon le temps de réponse
  function getOptimalInterval(responseTime: number, hasError: boolean): number {
    if (hasError) return 30000;        // Erreur: 30s
    if (responseTime < 500) return 3000;   // Rapide: 3s
    if (responseTime < 2000) return 5000;  // Moyen: 5s
    if (responseTime < 5000) return 10000; // Lent: 10s
    return 30000;                          // Très lent: 30s
  }

  function scheduleNextFetch() {
    if (interval) clearInterval(interval);
    interval = setInterval(fetchData, currentInterval);
  }

  async function fetchData() {
    // TEST: simuler erreur de connexion
    if (TEST_CONNECTION_ERROR) {
      error = 'Timeout après 5000ms - Connexion perdue avec la batterie';
      loading = false;
      return;
    }

    // Éviter l'empilement des requêtes
    if (fetching) return;

    fetching = true;
    const startTime = performance.now();

    try {
      if (isTauri()) {
        data = await invoke<DashboardData>('get_dashboard');
      } else {
        const res = await fetch('/api/dashboard');
        data = await res.json();
      }
      error = null;
      lastResponseTime = Math.round(performance.now() - startTime);

      // Ajuster l'intervalle si nécessaire
      const newInterval = getOptimalInterval(lastResponseTime, false);
      if (newInterval !== currentInterval) {
        currentInterval = newInterval;
        scheduleNextFetch();
      }
    } catch (e) {
      error = String(e);
      lastResponseTime = Math.round(performance.now() - startTime);

      // Ralentir en cas d'erreur
      const newInterval = getOptimalInterval(lastResponseTime, true);
      if (newInterval !== currentInterval) {
        currentInterval = newInterval;
        scheduleNextFetch();
      }
    } finally {
      loading = false;
      fetching = false;
    }
  }

  async function selectDevice(device: DiscoveredDevice) {
    if (connecting) return;
    connecting = true;
    showDeviceSelector = false;

    try {
      if (isTauri()) {
        await invoke('set_device', { ip: device.ip, port: device.port });
      }
      deviceConfigured = true;
      foundDevice = device;
      discoveryError = null;
      error = null;
      startDashboard();
    } catch (e) {
      error = String(e);
      showDeviceSelector = true;
    } finally {
      connecting = false;
    }
  }

  async function connectManual() {
    if (!manualIp.trim() || connecting) return;
    const port = parseInt(manualPort) || 30000;
    const device: DiscoveredDevice = { ip: manualIp.trim(), port };
    await selectDevice(device);
  }

  function openDeviceSelector() {
    if (interval) clearInterval(interval);
    showDeviceSelector = true;
    deviceConfigured = false;
    error = null;
    loading = true;
  }

  function startDashboard() {
    currentInterval = 3000; // Reset à l'intervalle rapide au démarrage
    fetchData();
    interval = setInterval(fetchData, currentInterval);
  }

  onMount(async () => {
    // Charger les configs sauvegardées
    loadSavedConfigs();

    if (isTauri()) {
      // Mode Tauri - auto-découverte
      discovering = true;

      // TEST: simuler aucun device
      if (TEST_NO_DEVICE) {
        await new Promise(r => setTimeout(r, 2000)); // Simule délai discovery
        discoveryError = 'no_device';
        discovering = false;
        return;
      }

      try {
        const devices = await invoke<DiscoveredDevice[]>('discover_devices');
        allDevices = devices;

        if (devices.length === 0) {
          discoveryError = 'no_device';
        } else if (devices.length === 1) {
          // Une seule batterie: connexion auto
          const device = devices[0];
          await invoke('set_device', { ip: device.ip, port: device.port });
          deviceConfigured = true;
          foundDevice = device;
          startDashboard();
        } else {
          // Plusieurs batteries: afficher le sélecteur
          showDeviceSelector = true;
        }
      } catch (e) {
        discoveryError = String(e);
      }
      discovering = false;
    } else {
      // Mode web - le dev-server gère la découverte
      discovering = false;
      deviceConfigured = true;
      startDashboard();
    }
  });

  onDestroy(() => {
    if (interval) clearInterval(interval);
  });

  function formatPower(watts: number | undefined): string {
    if (watts === undefined || watts === null) return '-- W';
    const abs = Math.abs(watts);
    if (abs >= 1000) return `${(watts / 1000).toFixed(2)} kW`;
    return `${Math.round(watts)} W`;
  }

  function formatEnergy(wh: number | undefined): string {
    if (wh === undefined || wh === null) return '-- kWh';
    return `${(wh / 1000).toFixed(1)} kWh`;
  }

  async function handleModeChange(e: Event) {
    const newMode = (e.target as HTMLSelectElement).value;
    modeError = null;

    if (newMode === 'Manual') {
      if (hasSavedManualConfig) {
        // Config sauvegardée: appliquer directement
        await applyManualMode();
      } else {
        // Pas de config: ouvrir le popup
        pendingMode = newMode;
        showModeModal = true;
      }
    } else if (newMode === 'Passive') {
      if (hasSavedPassiveConfig) {
        // Config sauvegardée: appliquer directement
        await applyPassiveMode();
      } else {
        // Pas de config: ouvrir le popup
        pendingMode = newMode;
        showModeModal = true;
      }
    } else {
      await applyMode(newMode);
    }
  }

  function openModeConfig() {
    const currentMode = data?.mode?.mode;
    if (currentMode === 'Manual' || currentMode === 'Passive') {
      pendingMode = currentMode;
      showModeModal = true;
    }
  }

  async function applyMode(mode: string, config?: object) {
    changingMode = true;
    modeError = null;

    try {
      if (isTauri()) {
        await invoke('set_mode', { mode, config });
      } else {
        const res = await fetch('/api/set-mode', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode, config })
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Erreur lors du changement de mode');
        }
      }
      showModeModal = false;
      pendingMode = null;
      await fetchData();
    } catch (e) {
      modeError = String(e);
    } finally {
      changingMode = false;
    }
  }

  function applyManualMode() {
    // Sauvegarder la config
    saveManualConfig();
    // Calculer la puissance avec le signe (négatif = charge)
    const power = manualConfig.isCharge ? -Math.abs(manualConfig.power) : Math.abs(manualConfig.power);
    const cfg = {
      time_num: manualConfig.time_num,
      start_time: manualConfig.start_time,
      end_time: manualConfig.end_time,
      week_set: manualConfig.week_set,
      power,
      enable: manualConfig.enable
    };
    applyMode('Manual', { manual_cfg: cfg });
  }

  function applyPassiveMode() {
    // Sauvegarder la config
    savePassiveConfig();
    // Calculer la puissance avec le signe (négatif = charge)
    const power = passiveConfig.isCharge ? -Math.abs(passiveConfig.power) : Math.abs(passiveConfig.power);
    const cfg = {
      power,
      cd_time: passiveConfig.cd_time
    };
    applyMode('Passive', { passive_cfg: cfg });
  }

  function cancelModeChange() {
    showModeModal = false;
    pendingMode = null;
    modeError = null;
  }

  function toggleWeekDay(bit: number) {
    if (manualConfig.week_set & bit) {
      manualConfig.week_set &= ~bit;
    } else {
      manualConfig.week_set |= bit;
    }
  }
</script>

<main class="min-h-screen bg-slate-900 p-6">
  <header class="mb-8 flex justify-between items-start">
    <div>
      <h1 class="text-3xl font-bold text-white flex items-center gap-3">
        <span class="text-4xl">⚡</span>
        Marstek Dashboard
        <span
          class="w-2 h-2 rounded-full transition-all duration-150 {fetching ? 'bg-cyan-400 shadow-[0_0_8px_2px_rgba(34,211,238,0.6)]' : 'bg-slate-600'}"
          title={fetching ? 'Requête en cours...' : 'En attente'}
        ></span>
      </h1>
      {#if data}
        <p class="text-slate-400 mt-1">
          {data.device.device} v{data.device.ver} • Mis à jour: {data.timestamp}
        </p>
      {:else if foundDevice}
        <p class="text-slate-400 mt-1">
          {foundDevice.device ?? 'Marstek'} @ {foundDevice.ip}
        </p>
      {/if}
    </div>
    {#if deviceConfigured && !showDeviceSelector}
      <button
        onclick={openDeviceSelector}
        class="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
        title="Changer de batterie"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      </button>
    {/if}
  </header>

  {#if discovering}
    <div class="flex flex-col items-center justify-center h-64 gap-4">
      <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-500"></div>
      <p class="text-slate-400">Recherche de batterie Marstek...</p>
    </div>

  {:else if showDeviceSelector}
    <div class="max-w-2xl mx-auto">
      <div class="bg-slate-800 border border-slate-700 rounded-xl p-6 mb-6">
        <h3 class="text-xl font-bold text-white mb-4 flex items-center gap-2">
          <span class="text-2xl">🔋</span>
          {allDevices.length > 0 ? 'Sélectionner une batterie' : 'Connexion manuelle'}
        </h3>

        {#if allDevices.length > 0}
          <div class="space-y-3 mb-6">
            {#each allDevices as device}
              <button
                onclick={() => selectDevice(device)}
                disabled={connecting}
                class="w-full flex items-center justify-between p-4 bg-slate-700 hover:bg-slate-600 disabled:bg-slate-800 disabled:cursor-not-allowed rounded-lg transition-colors text-left"
              >
                <div>
                  <div class="text-white font-medium">{device.device ?? 'Marstek'}</div>
                  <div class="text-slate-400 text-sm">{device.ip}:{device.port}</div>
                </div>
                {#if device.ver}
                  <div class="text-slate-500 text-sm">v{device.ver}</div>
                {/if}
              </button>
            {/each}
          </div>
        {/if}

        <div class="border-t border-slate-600 pt-4">
          <p class="text-slate-400 text-sm mb-3">
            {allDevices.length > 0 ? 'Ou entrez une adresse IP manuellement :' : 'Entrez l\'adresse IP de la batterie :'}
          </p>
          <div class="flex gap-2">
            <input
              type="text"
              placeholder="192.168.1.xxx"
              bind:value={manualIp}
              disabled={connecting}
              onkeydown={(e) => e.key === 'Enter' && connectManual()}
              class="flex-1 px-4 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 disabled:opacity-50"
            />
            <input
              type="text"
              placeholder="30000"
              bind:value={manualPort}
              disabled={connecting}
              onkeydown={(e) => e.key === 'Enter' && connectManual()}
              class="w-24 px-4 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 text-center disabled:opacity-50"
            />
            <button
              onclick={connectManual}
              disabled={connecting || !manualIp.trim()}
              class="px-6 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:bg-cyan-800 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors min-w-[120px]"
            >
              {connecting ? 'Connexion...' : 'Connecter'}
            </button>
          </div>
          <p class="text-slate-500 text-xs mt-2">Port par défaut : 30000</p>
        </div>
      </div>
    </div>

  {:else if discoveryError}
    <div class="bg-amber-900/50 border border-amber-500 rounded-xl p-6 max-w-2xl mx-auto">
      <h3 class="text-xl font-bold text-amber-200 mb-4 flex items-center gap-2">
        <span class="text-2xl">🔍</span>
        Aucune batterie Marstek détectée
      </h3>

      <div class="text-amber-100 space-y-3">
        <p class="font-medium">Pour que la détection fonctionne :</p>
        <ul class="list-disc list-inside space-y-2 text-amber-200/80">
          <li>La batterie Marstek doit être <strong class="text-amber-100">allumée et connectée au réseau</strong> (WiFi ou câble Ethernet)</li>
          <li>Votre ordinateur doit être sur le <strong class="text-amber-100">même réseau local</strong> que la batterie</li>
          <li>Le port UDP <strong class="text-amber-100">30000</strong> ne doit pas être bloqué par un pare-feu</li>
          <li>Modèles compatibles : <strong class="text-amber-100">VenusE, Venus series</strong></li>
        </ul>
      </div>

      <div class="mt-6 pt-4 border-t border-amber-500/30">
        <p class="text-amber-200 text-sm mb-3">Ou entrez l'adresse IP manuellement :</p>
        <div class="flex gap-2">
          <input
            type="text"
            placeholder="192.168.1.xxx"
            bind:value={manualIp}
            disabled={connecting}
            onkeydown={(e) => e.key === 'Enter' && connectManual()}
            class="flex-1 px-4 py-2 bg-slate-800 border border-amber-500/50 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-amber-400 disabled:opacity-50"
          />
          <input
            type="text"
            placeholder="30000"
            bind:value={manualPort}
            disabled={connecting}
            onkeydown={(e) => e.key === 'Enter' && connectManual()}
            class="w-24 px-4 py-2 bg-slate-800 border border-amber-500/50 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-amber-400 text-center disabled:opacity-50"
          />
          <button
            onclick={connectManual}
            disabled={connecting || !manualIp.trim()}
            class="px-6 py-2 bg-amber-600 hover:bg-amber-500 disabled:bg-amber-800 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors min-w-[120px]"
          >
            {connecting ? 'Connexion...' : 'Connecter'}
          </button>
        </div>
        <p class="text-amber-200/50 text-xs mt-2">Port par défaut : 30000</p>
      </div>
    </div>

  {:else if loading}
    <div class="flex items-center justify-center h-64">
      <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-500"></div>
    </div>

  {:else if error}
    <div class="bg-red-900/50 border border-red-500 rounded-xl p-6 text-red-200 max-w-2xl mx-auto">
      <h3 class="font-bold text-lg mb-2">Erreur de connexion</h3>
      <p class="mb-4">{error}</p>
      <button
        onclick={() => {
          error = null;
          deviceConfigured = false;
          discoveryError = 'no_device';
          if (interval) clearInterval(interval);
        }}
        class="px-4 py-2 bg-red-600 hover:bg-red-500 text-white font-medium rounded-lg transition-colors"
      >
        Modifier l'adresse IP
      </button>
    </div>

  {:else if data}
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">

      <!-- Batterie -->
      <div class="col-span-1 md:col-span-2 lg:col-span-2 bg-slate-800 rounded-xl p-6 border border-slate-700">
        <h2 class="text-lg font-semibold text-slate-300 mb-4 flex items-center gap-2">
          <span class="text-2xl">🔋</span> Batterie
        </h2>

        <div class="flex items-center gap-6">
          <div class="text-5xl font-bold text-white">{soc}%</div>

          <div class="flex-1">
            <div class="h-8 bg-slate-700 rounded-full overflow-hidden">
              <div
                class="h-full {socColor} transition-all duration-500 rounded-full"
                style="width: {soc}%"
              ></div>
            </div>
            <div class="flex justify-between mt-2 text-sm text-slate-400">
              <span>{formatEnergy(data.battery.bat_capacity)}</span>
              <span>{formatEnergy(data.battery.rated_capacity)}</span>
            </div>
          </div>
        </div>

        <div class="mt-4 flex gap-6 text-sm">
          <div class="flex items-center gap-2">
            <span class="text-slate-400">Temp:</span>
            <span class="text-white font-medium">{data.battery.bat_temp}°C</span>
          </div>
          <div class="flex items-center gap-2">
            <span class={data.battery.charg_flag ? 'text-green-400' : 'text-slate-500'}>
              {data.battery.charg_flag ? '✓' : '✗'} Charge
            </span>
          </div>
          <div class="flex items-center gap-2">
            <span class={data.battery.dischrg_flag ? 'text-green-400' : 'text-slate-500'}>
              {data.battery.dischrg_flag ? '✓' : '✗'} Décharge
            </span>
          </div>
        </div>
      </div>

      <!-- État -->
      <div class="bg-slate-800 rounded-xl p-6 border border-slate-700">
        <h2 class="text-lg font-semibold text-slate-300 mb-4 flex items-center gap-2">
          <span class="text-2xl">⚙️</span> État
        </h2>

        <div class="space-y-4">
          <div>
            <span class="text-slate-400 text-sm">Mode</span>
            <div class="flex gap-2 mt-1">
              <select
                value={data.mode.mode}
                onchange={handleModeChange}
                disabled={changingMode}
                class="flex-1 px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-xl font-bold text-purple-400 focus:outline-none focus:border-purple-500 disabled:opacity-50 cursor-pointer"
              >
                <option value="Auto">Auto</option>
                <option value="AI">AI</option>
                <option value="Manual">Manual</option>
                <option value="Passive">Passive</option>
              </select>
              {#if data.mode.mode === 'Manual' || data.mode.mode === 'Passive'}
                <button
                  onclick={openModeConfig}
                  disabled={changingMode}
                  class="px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-slate-400 hover:text-white hover:bg-slate-600 disabled:opacity-50 transition-colors"
                  title="Modifier la configuration du mode"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </button>
              {/if}
            </div>
            {#if changingMode}
              <span class="text-xs text-slate-500">Changement en cours...</span>
            {/if}
          </div>

          <div>
            <span class="text-slate-400 text-sm">Statut</span>
            <div class="text-xl font-bold {isCharging ? 'text-yellow-400' : isDischarging ? 'text-green-400' : 'text-slate-400'}">
              {isCharging ? '⚡ CHARGE' : isDischarging ? '⬆ INJECTION' : '⏸ VEILLE'}
            </div>
          </div>

          <div>
            <span class="text-slate-400 text-sm">Puissance Grid</span>
            <div class="text-2xl font-bold text-white">{formatPower(data.energy.ongrid_power)}</div>
          </div>
        </div>
      </div>

      <!-- Compteur CT -->
      {#if data.meter.ct_state === 1}
        <div class="bg-slate-800 rounded-xl p-6 border border-slate-700">
          <h2 class="text-lg font-semibold text-slate-300 mb-4 flex items-center gap-2">
            <span class="text-2xl">📊</span> Compteur CT
          </h2>

          <div class="space-y-3">
            <div class="flex justify-between">
              <span class="text-slate-400">Phase A</span>
              <span class="text-white font-medium">{formatPower(data.meter.a_power)}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-slate-400">Phase B</span>
              <span class="text-white font-medium">{formatPower(data.meter.b_power)}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-slate-400">Phase C</span>
              <span class="text-white font-medium">{formatPower(data.meter.c_power)}</span>
            </div>
            <div class="border-t border-slate-600 pt-3 flex justify-between">
              <span class="text-slate-300 font-medium">Total maison</span>
              <span class="text-cyan-400 font-bold">{formatPower(data.meter.total_power)}</span>
            </div>
          </div>
        </div>
      {/if}

      <!-- Statistiques -->
      <div class="bg-slate-800 rounded-xl p-6 border border-slate-700">
        <h2 class="text-lg font-semibold text-slate-300 mb-4 flex items-center gap-2">
          <span class="text-2xl">📈</span> Statistiques
        </h2>

        <div class="space-y-3">
          <div class="flex justify-between">
            <span class="text-slate-400">Énergie injectée</span>
            <span class="text-green-400 font-medium">{formatEnergy(data.energy.total_grid_output_energy)}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-slate-400">Énergie consommée</span>
            <span class="text-yellow-400 font-medium">{formatEnergy(data.energy.total_grid_input_energy)}</span>
          </div>
          {#if true}
            {@const bilan = (data.energy.total_grid_output_energy ?? 0) - (data.energy.total_grid_input_energy ?? 0)}
            <div class="border-t border-slate-600 pt-3 flex justify-between">
              <span class="text-slate-300 font-medium">Bilan</span>
              <span class="{bilan > 0 ? 'text-green-400' : 'text-yellow-400'} font-bold">
                {formatEnergy(bilan)}
              </span>
            </div>
          {/if}
        </div>
      </div>

      <!-- Connexion -->
      <div class="bg-slate-800 rounded-xl p-6 border border-slate-700">
        <h2 class="text-lg font-semibold text-slate-300 mb-4 flex items-center gap-2">
          <span class="text-2xl">📡</span> Connexion
        </h2>

        <div class="space-y-3">
          <div class="flex justify-between">
            <span class="text-slate-400">WiFi</span>
            <span class="text-white font-medium">{data.wifi.ssid}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-slate-400">Signal</span>
            <span class="text-white font-medium">{data.wifi.rssi} dBm</span>
          </div>
          <div class="flex justify-between">
            <span class="text-slate-400">IP</span>
            <span class="text-white font-medium">{data.device.ip}</span>
          </div>
        </div>
      </div>

    </div>
  {/if}

  <!-- Modal de configuration du mode -->
  {#if showModeModal}
    <div class="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div class="bg-slate-800 border border-slate-700 rounded-xl p-6 w-full max-w-md">
        <h3 class="text-xl font-bold text-white mb-4">
          Configuration mode {pendingMode}
        </h3>

        {#if modeError}
          <div class="mb-4 p-3 bg-red-900/50 border border-red-500 rounded-lg text-red-200 text-sm">
            {modeError}
          </div>
        {/if}

        {#if pendingMode === 'Manual'}
          <div class="space-y-4">
            <div>
              <label class="block text-slate-400 text-sm mb-1">Numéro de plage (0-9)</label>
              <input
                type="number"
                min="0"
                max="9"
                bind:value={manualConfig.time_num}
                class="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-purple-500"
              />
            </div>

            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="block text-slate-400 text-sm mb-1">Heure début</label>
                <input
                  type="time"
                  bind:value={manualConfig.start_time}
                  class="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-purple-500"
                />
              </div>
              <div>
                <label class="block text-slate-400 text-sm mb-1">Heure fin</label>
                <input
                  type="time"
                  bind:value={manualConfig.end_time}
                  class="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-purple-500"
                />
              </div>
            </div>

            <div>
              <label class="block text-slate-400 text-sm mb-2">Jours de la semaine</label>
              <div class="flex flex-wrap gap-2">
                {#each weekDays as day}
                  <button
                    type="button"
                    onclick={() => toggleWeekDay(day.bit)}
                    class="px-3 py-1 rounded-lg text-sm font-medium transition-colors {manualConfig.week_set & day.bit ? 'bg-purple-600 text-white' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'}"
                  >
                    {day.label}
                  </button>
                {/each}
              </div>
            </div>

            <div>
              <label class="block text-slate-400 text-sm mb-2">Direction</label>
              <div class="flex gap-2">
                <button
                  type="button"
                  onclick={() => manualConfig.isCharge = true}
                  class="flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors {manualConfig.isCharge ? 'bg-yellow-600 text-white' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'}"
                >
                  ⚡ Charge
                </button>
                <button
                  type="button"
                  onclick={() => manualConfig.isCharge = false}
                  class="flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors {!manualConfig.isCharge ? 'bg-green-600 text-white' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'}"
                >
                  ⬆ Décharge
                </button>
              </div>
            </div>

            <div>
              <label class="block text-slate-400 text-sm mb-1">Puissance (W)</label>
              <input
                type="number"
                min="0"
                max="2000"
                step="100"
                bind:value={manualConfig.power}
                class="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-purple-500"
              />
            </div>

            <div class="flex items-center gap-2">
              <input
                type="checkbox"
                id="manual-enable"
                checked={manualConfig.enable === 1}
                onchange={(e) => manualConfig.enable = (e.target as HTMLInputElement).checked ? 1 : 0}
                class="w-4 h-4 accent-purple-500"
              />
              <label for="manual-enable" class="text-slate-300">Activer cette plage</label>
            </div>
          </div>

        {:else if pendingMode === 'Passive'}
          <div class="space-y-4">
            <div>
              <label class="block text-slate-400 text-sm mb-2">Direction</label>
              <div class="flex gap-2">
                <button
                  type="button"
                  onclick={() => passiveConfig.isCharge = true}
                  class="flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors {passiveConfig.isCharge ? 'bg-yellow-600 text-white' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'}"
                >
                  ⚡ Charge
                </button>
                <button
                  type="button"
                  onclick={() => passiveConfig.isCharge = false}
                  class="flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors {!passiveConfig.isCharge ? 'bg-green-600 text-white' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'}"
                >
                  ⬆ Décharge
                </button>
              </div>
            </div>

            <div>
              <label class="block text-slate-400 text-sm mb-1">Puissance (W)</label>
              <input
                type="number"
                min="0"
                max="2000"
                step="100"
                bind:value={passiveConfig.power}
                class="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-purple-500"
              />
            </div>

            <div>
              <label class="block text-slate-400 text-sm mb-1">Durée countdown (secondes)</label>
              <input
                type="number"
                min="0"
                max="86400"
                step="60"
                bind:value={passiveConfig.cd_time}
                class="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-purple-500"
              />
              <p class="text-slate-500 text-xs mt-1">Durée pendant laquelle le mode reste actif (ex: 300 = 5 min)</p>
            </div>
          </div>
        {/if}

        <div class="flex gap-3 mt-6">
          <button
            onclick={cancelModeChange}
            disabled={changingMode}
            class="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white font-medium rounded-lg transition-colors"
          >
            Annuler
          </button>
          <button
            onclick={pendingMode === 'Manual' ? applyManualMode : applyPassiveMode}
            disabled={changingMode}
            class="flex-1 px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-medium rounded-lg transition-colors"
          >
            {changingMode ? 'Application...' : 'Appliquer'}
          </button>
        </div>
      </div>
    </div>
  {/if}
</main>
