param(
  [switch]$SkipWebBuild
)

$ErrorActionPreference = "Stop"
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$webDir = Join-Path $repoRoot "apps\web"

Write-Host "== AirQR Cross-Device Reliability Test Suite ==" -ForegroundColor Cyan

Push-Location $webDir
try {
  if (-not $SkipWebBuild) {
    Write-Host "[1/4] Building web app..." -ForegroundColor Yellow
    npm run build
  }

  Write-Host "[2/4] Running web deterministic sync tests..." -ForegroundColor Yellow
  npm run test -- incompleteSync.test.ts websocketSyncService.test.ts
}
finally {
  Pop-Location
}

Write-Host "[3/4] Running sync-server cross-device integration tests..." -ForegroundColor Yellow
python -m pytest tests/python/sync_server/test_cross_device_reliability.py -q

Write-Host "[4/4] Cross-device test suite completed." -ForegroundColor Green
