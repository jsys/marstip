# Build MarsTip on Windows

This guide explains how to set up a Windows PC from scratch to compile MarsTip.

## Prerequisites

Install the following in order:

### 1. Git
Download and install: https://git-scm.com/download/win

### 2. Node.js (LTS)
Download and install: https://nodejs.org/
- Choose the LTS version (recommended)
- During install, check "Automatically install necessary tools" if prompted

### 3. Rust
Download and install: https://rustup.rs/
- Run the installer and follow the prompts
- Choose default installation

### 4. Visual Studio Build Tools
Download: https://visualstudio.microsoft.com/visual-cpp-build-tools/
- Run the installer
- Select **"Desktop development with C++"**
- Click Install (this may take a while)

### 5. WebView2 Runtime
Usually pre-installed on Windows 10/11. If not:
https://developer.microsoft.com/en-us/microsoft-edge/webview2/

## Build Steps

Open **PowerShell** or **Command Prompt** and run:

```powershell
# Clone the repository
git clone https://github.com/jsys/marstip.git
cd marstip/app

# Install pnpm (package manager)
npm install -g pnpm

# Install dependencies
pnpm install

# Run in development mode (with hot reload)
pnpm tauri dev

# OR build for production
pnpm tauri build
```

## Output

After `pnpm tauri build`, the installer will be in:
```
app/src-tauri/target/release/bundle/nsis/MarsTip_x.x.x_x64-setup.exe
```

## Troubleshooting

### "cargo not found"
Restart your terminal after installing Rust, or run:
```powershell
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
```

### Build fails with linker errors
Make sure Visual Studio Build Tools is installed with "Desktop development with C++".

### WebView2 errors
Install WebView2 Runtime manually from the link above.
