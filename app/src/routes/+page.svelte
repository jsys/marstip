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

  let soc = $derived(data?.battery?.soc ?? data?.energy?.bat_soc ?? 0);
  let isCharging = $derived((data?.energy?.ongrid_power ?? 0) < 0);
  let isDischarging = $derived((data?.energy?.ongrid_power ?? 0) > 0);
  let socColor = $derived(soc < 20 ? 'bg-red-500' : soc < 50 ? 'bg-yellow-500' : 'bg-green-500');
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
            <div class="text-xl font-bold text-purple-400">{data.mode.mode}</div>
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
</main>
