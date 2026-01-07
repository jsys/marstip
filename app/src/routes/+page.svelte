<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';

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

  async function fetchData() {
    try {
      if (window.__TAURI__) {
        data = await invoke<DashboardData>('get_dashboard');
      } else {
        const res = await fetch('/api/dashboard');
        data = await res.json();
      }
      error = null;
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    fetchData();
    interval = setInterval(fetchData, 3000);
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
  <header class="mb-8">
    <h1 class="text-3xl font-bold text-white flex items-center gap-3">
      <span class="text-4xl">⚡</span>
      Marstek Dashboard
    </h1>
    {#if data}
      <p class="text-slate-400 mt-1">
        {data.device.device} v{data.device.ver} • Mis à jour: {data.timestamp}
      </p>
    {/if}
  </header>

  {#if loading}
    <div class="flex items-center justify-center h-64">
      <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-500"></div>
    </div>
  {:else if error}
    <div class="bg-red-900/50 border border-red-500 rounded-xl p-6 text-red-200">
      <h3 class="font-bold text-lg mb-2">Erreur de connexion</h3>
      <p>{error}</p>
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
