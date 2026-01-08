<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { load } from '@tauri-apps/plugin-store';
  import type { Store } from '@tauri-apps/plugin-store';

  const isTauriEnv = '__TAURI_INTERNALS__' in window;
  let store: Store | null = null;

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

  interface TimeSlot {
    id: string;
    startHour: number;  // 0-24 en décimal (ex: 22.083 pour 22h05)
    endHour: number;
    mode: 'Auto' | 'AI' | 'Manual' | 'Passive';
    config?: {
      power?: number;
      isCharge?: boolean;
      cd_time?: number;
    };
  }

  let data = $state<DashboardData | null>(null);
  let error = $state<string | null>(null);
  let loading = $state(true);
  let interval: ReturnType<typeof setInterval>;

  // Derived values
  let soc = $derived(data?.battery?.soc ?? data?.energy?.bat_soc ?? 0);
  let ongridPower = $derived(data?.energy?.ongrid_power ?? 0);
  let isCharging = $derived(ongridPower < 0);
  let isDischarging = $derived(ongridPower > 0);
  let socColor = $derived(
    isCharging ? 'bg-blue-500' :
    isDischarging ? 'bg-red-500' :
    soc < 20 ? 'bg-red-500' :
    soc < 50 ? 'bg-yellow-500' : 'bg-green-500'
  );

  // Auto-discovery states
  let discovering = $state(true);
  let deviceConfigured = $state(false);
  let discoveryError = $state<string | null>(null);
  let manualIp = $state('');
  let manualPort = $state('30000');
  let allDevices: DiscoveredDevice[] = $state([]);
  let showDeviceSelector = $state(false);
  let connecting = $state(false);
  let fetching = $state(false);
  let currentInterval = $state(3000);

  // Planning / Scheduler states
  let timeSlots = $state<TimeSlot[]>([
    { id: crypto.randomUUID(), startHour: 0, endHour: 24, mode: 'Auto' }
  ]);
  let schedulerEnabled = $state(false);
  let editingSlot = $state<TimeSlot | null>(null);
  let showSlotModal = $state(false);
  let currentScheduledSlotId = $state<string | null>(null);
  let schedulerInterval: ReturnType<typeof setInterval>;

  // Drag & drop states
  let draggingBoundary = $state<number | null>(null); // Index de la frontière (entre slot i et i+1)
  let dragTooltip = $state<{ hour: number; x: number; y: number } | null>(null);
  let rubanElement = $state<HTMLDivElement | null>(null);

  // Tab navigation
  let activeTab = $state<'dashboard' | 'infos'>('dashboard');

  // Visibility state (pause polling when minimized)
  let isVisible = $state(true);

  // Storage keys
  const STORAGE_KEY_SLOTS = 'time_slots';
  const STORAGE_KEY_SCHEDULER = 'scheduler_enabled';

  async function loadSavedConfigs() {
    try {
      if (isTauriEnv) {
        store = await load('settings.json');
        const savedSlots = await store.get<TimeSlot[]>(STORAGE_KEY_SLOTS);
        if (savedSlots) {
          timeSlots = savedSlots;
        }
        const savedScheduler = await store.get<boolean>(STORAGE_KEY_SCHEDULER);
        if (savedScheduler !== null && savedScheduler !== undefined) {
          schedulerEnabled = savedScheduler;
        }
      } else {
        // Fallback localStorage pour dev web
        const savedSlots = localStorage.getItem(STORAGE_KEY_SLOTS);
        if (savedSlots) {
          timeSlots = JSON.parse(savedSlots);
        }
        const savedScheduler = localStorage.getItem(STORAGE_KEY_SCHEDULER);
        if (savedScheduler) {
          schedulerEnabled = JSON.parse(savedScheduler);
        }
      }
    } catch (e) {
      console.error('Error loading saved configs:', e);
    }
  }

  async function saveTimeSlots() {
    try {
      if (isTauriEnv && store) {
        await store.set(STORAGE_KEY_SLOTS, timeSlots);
        await store.set(STORAGE_KEY_SCHEDULER, schedulerEnabled);
        await store.save();
      } else {
        // Fallback localStorage pour dev web
        localStorage.setItem(STORAGE_KEY_SLOTS, JSON.stringify(timeSlots));
        localStorage.setItem(STORAGE_KEY_SCHEDULER, JSON.stringify(schedulerEnabled));
      }
    } catch (e) {
      console.error('Error saving time slots:', e);
    }
  }

  // --- Planning / Scheduler functions ---

  const MODE_COLORS: Record<string, string> = {
    Auto: 'bg-cyan-500',
    AI: 'bg-purple-500',
    Manual: 'bg-yellow-500',
    Passive: 'bg-green-500'
  };

  function getModeColor(mode: string): string {
    return MODE_COLORS[mode] ?? 'bg-slate-500';
  }

  function formatHour(decimalHour: number): string {
    const hours = Math.floor(decimalHour);
    const minutes = Math.round((decimalHour - hours) * 60);
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
  }

  function openSlotEditor(slot: TimeSlot) {
    editingSlot = { ...slot, config: slot.config ? { ...slot.config } : undefined };
    showSlotModal = true;
  }

  function saveSlot() {
    if (!editingSlot) return;
    const idx = timeSlots.findIndex(s => s.id === editingSlot!.id);
    if (idx >= 0) {
      timeSlots[idx] = editingSlot;
      timeSlots = [...timeSlots]; // Trigger reactivity
    }
    showSlotModal = false;
    editingSlot = null;
    saveTimeSlots();
  }

  function deleteSlot(slotId: string) {
    if (timeSlots.length <= 1) return; // Garder au moins une plage

    const idx = timeSlots.findIndex(s => s.id === slotId);
    if (idx < 0) return;

    const deleted = timeSlots[idx];

    // Fusionner avec la plage adjacente (précédente si possible, sinon suivante)
    if (idx > 0) {
      // Fusionner avec la plage précédente
      timeSlots[idx - 1] = { ...timeSlots[idx - 1], endHour: deleted.endHour };
    } else if (idx < timeSlots.length - 1) {
      // Fusionner avec la plage suivante
      timeSlots[idx + 1] = { ...timeSlots[idx + 1], startHour: deleted.startHour };
    }

    timeSlots = timeSlots.filter(s => s.id !== slotId);

    // Si il ne reste qu'une seule zone, s'assurer qu'elle couvre 0h-24h
    if (timeSlots.length === 1) {
      timeSlots[0] = { ...timeSlots[0], startHour: 0, endHour: 24 };
    }

    showSlotModal = false;
    editingSlot = null;
    saveTimeSlots();
  }

  function addSlotAfter(afterSlot: TimeSlot) {
    const idx = timeSlots.findIndex(s => s.id === afterSlot.id);
    if (idx < 0) return;

    // Diviser la plage en deux au milieu, arrondi à 5min
    const midHour = snapToFiveMinutes((afterSlot.startHour + afterSlot.endHour) / 2);

    // Mettre à jour la plage existante
    timeSlots[idx] = { ...afterSlot, endHour: midHour };

    // Créer la nouvelle plage avec le MÊME mode
    const newSlot: TimeSlot = {
      id: crypto.randomUUID(),
      startHour: midHour,
      endHour: afterSlot.endHour,
      mode: afterSlot.mode,
      config: afterSlot.config ? { ...afterSlot.config } : undefined
    };

    // Insérer après
    timeSlots = [...timeSlots.slice(0, idx + 1), newSlot, ...timeSlots.slice(idx + 1)];
    saveTimeSlots();

    // Fermer la popup
    showSlotModal = false;
    editingSlot = null;
  }

  function toggleScheduler() {
    schedulerEnabled = !schedulerEnabled;
    saveTimeSlots();
    if (schedulerEnabled) {
      checkScheduler();
    }
  }

  function getCurrentSlot(): TimeSlot | null {
    const now = new Date();
    const currentHour = now.getHours() + now.getMinutes() / 60;
    return timeSlots.find(s => currentHour >= s.startHour && currentHour < s.endHour) ?? null;
  }

  function checkScheduler() {
    if (!schedulerEnabled || !deviceConfigured) return;

    const slot = getCurrentSlot();
    if (!slot) return;

    // Si on a déjà appliqué cette plage, ne rien faire
    if (currentScheduledSlotId === slot.id) return;

    // Vérifier si le mode actuel correspond
    if (data?.mode?.mode !== slot.mode) {
      currentScheduledSlotId = slot.id;
      // Appliquer le mode avec sa config si présente
      if (slot.mode === 'Manual' && slot.config) {
        const power = slot.config.isCharge ? -Math.abs(slot.config.power ?? 800) : Math.abs(slot.config.power ?? 800);
        applyMode('Manual', { manual_cfg: { time_num: 0, start_time: formatHour(slot.startHour), end_time: formatHour(slot.endHour), week_set: 127, power, enable: 1 } });
      } else if (slot.mode === 'Passive' && slot.config) {
        const power = slot.config.isCharge ? -Math.abs(slot.config.power ?? 800) : Math.abs(slot.config.power ?? 800);
        applyMode('Passive', { passive_cfg: { power, cd_time: slot.config.cd_time ?? 300 } });
      } else {
        applyMode(slot.mode);
      }
    } else {
      // Mode déjà correct, juste marquer comme appliqué
      currentScheduledSlotId = slot.id;
    }
  }

  // --- Drag & Drop des frontières ---

  const MIN_SLOT_DURATION = 0.25; // 15 minutes minimum

  function snapToFiveMinutes(hour: number): number {
    // Arrondir au 5 minutes le plus proche (5min = 1/12 d'heure)
    return Math.round(hour * 12) / 12;
  }

  function xToHour(x: number, rect: DOMRect): number {
    const ratio = Math.max(0, Math.min(1, x / rect.width));
    return ratio * 24;
  }

  function startDrag(boundaryIndex: number, e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    draggingBoundary = boundaryIndex;

    const rect = rubanElement?.getBoundingClientRect();
    if (rect) {
      const hour = snapToFiveMinutes(xToHour(e.clientX - rect.left, rect));
      dragTooltip = { hour, x: e.clientX, y: rect.top - 30 };
    }

    document.addEventListener('mousemove', onDrag);
    document.addEventListener('mouseup', endDrag);
  }

  function onDrag(e: MouseEvent) {
    if (draggingBoundary === null || !rubanElement) return;

    const rect = rubanElement.getBoundingClientRect();
    let newHour = snapToFiveMinutes(xToHour(e.clientX - rect.left, rect));

    // Contraintes : ne pas dépasser les plages adjacentes
    const leftSlot = timeSlots[draggingBoundary];
    const rightSlot = timeSlots[draggingBoundary + 1];

    const minHour = leftSlot.startHour + MIN_SLOT_DURATION;
    const maxHour = rightSlot.endHour - MIN_SLOT_DURATION;

    newHour = Math.max(minHour, Math.min(maxHour, newHour));

    // Mettre à jour le tooltip
    dragTooltip = { hour: newHour, x: e.clientX, y: rect.top - 30 };

    // Mettre à jour les plages en temps réel
    timeSlots[draggingBoundary] = { ...leftSlot, endHour: newHour };
    timeSlots[draggingBoundary + 1] = { ...rightSlot, startHour: newHour };
    timeSlots = [...timeSlots]; // Trigger reactivity
  }

  function endDrag() {
    document.removeEventListener('mousemove', onDrag);
    document.removeEventListener('mouseup', endDrag);

    if (draggingBoundary !== null) {
      saveTimeSlots();
    }

    draggingBoundary = null;
    dragTooltip = null;
  }

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
    // Ne pas rafraîchir si l'app est minimisée (sauf premier chargement)
    if (!isVisible && data) return;

    // Éviter l'empilement des requêtes
    if (fetching) return;

    fetching = true;
    const startTime = performance.now();
    let hasError = false;

    try {
      if (isTauriEnv) {
        data = await invoke<DashboardData>('get_dashboard');
      } else {
        const res = await fetch('/api/dashboard');
        data = await res.json();
      }
      error = null;
    } catch (e) {
      error = String(e);
      hasError = true;
    } finally {
      loading = false;
      fetching = false;

      // Ajuster l'intervalle selon le temps de réponse
      const responseTime = Math.round(performance.now() - startTime);
      const newInterval = getOptimalInterval(responseTime, hasError);
      if (newInterval !== currentInterval) {
        currentInterval = newInterval;
        scheduleNextFetch();
      }
    }
  }

  async function selectDevice(device: DiscoveredDevice) {
    if (connecting) return;
    connecting = true;
    showDeviceSelector = false;

    try {
      if (isTauriEnv) {
        await invoke('set_device', { ip: device.ip, port: device.port });
      }
      deviceConfigured = true;
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

  function handleVisibilityChange() {
    isVisible = document.visibilityState === 'visible';
    // Rafraîchir immédiatement quand on restaure l'app
    if (isVisible && deviceConfigured && !loading) {
      fetchData();
    }
  }

  onMount(async () => {
    // Écouter les changements de visibilité (minimisation)
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Charger les configs sauvegardées
    await loadSavedConfigs();

    if (isTauriEnv) {
      // Mode Tauri - auto-découverte
      discovering = true;
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

    // Démarrer le scheduler (vérifie toutes les minutes)
    schedulerInterval = setInterval(checkScheduler, 60000);
    // Check immédiat au démarrage
    setTimeout(checkScheduler, 1000);
  });

  onDestroy(() => {
    if (interval) clearInterval(interval);
    if (schedulerInterval) clearInterval(schedulerInterval);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
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

  async function applyMode(mode: string, config?: object) {
    try {
      if (isTauriEnv) {
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
      await fetchData();
    } catch (e) {
      console.error('Error applying mode:', e);
    }
  }
</script>

<main class="h-screen bg-slate-900 p-4 overflow-hidden flex flex-col">
  <header class="mb-4 flex justify-between items-center">
    <div class="flex items-center gap-2">
      <span class="text-2xl">⚡</span>
      <h1 class="text-xl font-bold text-white">MarsTip</h1>
      <span
        class="w-2 h-2 rounded-full transition-all duration-150 {fetching ? 'bg-cyan-400 shadow-[0_0_8px_2px_rgba(34,211,238,0.6)]' : 'bg-slate-600'}"
        title={fetching ? 'Requête en cours...' : 'En attente'}
      ></span>
    </div>
    <div class="flex items-center gap-2">
      {#if deviceConfigured && !showDeviceSelector && data}
        <!-- Onglets -->
        <div class="flex bg-slate-800 rounded-lg p-0.5">
          <button
            onclick={() => activeTab = 'dashboard'}
            class="px-3 py-1 text-sm rounded-md transition-colors {activeTab === 'dashboard' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'}"
          >
            Dashboard
          </button>
          <button
            onclick={() => activeTab = 'infos'}
            class="px-3 py-1 text-sm rounded-md transition-colors {activeTab === 'infos' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'}"
          >
            Infos
          </button>
        </div>
        <!-- Bouton paramètres -->
        <button
          onclick={openDeviceSelector}
          class="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
          title="Changer de batterie"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
      {/if}
    </div>
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
      <div class="flex gap-3">
        <button
          onclick={() => {
            error = null;
            loading = true;
            fetchData();
          }}
          class="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white font-medium rounded-lg transition-colors"
        >
          Réessayer
        </button>
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
    </div>

  {:else if data}
    <div class="flex-1 overflow-hidden">
      {#if activeTab === 'dashboard'}
        <!-- ONGLET DASHBOARD -->
        <div class="space-y-3">
          <!-- Batterie compacte -->
          <div class="bg-slate-800 rounded-xl p-4 border border-slate-700">
            <div class="flex items-center gap-4">
              <div class="text-4xl font-bold text-white">{soc}%</div>
              <div class="flex-1">
                <div class="h-6 bg-slate-700 rounded-full overflow-hidden">
                  <div
                    class="h-full {socColor} transition-all duration-500 rounded-full"
                    style="width: {soc}%"
                  ></div>
                </div>
                <div class="flex justify-between mt-1 text-xs text-slate-400">
                  <span>{formatEnergy(data.battery.bat_capacity)} / {formatEnergy(data.battery.rated_capacity)}</span>
                  <span>{data.battery.bat_temp}°C</span>
                </div>
              </div>
              <div class="text-right">
                <div class="text-lg font-bold {isCharging ? 'text-blue-400' : isDischarging ? 'text-red-400' : 'text-slate-400'}">
                  {isCharging ? '⚡' : isDischarging ? '⬆' : '⏸'} {formatPower(data.energy.ongrid_power)}
                </div>
                <div class="text-xs text-slate-500">{data.mode.mode ?? 'N/A'}</div>
              </div>
            </div>
          </div>

          <!-- Planning -->
          <div class="bg-slate-800 rounded-xl p-4 border border-slate-700">
            <div class="flex items-center justify-between mb-3">
              <h2 class="text-sm font-semibold text-slate-300 flex items-center gap-2">
                <span>📅</span> Planning
              </h2>
              <label class="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={schedulerEnabled}
                  onchange={toggleScheduler}
                  class="w-3 h-3 accent-cyan-500"
                />
                <span class="text-xs text-slate-400">Activer</span>
              </label>
            </div>

            <!-- Ruban 24h -->
            <div class="relative">
              <div class="flex justify-between text-[10px] text-slate-500 mb-1 px-0.5">
                {#each [0, 6, 12, 18, 24] as h}
                  <span>{h}h</span>
                {/each}
              </div>

              <div
                bind:this={rubanElement}
                class="relative h-10 bg-slate-700 rounded-lg overflow-hidden flex"
              >
                {#each timeSlots as slot, i}
                  <button
                    onclick={() => openSlotEditor(slot)}
                    class="h-full transition-colors hover:brightness-110 flex flex-col items-center justify-center {getModeColor(slot.mode)}"
                    style="width: {(slot.endHour - slot.startHour) / 24 * 100}%"
                    title="{formatHour(slot.startHour)} - {formatHour(slot.endHour)}: {slot.mode}"
                  >
                    {#if (slot.mode === 'Manual' || slot.mode === 'Passive') && slot.config?.isCharge !== undefined}
                      <span class="text-[10px] font-medium text-white/90 truncate px-1">{slot.config.isCharge ? 'Charge' : 'Décharge'}</span>
                    {:else}
                      <span class="text-[10px] font-medium text-white/90 truncate px-1">{slot.mode}</span>
                    {/if}
                  </button>
                  {#if i < timeSlots.length - 1}
                    <div
                      class="absolute top-0 bottom-0 w-3 -ml-1.5 cursor-col-resize z-10 group"
                      style="left: {slot.endHour / 24 * 100}%"
                      onmousedown={(e) => startDrag(i, e)}
                      role="slider"
                      aria-label="Ajuster la frontière"
                      aria-valuemin={0}
                      aria-valuemax={24}
                      aria-valuenow={slot.endHour}
                      tabindex="0"
                    >
                      <div class="absolute left-1/2 top-0 bottom-0 w-0.5 bg-slate-900/50 group-hover:bg-white transition-all"></div>
                    </div>
                  {/if}
                {/each}
              </div>

              {#if dragTooltip}
                <div
                  class="fixed bg-slate-900 text-white text-xs px-2 py-1 rounded shadow-lg pointer-events-none z-50"
                  style="left: {dragTooltip.x}px; top: {dragTooltip.y}px; transform: translateX(-50%)"
                >
                  {formatHour(dragTooltip.hour)}
                </div>
              {/if}

              {#if true}
                {@const now = new Date()}
                {@const currentPos = (now.getHours() + now.getMinutes() / 60) / 24 * 100}
                <div
                  class="absolute top-5 bottom-0 w-0.5 bg-white/70 pointer-events-none"
                  style="left: {currentPos}%"
                >
                  <div class="absolute -top-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 bg-white rounded-full"></div>
                </div>
              {/if}
            </div>

            <div class="mt-2 flex items-center justify-between text-[10px]">
              <div class="flex gap-2">
                <span class="flex items-center gap-1"><span class="w-2 h-2 rounded bg-cyan-500"></span> Auto</span>
                <span class="flex items-center gap-1"><span class="w-2 h-2 rounded bg-purple-500"></span> AI</span>
                <span class="flex items-center gap-1"><span class="w-2 h-2 rounded bg-yellow-500"></span> Manual</span>
                <span class="flex items-center gap-1"><span class="w-2 h-2 rounded bg-green-500"></span> Passive</span>
              </div>
            </div>
          </div>

          <!-- Compteur CT (si présent) -->
          {#if data.meter.ct_state === 1}
            <div class="bg-slate-800 rounded-xl p-4 border border-slate-700">
              <h2 class="text-sm font-semibold text-slate-300 mb-2 flex items-center gap-2">
                <span>📊</span> Conso maison
              </h2>
              <div class="flex items-center justify-between">
                <div class="flex gap-4 text-xs">
                  <span class="text-slate-400">A: <span class="text-white">{formatPower(data.meter.a_power)}</span></span>
                  <span class="text-slate-400">B: <span class="text-white">{formatPower(data.meter.b_power)}</span></span>
                  <span class="text-slate-400">C: <span class="text-white">{formatPower(data.meter.c_power)}</span></span>
                </div>
                <span class="text-cyan-400 font-bold">{formatPower(data.meter.total_power)}</span>
              </div>
            </div>
          {/if}
        </div>

      {:else}
        <!-- ONGLET INFOS -->
        <div class="grid grid-cols-2 gap-3">
          <!-- État -->
          <div class="bg-slate-800 rounded-xl p-4 border border-slate-700">
            <h2 class="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
              <span>⚙️</span> État
            </h2>
            <div class="space-y-2 text-sm">
              <div class="flex justify-between">
                <span class="text-slate-400">Mode</span>
                <span class="text-white font-medium">{data.mode.mode ?? 'N/A'}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-slate-400">Statut</span>
                <span class="{isCharging ? 'text-blue-400' : isDischarging ? 'text-red-400' : 'text-slate-400'} font-medium">
                  {isCharging ? 'CHARGE' : isDischarging ? 'INJECTION' : 'VEILLE'}
                </span>
              </div>
              <div class="flex justify-between">
                <span class="text-slate-400">Puissance</span>
                <span class="text-white font-medium">{formatPower(data.energy.ongrid_power)}</span>
              </div>
            </div>
          </div>

          <!-- Statistiques -->
          <div class="bg-slate-800 rounded-xl p-4 border border-slate-700">
            <h2 class="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
              <span>📈</span> Statistiques
            </h2>
            <div class="space-y-2 text-sm">
              <div class="flex justify-between">
                <span class="text-slate-400">Injecté</span>
                <span class="text-green-400 font-medium">{formatEnergy(data.energy.total_grid_output_energy)}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-slate-400">Consommé</span>
                <span class="text-yellow-400 font-medium">{formatEnergy(data.energy.total_grid_input_energy)}</span>
              </div>
              {#if true}
                {@const bilan = (data.energy.total_grid_output_energy ?? 0) - (data.energy.total_grid_input_energy ?? 0)}
                <div class="flex justify-between border-t border-slate-600 pt-2">
                  <span class="text-slate-300">Bilan</span>
                  <span class="{bilan > 0 ? 'text-green-400' : 'text-yellow-400'} font-bold">
                    {formatEnergy(bilan)}
                  </span>
                </div>
              {/if}
            </div>
          </div>

          <!-- Compteur CT -->
          {#if data.meter.ct_state === 1}
            <div class="bg-slate-800 rounded-xl p-4 border border-slate-700">
              <h2 class="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
                <span>📊</span> Compteur CT
              </h2>
              <div class="space-y-2 text-sm">
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
                <div class="border-t border-slate-600 pt-2 flex justify-between">
                  <span class="text-slate-300">Total</span>
                  <span class="text-cyan-400 font-bold">{formatPower(data.meter.total_power)}</span>
                </div>
              </div>
            </div>
          {/if}

          <!-- Connexion -->
          <div class="bg-slate-800 rounded-xl p-4 border border-slate-700">
            <h2 class="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
              <span>📡</span> Connexion
            </h2>
            <div class="space-y-2 text-sm">
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
              <div class="flex justify-between">
                <span class="text-slate-400">Appareil</span>
                <span class="text-white font-medium">{data.device.device} v{data.device.ver}</span>
              </div>
            </div>
          </div>
        </div>
      {/if}
    </div>
  {/if}

  <!-- Modal d'édition de plage horaire -->
  {#if showSlotModal && editingSlot}
    <div class="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div class="bg-slate-800 border border-slate-700 rounded-xl p-6 w-full max-w-md">
        <h3 class="text-xl font-bold text-white mb-4">
          Modifier la plage
        </h3>

        <div class="space-y-4">
          <!-- Mode -->
          <fieldset>
            <legend class="block text-slate-400 text-sm mb-2">Mode</legend>
            <div class="grid grid-cols-4 gap-2">
              <button
                type="button"
                onclick={() => editingSlot && (editingSlot.mode = 'Auto')}
                class="px-3 py-2 rounded-lg text-sm font-medium transition-all {editingSlot.mode === 'Auto' ? 'bg-cyan-500 text-white ring-2 ring-cyan-300' : 'bg-cyan-500/30 text-cyan-300 hover:bg-cyan-500/50'}"
              >
                Auto
              </button>
              <button
                type="button"
                onclick={() => editingSlot && (editingSlot.mode = 'AI')}
                class="px-3 py-2 rounded-lg text-sm font-medium transition-all {editingSlot.mode === 'AI' ? 'bg-purple-500 text-white ring-2 ring-purple-300' : 'bg-purple-500/30 text-purple-300 hover:bg-purple-500/50'}"
              >
                AI
              </button>
              <button
                type="button"
                onclick={() => editingSlot && (editingSlot.mode = 'Manual')}
                class="px-3 py-2 rounded-lg text-sm font-medium transition-all {editingSlot.mode === 'Manual' ? 'bg-yellow-500 text-white ring-2 ring-yellow-300' : 'bg-yellow-500/30 text-yellow-300 hover:bg-yellow-500/50'}"
              >
                Manual
              </button>
              <button
                type="button"
                onclick={() => editingSlot && (editingSlot.mode = 'Passive')}
                class="px-3 py-2 rounded-lg text-sm font-medium transition-all {editingSlot.mode === 'Passive' ? 'bg-green-500 text-white ring-2 ring-green-300' : 'bg-green-500/30 text-green-300 hover:bg-green-500/50'}"
              >
                Passive
              </button>
            </div>
          </fieldset>

          <!-- Heures (lecture seule - ajuster via drag sur le ruban) -->
          <div class="flex items-center gap-2 text-slate-400 text-sm">
            <span>{formatHour(editingSlot.startHour)}</span>
            <span class="flex-1 h-px bg-slate-600"></span>
            <span>{formatHour(editingSlot.endHour === 24 ? 0 : editingSlot.endHour)}</span>
          </div>

          <!-- Config spécifique si Manual ou Passive -->
          {#if editingSlot.mode === 'Manual' || editingSlot.mode === 'Passive'}
            <div class="border-t border-slate-600 pt-4 mt-4">
              <p class="text-slate-400 text-sm mb-3">Configuration {editingSlot.mode}</p>

              <!-- Direction -->
              <fieldset class="mb-3">
                <legend class="block text-slate-400 text-xs mb-1">Direction</legend>
                <div class="flex gap-2">
                  <button
                    type="button"
                    onclick={() => {
                      if (!editingSlot) return;
                      if (!editingSlot.config) editingSlot.config = {};
                      editingSlot.config.isCharge = true;
                      editingSlot = { ...editingSlot };
                    }}
                    class="flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors {editingSlot.config?.isCharge ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'}"
                  >
                    Charge
                  </button>
                  <button
                    type="button"
                    onclick={() => {
                      if (!editingSlot) return;
                      if (!editingSlot.config) editingSlot.config = {};
                      editingSlot.config.isCharge = false;
                      editingSlot = { ...editingSlot };
                    }}
                    class="flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors {editingSlot.config?.isCharge === false ? 'bg-red-600 text-white' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'}"
                  >
                    Décharge
                  </button>
                </div>
              </fieldset>

              <!-- Puissance -->
              <div class="mb-3">
                <label for="slot-power" class="block text-slate-400 text-xs mb-1">Puissance (W)</label>
                <input
                  id="slot-power"
                  type="number"
                  min="0"
                  max="2000"
                  step="100"
                  value={editingSlot.config?.power ?? 800}
                  onchange={(e) => {
                    if (!editingSlot) return;
                    if (!editingSlot.config) editingSlot.config = {};
                    editingSlot.config.power = parseInt((e.target as HTMLInputElement).value) || 800;
                    editingSlot = { ...editingSlot };
                  }}
                  class="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-cyan-500"
                />
              </div>

              <!-- Countdown pour Passive -->
              {#if editingSlot.mode === 'Passive'}
                <div>
                  <label for="slot-countdown" class="block text-slate-400 text-xs mb-1">Countdown (secondes)</label>
                  <input
                    id="slot-countdown"
                    type="number"
                    min="0"
                    max="86400"
                    step="60"
                    value={editingSlot.config?.cd_time ?? 300}
                    onchange={(e) => {
                      if (!editingSlot) return;
                      if (!editingSlot.config) editingSlot.config = {};
                      editingSlot.config.cd_time = parseInt((e.target as HTMLInputElement).value) || 300;
                      editingSlot = { ...editingSlot };
                    }}
                    class="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-cyan-500"
                  />
                </div>
              {/if}
            </div>
          {/if}
        </div>

        <div class="flex gap-2 mt-6">
          {#if timeSlots.length > 1}
            <button
              onclick={() => editingSlot && deleteSlot(editingSlot.id)}
              class="p-2 bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors"
              title="Supprimer cette plage"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          {/if}
          <button
            onclick={() => editingSlot && addSlotAfter(editingSlot)}
            class="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm font-medium rounded-lg transition-colors"
            title="Diviser cette plage en deux"
          >
            Diviser
          </button>
          <div class="flex-1"></div>
          <button
            onclick={() => { showSlotModal = false; editingSlot = null; }}
            class="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Annuler
          </button>
          {#if true}
            {@const needsConfig = editingSlot?.mode === 'Manual' || editingSlot?.mode === 'Passive'}
            {@const hasDirection = editingSlot?.config?.isCharge !== undefined}
            {@const canSave = !needsConfig || hasDirection}
            <button
              onclick={saveSlot}
              disabled={!canSave}
              class="px-3 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-600 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
              title={!canSave ? 'Choisir Charge ou Décharge' : ''}
            >
              Sauvegarder
            </button>
          {/if}
        </div>
      </div>
    </div>
  {/if}
</main>
