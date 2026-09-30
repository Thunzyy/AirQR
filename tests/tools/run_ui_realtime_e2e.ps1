param(
  [Parameter(Mandatory = $false)]
  [ValidateSet("dev", "prod")]
  [string]$Environment = "dev",

  [Parameter(Mandatory = $false)]
  [string]$WebAppUrl = "",

  [Parameter(Mandatory = $false)]
  [string]$ApiUrl = "",

  [Parameter(Mandatory = $false)]
  [string]$DeviceApiUrl = "",

  [Parameter(Mandatory = $false)]
  [string]$Username = "admin",

  [Parameter(Mandatory = $false)]
  [string]$Password = "admin",

  [Parameter(Mandatory = $false)]
  [string]$AndroidDevice = "",

  [Parameter(Mandatory = $false)]
  [switch]$Insecure,

  [Parameter(Mandatory = $false)]
  [switch]$SkipWeb,

  [Parameter(Mandatory = $false)]
  [switch]$SkipFlutter,

  [Parameter(Mandatory = $false)]
  [switch]$SkipServerReal,

  [Parameter(Mandatory = $false)]
  [switch]$RequireWeb
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

function Ensure-Dir([string]$Path) {
  if (-not (Test-Path $Path)) {
    New-Item -ItemType Directory -Path $Path | Out-Null
  }
}

function Test-WebUiAvailable([string]$BaseUrl) {
  $tmpFile = [System.IO.Path]::GetTempFileName()
  try {
    # Follow redirects and ignore TLS issues for local/self-signed setups.
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

function Resolve-AndroidDevice() {
  $lines = (& adb devices) -split "`n" | ForEach-Object { $_.Trim() }
  $devices = @()
  foreach ($line in $lines) {
    if ($line -match "^\S+\s+device$") {
      $devices += ($line -split "\s+")[0]
    }
  }
  if ($devices.Count -gt 0) {
    return $devices[0]
  }
  return ""
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$artifactRoot = Join-Path $repoRoot "artifacts\ui-e2e\$timestamp"

Ensure-Dir $artifactRoot
Ensure-Dir (Join-Path $artifactRoot "web")
Ensure-Dir (Join-Path $artifactRoot "flutter")
Ensure-Dir (Join-Path $artifactRoot "server")

$overallExit = 0

if (-not $DeviceApiUrl) {
  $DeviceApiUrl = $ApiUrl
}

Write-Host "[info] artifact root: $artifactRoot"
Write-Host "[info] environment: $Environment"
Write-Host "[info] web app url: $WebAppUrl"
Write-Host "[info] api url: $ApiUrl"
Write-Host "[info] device api url: $DeviceApiUrl"

if ($ApiUrl -match "https?://192\.168\." -and $DeviceApiUrl -eq $ApiUrl) {
  Write-Host "[warn] ApiUrl is private LAN IP. If Android device is not on same LAN/VPN, Flutter test will timeout."
  Write-Host "[warn] Use -DeviceApiUrl with a URL reachable from the phone (e.g. domain/tunnel URL)."
}

if (-not $SkipServerReal) {
  Write-Host "[step] Running real cross-device server test (API + SSE)..."
  $serverLog = Join-Path $artifactRoot "server\cross-device-real.log"
  $serverArgs = @(
    "tests/tools/cross_device_real_test.py",
    "--server-url", $ApiUrl,
    "--username", $Username,
    "--password", $Password,
    "--scenario", "all",
    "--check-sse"
  )
  if ($Insecure) {
    $serverArgs += "--insecure"
  }

  Push-Location $repoRoot
  try {
    & python @serverArgs *>&1 | Tee-Object -FilePath $serverLog
    if ($LASTEXITCODE -ne 0) {
      Write-Host "[fail] Real cross-device server test failed with code $LASTEXITCODE"
      $overallExit = 1
    } else {
      Write-Host "[ok] Real cross-device server test passed"
    }
  }
  finally {
    Pop-Location
  }
}

if (-not $SkipWeb) {
  $webProbe = Test-WebUiAvailable -BaseUrl $WebAppUrl
  if (-not $webProbe.ok) {
    $msg = "[warn] Skipping Web Playwright test: $($webProbe.reason)"
    if ($RequireWeb) {
      Write-Host ("[fail] " + $msg.Substring(7))
      $overallExit = 1
    } else {
      Write-Host $msg
    }
  } else {
    Write-Host "[step] Running Web Playwright realtime UI test..."

    $webDir = Join-Path $repoRoot "apps\web"
    Push-Location $webDir
    try {
      $env:AIRQR_UI_BASE_URL = $WebAppUrl
      $env:AIRQR_API_BASE_URL = $ApiUrl
      $env:AIRQR_USERNAME = $Username
      $env:AIRQR_PASSWORD = $Password
      $env:PLAYWRIGHT_HTML_REPORT = (Join-Path $artifactRoot "web\playwright-report")
      $env:PLAYWRIGHT_HTML_OPEN = "never"
      if ($Insecure) {
        $env:NODE_TLS_REJECT_UNAUTHORIZED = "0"
      }

      $pwLog = Join-Path $artifactRoot "web\playwright.log"
      $pwOut = Join-Path $artifactRoot "web\test-results"
      Ensure-Dir $pwOut

      & npx playwright test --workers=1 --reporter=line,html --output $pwOut *>&1 | Tee-Object -FilePath $pwLog
      if ($LASTEXITCODE -ne 0) {
        Write-Host "[fail] Web Playwright test failed with code $LASTEXITCODE"
        $overallExit = 1
      } else {
        Write-Host "[ok] Web Playwright test passed"
      }
    }
    finally {
      Pop-Location
    }
  }
}

if (-not $SkipFlutter) {
  Write-Host "[step] Running Flutter integration realtime UI test..."

  if (-not $AndroidDevice) {
    $AndroidDevice = Resolve-AndroidDevice
  }

  if (-not $AndroidDevice) {
    Write-Host "[fail] No Android device detected. Use -AndroidDevice <serial>."
    $overallExit = 1
  } else {
    Write-Host "[info] using Android device: $AndroidDevice"
    $flutterDir = Join-Path $repoRoot "apps\flutter"
    Push-Location $flutterDir
    $logcatProc = $null
    try {
      $logcatOut = Join-Path $artifactRoot "flutter\adb-logcat.txt"
      $logcatErr = Join-Path $artifactRoot "flutter\adb-logcat.err.txt"
      $flutterLog = Join-Path $artifactRoot "flutter\flutter-integration.log"

      & adb -s $AndroidDevice logcat -c | Out-Null
      $logcatProc = Start-Process -FilePath "adb" -ArgumentList @("-s", $AndroidDevice, "logcat") -NoNewWindow -RedirectStandardOutput $logcatOut -RedirectStandardError $logcatErr -PassThru

      $insecureFlag = if ($Insecure) { "true" } else { "false" }
      & flutter test integration_test/cross_device_realtime_test.dart -d $AndroidDevice "--dart-define=AIRQR_TEST_SERVER_URL=$DeviceApiUrl" "--dart-define=AIRQR_TEST_USERNAME=$Username" "--dart-define=AIRQR_TEST_PASSWORD=$Password" "--dart-define=AIRQR_TEST_INSECURE=$insecureFlag" --reporter expanded *>&1 | Tee-Object -FilePath $flutterLog

      if ($LASTEXITCODE -ne 0) {
        $flutterOutput = ""
        if (Test-Path $flutterLog) {
          $flutterOutput = Get-Content -Path $flutterLog -Raw -ErrorAction SilentlyContinue
        }
        if ($flutterOutput -match "INSTALL_FAILED_USER_RESTRICTED") {
          Write-Host "[fail] Flutter install blocked by Android policy (INSTALL_FAILED_USER_RESTRICTED)."
          Write-Host "[fail] On device, enable developer options allowing USB installs and confirm install prompts."
        }
        Write-Host "[fail] Flutter integration test failed with code $LASTEXITCODE"
        $overallExit = 1
      } else {
        Write-Host "[ok] Flutter integration test passed"
      }
    }
    finally {
      if ($logcatProc -and -not $logcatProc.HasExited) {
        Stop-Process -Id $logcatProc.Id -Force
      }
      Pop-Location
    }
  }
}

Write-Host ""
Write-Host "========== UI E2E SUMMARY =========="
Write-Host "Artifacts: $artifactRoot"
Write-Host "Web logs: $artifactRoot\web\playwright.log"
Write-Host "Web report: $artifactRoot\web\playwright-report\index.html"
Write-Host "Flutter logs: $artifactRoot\flutter\flutter-integration.log"
Write-Host "ADB logcat: $artifactRoot\flutter\adb-logcat.txt"
Write-Host "Server real test logs: $artifactRoot\server\cross-device-real.log"
Write-Host "===================================="

exit $overallExit
