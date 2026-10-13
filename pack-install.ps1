# Repack install.zip from dist/ + top-level plugin.json
$ErrorActionPreference = "Stop"
$root = "D:\works\myworks\fat-games"
$dist = Join-Path $root "dist"
$plugin = Join-Path $root "plugin.json"
$zip = Join-Path $root "install.zip"

if (-not (Test-Path $dist)) { throw "dist not found: $dist" }
if (-not (Test-Path $plugin)) { throw "plugin.json not found: $plugin" }

# staging dir with dist contents + plugin.json at top level
$staging = Join-Path $env:TEMP ("fat-games-pack-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $staging -Force | Out-Null
Copy-Item -Path (Join-Path $dist "*") -Destination $staging -Recurse -Force
Copy-Item -Path $plugin -Destination $staging -Force

# retry loop for lock-protected files
$max = 5
for ($i = 1; $i -le $max; $i++) {
    try {
        if (Test-Path $zip) { Remove-Item -Path $zip -Force }
        Compress-Archive -Path (Join-Path $staging "*") -DestinationPath $zip -CompressionLevel Optimal -Force
        break
    } catch {
        if ($i -eq $max) { throw }
        Start-Sleep -Seconds 2
    }
}
Remove-Item -Path $staging -Recurse -Force
$len = (Get-Item $zip).Length
Write-Output ("install.zip ready: {0} bytes" -f $len)
