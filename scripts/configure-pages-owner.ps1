param(
  [switch]$Init,
  [switch]$Preview,
  [switch]$Upload,
  [string]$EnvFile = ".tmp\pages-owner.local.env"
)

$ErrorActionPreference = "Stop"
Set-Location (Resolve-Path (Join-Path $PSScriptRoot ".."))

$required = @(
  "PAGES_OPERATOR_NAME",
  "PAGES_OPERATOR_STREET",
  "PAGES_OPERATOR_CITY",
  "PAGES_OPERATOR_COUNTRY",
  "PAGES_PUBLIC_EMAIL"
)

$optional = @(
  "PAGES_PUBLIC_PHONE",
  "PAGES_VAT_ID",
  "PAGES_EDITORIAL_RESPONSIBLE_NAME",
  "PAGES_EDITORIAL_RESPONSIBLE_ADDRESS"
)

function Ensure-Template {
  $dir = Split-Path -Parent $EnvFile
  if ($dir) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }

  if (-not (Test-Path $EnvFile)) {
    @"
PAGES_OPERATOR_NAME=
PAGES_OPERATOR_STREET=
PAGES_OPERATOR_CITY=
PAGES_OPERATOR_COUNTRY=Deutschland
PAGES_PUBLIC_EMAIL=
PAGES_PUBLIC_PHONE=
PAGES_VAT_ID=
PAGES_EDITORIAL_RESPONSIBLE_NAME=
PAGES_EDITORIAL_RESPONSIBLE_ADDRESS=
"@ | Set-Content -Encoding UTF8 $EnvFile
  }
}

function Read-Values {
  if (-not (Test-Path $EnvFile)) {
    throw "Missing $EnvFile. Run with -Init first."
  }

  $values = @{}
  Get-Content $EnvFile | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#")) { return }
    $parts = $line -split "=", 2
    if ($parts.Count -eq 2) {
      $values[$parts[0].Trim()] = $parts[1].Trim()
    }
  }

  $missing = @()
  foreach ($name in $required) {
    if (-not $values.ContainsKey($name) -or [string]::IsNullOrWhiteSpace($values[$name])) {
      $missing += $name
    }
  }
  if ($missing.Count -gt 0) {
    throw ("Missing required values: " + ($missing -join ", "))
  }

  return $values
}

function With-ProcessEnvironment([hashtable]$values, [scriptblock]$action) {
  $all = $required + $optional
  try {
    foreach ($name in $all) {
      $value = if ($values.ContainsKey($name)) { $values[$name] } else { "" }
      [Environment]::SetEnvironmentVariable($name, $value, "Process")
    }
    & $action
  }
  finally {
    foreach ($name in $all) {
      [Environment]::SetEnvironmentVariable($name, $null, "Process")
    }
  }
}

if (-not $Init -and -not $Preview -and -not $Upload) {
  $Init = $true
}

if ($Init) {
  Ensure-Template
  Write-Host "Opened local operator-data file. Fill only real public details, save, then close Notepad."
  Start-Process notepad.exe (Resolve-Path $EnvFile)
}

if ($Preview) {
  $values = Read-Values
  With-ProcessEnvironment $values {
    node scripts/build-pages-site.mjs
    if ($LASTEXITCODE -ne 0) { throw "Site build failed." }
  }
  Write-Host "Local preview generated in .pages\ . Personal details were not committed."
}

if ($Upload) {
  $values = Read-Values

  gh auth status *> $null
  if ($LASTEXITCODE -ne 0) {
    throw "GitHub CLI is not authenticated. Run 'gh auth login' first."
  }

  foreach ($name in $required + $optional) {
    $value = if ($values.ContainsKey($name)) { $values[$name] } else { "" }

    if ([string]::IsNullOrWhiteSpace($value)) {
      if ($optional -contains $name) {
        gh secret delete $name --repo mrAibo/PRICE_LENS 2>$null
      }
      continue
    }

    $value | gh secret set $name --repo mrAibo/PRICE_LENS *> $null
    if ($LASTEXITCODE -ne 0) {
      throw "Failed to upload GitHub Actions secret $name."
    }
    Write-Host "Uploaded $name"
  }

  Write-Host "GitHub Actions operator secrets configured. No secret values were printed."
  exit 0
}
