# MarsTip

<p align="center">
  <img src="app/src-tauri/icons/icon.png" width="128" height="128" alt="MarsTip Logo">
</p>

<p align="center">
  <strong>Desktop monitoring app for Marstek batteries (Venus C/D/E)</strong>
</p>

<p align="center">
  <img src="app/MarsTip.gif" alt="MarsTip Demo" width="600">
</p>

<p align="center">
  <a href="#english">English</a> •
  <a href="#français">Français</a> •
  <a href="#download">Download</a>
</p>

---

## English

### About

MarsTip is a cross-platform desktop application for monitoring Marstek home batteries (Venus C, Venus D, Venus E series). It communicates directly with your battery over your local network via UDP, with no cloud dependency.

### Features

- **Auto-discovery** - Automatically detects Marstek batteries on your local network
- **Real-time monitoring** - Battery status, charge level, power flow, temperature
- **Energy statistics** - Solar production, grid import/export, total consumption
- **24h Scheduling** - Visual timeline with drag-and-drop to schedule operating modes (Auto, AI, Manual, Passive)
- **Multi-battery support** - Select and switch between multiple batteries
- **CT Meter support** - Three-phase power monitoring (if available)
- **Event logging** - Session logs for mode changes and errors
- **Bilingual** - Full English and French interface
- **Adaptive polling** - Automatically adjusts refresh rate based on response time
- **Offline** - Works entirely on your local network, no internet required

### Requirements

- Marstek Venus C, D, or E battery
- Battery connected to your local network (WiFi or Ethernet)
- Local API enabled via the official Marstek app
- Computer on the same network as the battery

### Tech Stack

- **Frontend**: SvelteKit + Svelte 5 + TailwindCSS v4
- **Backend**: Rust + Tauri 2.0
- **Protocol**: JSON-RPC over UDP (port 30000)

### Installation

Download the latest version: **[GitHub Releases](https://github.com/jsys/marstip/releases/latest)**

This app is not signed with an Apple or Microsoft certificate.

#### macOS

1. Download the `.dmg` file (Apple Silicon or Intel)
2. Open the `.dmg` file
3. Drag the MarsTip icon to the Applications folder
4. Open **Terminal.app** and run:
   ```
   xattr -c /Applications/MarsTip.app
   ```
5. Launch MarsTip from Applications

#### Windows

1. Download the `.exe` installer
2. Run the installer
3. When SmartScreen shows "Windows protected your PC":
   - Click "More info"
   - Click "Run anyway"
4. Launch MarsTip

#### First use

The app automatically detects your Marstek battery on the local network. If auto-detection fails, you can enter the battery's IP address manually.

---

## Français

### À propos

MarsTip est une application desktop multi-plateforme pour surveiller les batteries domestiques Marstek (séries Venus C, Venus D, Venus E). Elle communique directement avec votre batterie via votre réseau local en UDP, sans dépendance au cloud.

### Fonctionnalités

- **Auto-détection** - Détecte automatiquement les batteries Marstek sur votre réseau local
- **Monitoring temps réel** - État de la batterie, niveau de charge, flux d'énergie, température
- **Statistiques énergie** - Production solaire, import/export réseau, consommation totale
- **Planification 24h** - Timeline visuelle avec glisser-déposer pour programmer les modes (Auto, AI, Manuel, Passif)
- **Multi-batteries** - Sélectionnez et basculez entre plusieurs batteries
- **Support CT Meter** - Monitoring triphasé (si disponible)
- **Journal d'événements** - Logs de session pour les changements de mode et erreurs
- **Bilingue** - Interface complète en français et anglais
- **Polling adaptatif** - Ajuste automatiquement le taux de rafraîchissement selon le temps de réponse
- **Hors-ligne** - Fonctionne entièrement sur votre réseau local, pas d'internet requis

### Prérequis

- Batterie Marstek Venus C, D ou E
- Batterie connectée à votre réseau local (WiFi ou Ethernet)
- API locale activée via l'application officielle Marstek
- Ordinateur sur le même réseau que la batterie

### Stack technique

- **Frontend**: SvelteKit + Svelte 5 + TailwindCSS v4
- **Backend**: Rust + Tauri 2.0
- **Protocole**: JSON-RPC sur UDP (port 30000)

### Installation

Télécharger la dernière version : **[GitHub Releases](https://github.com/jsys/marstip/releases/latest)**

Cette application n'est pas signée avec un certificat Apple ou Microsoft.

#### macOS

1. Télécharger le fichier `.dmg` (Apple Silicon ou Intel)
2. Ouvrir le fichier `.dmg`
3. Glisser l'icône MarsTip dans le dossier Applications
4. Ouvrir **Terminal.app** et exécuter :
   ```
   xattr -c /Applications/MarsTip.app
   ```
5. Lancer MarsTip depuis Applications

#### Windows

1. Télécharger l'installeur `.exe`
2. Lancer l'installeur
3. Quand SmartScreen affiche "Windows a protégé votre ordinateur" :
   - Cliquer sur "Informations complémentaires"
   - Cliquer sur "Exécuter quand même"
4. Lancer MarsTip

#### Première utilisation

L'application détecte automatiquement votre batterie Marstek sur le réseau local. Si la détection automatique échoue, vous pouvez saisir l'adresse IP de la batterie manuellement.

---

## Download

### Latest Release

| Platform | Download |
|----------|----------|
| **macOS Apple Silicon** (M1/M2/M3) | [MarsTip_x.x.x_aarch64.dmg](https://github.com/jsys/marstip/releases/latest) |
| **macOS Intel** | [MarsTip_x.x.x_x64.dmg](https://github.com/jsys/marstip/releases/latest) |
| **Windows** | [MarsTip_x.x.x_x64-setup.exe](https://github.com/jsys/marstip/releases/latest) |
| **Linux (Debian/Ubuntu)** | [marstip_x.x.x_amd64.deb](https://github.com/jsys/marstip/releases/latest) |
| **Linux (AppImage)** | [marstip_x.x.x_amd64.AppImage](https://github.com/jsys/marstip/releases/latest) |

> All releases are available on the [Releases page](https://github.com/jsys/marstip/releases).

### Build from source

```bash
# Clone the repository
git clone https://github.com/jsys/marstip.git
cd marstip/app

# Install dependencies
npm install

# Run in development mode
npm run tauri dev

# Build for production
npm run tauri build
```

---

## License

This project is licensed under the **GNU General Public License v3.0** - see the [LICENSE](LICENSE) file for details.

---

## Disclaimer

This project is not affiliated with, endorsed by, or connected to Marstek in any way. Marstek is a trademark of its respective owner. Use at your own risk.
