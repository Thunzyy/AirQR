param(
  [Parameter(Mandatory = $false)]
  [ValidateSet("dev", "prod")]
  [string]$Environment = "dev",

  [Parameter(Mandatory = $false)]
  [string]$WebAppUrl = "",

  [Parameter(Mandatory = $false)]
  [string]$ApiUrl = "",

  [Parameter(Mandatory = $false)]
  [string]$Username = "admin",

  [Parameter(Mandatory = $false)]
  [string]$Password = "admin",

  [Parameter(Mandatory = $false)]
  [int]$BackgroundSeconds = 10,

  [Parameter(Mandatory = $false)]
  [int]$VisibilityTimeoutSeconds = 90,

  [Parameter(Mandatory = $false)]
  [int]$PacketCount = 192,

  [Parameter(Mandatory = $false)]
  [int]$PacketSize = 4096,

  [Parameter(Mandatory = $false)]
  [int]$WebSocketDelayMs = 80,

  [Parameter(Mandatory = $false)]
  [switch]$Insecure,

  [Parameter(Mandatory = $false)]
  [switch]$ListOnly
)

$ErrorActionPreference = "Stop"

$defaultDevWebUrl = "https://192.168.1.100:5173"
$defaultDevApiUrl = "https://192.168.1.100:8081"
$defaultProdUrl = "https://your-domain.example.com"

if (-not $WebAppUrl -or -not $ApiUrl) {
  if ($Environment -eq "prod") {
    $defaultWebUrl = $defaultProdUrl
    $defaultApiUrl = $defaultProdUrl
  } else {
    $defaultWebUrl = $defaultDevWebUrl
    $defaultApiUrl = $defaultDevApiUrl
  }
  if (-not $WebAppUrl) {
    $WebAppUrl = $defaultWebUrl
  }
  if (-not $ApiUrl) {
    $ApiUrl = $defaultApiUrl
  }
}

function Test-WebUiAvailable([string]$BaseUrl) {
  $tmpFile = [System.IO.Path]::GetTempFileName()
  try {
    & curl.exe -k -s -L $("$BaseUrl/history") -o $tmpFile | Out-Null
    $body = ""
    if (Test-Path $tmpFile) {
      $body = Get-Content -Path $tmpFile -Raw -ErrorAction SilentlyContinue
    }
    if (-not $body) {
      return @{ ok = $false; reason = "empty response body from $BaseUrl/history" }
    }
    if ($body -match "Cloudflare Access|yourorg\.cloudflareaccess\.com|Sign in with:") {
      return @{ ok = $false; reason = "Cloudflare Access login detected on $BaseUrl/history" }
    }
    if ($body -match '"error"\s*:\s*"Not found"' -or $body.Trim().StartsWith("{")) {
      return @{ ok = $false; reason = "$BaseUrl points to API/not-found response, not web UI" }
    }
    if ($body -match '<html|<!doctype html|<body|<div id="root"') {
      return @{ ok = $true; reason = "web UI reachable" }
    }
    return @{ ok = $false; reason = "response does not look like web UI HTML" }
  }
  finally {
    if (Test-Path $tmpFile) {
      Remove-Item -Path $tmpFile -Force -ErrorAction SilentlyContinue
    }
  }
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$webDir = Join-Path $repoRoot "apps\web"
$backgroundMs = $BackgroundSeconds * 1000
$visibilityTimeoutMs = $VisibilityTimeoutSeconds * 1000

Write-Host "[info] web app url: $WebAppUrl"
Write-Host "[info] api url: $ApiUrl"
Write-Host "[info] background seconds: $BackgroundSeconds"
Write-Host "[info] visibility timeout seconds: $VisibilityTimeoutSeconds"

$commandPreview = @(
  "npm run test:ui:background:manual"
)

if ($ListOnly) {
  Write-Host "[info] list-only mode"
  Write-Host "[info] command: $($commandPreview -join ' ')"
  Write-Host "[info] AIRQR_UI_BASE_URL=$WebAppUrl"
  Write-Host "[info] AIRQR_API_BASE_URL=$ApiUrl"
  Write-Host "[info] AIRQR_MANUAL_BACKGROUND_MS=$backgroundMs"
  Write-Host "[info] AIRQR_MANUAL_VISIBILITY_TIMEOUT_MS=$visibilityTimeoutMs"
  Write-Host "[info] AIRQR_MANUAL_PACKET_COUNT=$PacketCount"
  Write-Host "[info] AIRQR_MANUAL_PACKET_SIZE=$PacketSize"
  Write-Host "[info] AIRQR_MANUAL_WS_DELAY_MS=$WebSocketDelayMs"
  exit 0
}

$webProbe = Test-WebUiAvailable -BaseUrl $WebAppUrl
if (-not $webProbe.ok) {
  Write-Host "[fail] $($webProbe.reason)"
  exit 1
}

Write-Host "[step] Launching headed manual browser validation..."
Write-Host "[step] When prompted in the browser overlay, background the real browser tab/window for at least $BackgroundSeconds seconds, then return."

Push-Location $webDir
try {
  $env:AIRQR_UI_BASE_URL = $WebAppUrl
  $env:AIRQR_API_BASE_URL = $ApiUrl
  $env:AIRQR_USERNAME = $Username
  $env:AIRQR_PASSWORD = $Password
  $env:AIRQR_MANUAL_BACKGROUND_MS = "$backgroundMs"
  $env:AIRQR_MANUAL_VISIBILITY_TIMEOUT_MS = "$visibilityTimeoutMs"
  $env:AIRQR_MANUAL_PACKET_COUNT = "$PacketCount"
  $env:AIRQR_MANUAL_PACKET_SIZE = "$PacketSize"
  $env:AIRQR_MANUAL_WS_DELAY_MS = "$WebSocketDelayMs"
  if ($Insecure) {
    $env:NODE_TLS_REJECT_UNAUTHORIZED = "0"
  }

  & npm run test:ui:background:manual
  exit $LASTEXITCODE
}
finally {
  Pop-Location
}
