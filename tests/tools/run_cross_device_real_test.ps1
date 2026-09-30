param(
  [Parameter(Mandatory = $true)]
  [string]$ServerUrl,

  [Parameter(Mandatory = $false)]
  [string]$Username = "admin",

  [Parameter(Mandatory = $false)]
  [string]$Password = "admin",

  [Parameter(Mandatory = $false)]
  [switch]$Insecure,

  [Parameter(Mandatory = $false)]
  [switch]$CheckSse,

  [Parameter(Mandatory = $false)]
  [ValidateSet("all", "web_to_flutter", "flutter_to_web", "web_flutter_web", "flutter_web_flutter", "web_complete", "flutter_complete")]
  [string]$Scenario = "all"
)

$scriptPath = Join-Path $PSScriptRoot "cross_device_real_test.py"

$args = @(
  $scriptPath,
  "--server-url", $ServerUrl,
  "--username", $Username,
  "--password", $Password,
  "--scenario", $Scenario
)

if ($Insecure) {
  $args += "--insecure"
}

if ($CheckSse) {
  $args += "--check-sse"
}

Write-Host "[run] python $($args -join ' ')"
python @args
exit $LASTEXITCODE
