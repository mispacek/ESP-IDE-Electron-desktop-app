[CmdletBinding()]
param(
  [string] $BaseUrl = 'http://127.0.0.1/esp_ide_v2/',
  [string] $AddonPath = '..\addons',
  [switch] $SkipHttp
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

Push-Location $root
try {
  Write-Host '[1/5] JavaScript syntax and Blockly project tests'
  & node --check 'js/espide_ai_api.js'
  if ($LASTEXITCODE -ne 0) { throw 'espide_ai_api.js syntax check failed.' }
  & node --check 'js/espide_ai_mcp_bridge.js'
  if ($LASTEXITCODE -ne 0) { throw 'espide_ai_mcp_bridge.js syntax check failed.' }
  & node --check 'js/blockly_project_dependencies.js'
  if ($LASTEXITCODE -ne 0) { throw 'blockly_project_dependencies.js syntax check failed.' }
  & node --check 'tools/espide-mcp/src/server.mjs'
  if ($LASTEXITCODE -ne 0) { throw 'ESP IDE MCP server syntax check failed.' }
  & node --test 'js/blockly_project_dependencies.test.cjs' 'js/blockly_startup.test.cjs' 'js/service_worker_startup.test.cjs'
  if ($LASTEXITCODE -ne 0) { throw 'Blockly project tests failed.' }

  Write-Host '[2/5] MCP and ESPIDE_AI tests'
  if (-not (Test-Path 'tools/espide-mcp/node_modules')) {
    throw 'Missing tools/espide-mcp/node_modules. Run npm install in tools/espide-mcp first.'
  }
  Push-Location 'tools/espide-mcp'
  try {
    & npm test
    if ($LASTEXITCODE -ne 0) { throw 'MCP test suite failed.' }
  } finally {
    Pop-Location
  }

  Write-Host '[3/5] .newblk validation'
  & "$PSScriptRoot\validate-newblk.ps1" $AddonPath -Language en
  if ($LASTEXITCODE -ne 0) { throw '.newblk validation failed.' }

  Write-Host '[4/5] HTML and service-worker wiring'
  $index = Get-Content 'index.html' -Raw
  $serviceWorker = Get-Content 'sw.js' -Raw
  foreach ($asset in @('js/espide_ai_api.js', 'js/espide_ai_mcp_bridge.js', 'js/blockly_project_dependencies.js')) {
    if (-not $index.Contains($asset)) { throw "index.html does not load $asset" }
    if (-not $serviceWorker.Contains("'$asset'")) { throw "sw.js does not precache $asset" }
  }
  if ($index.Contains('window.__espideBlocklyAutomation = (function()')) {
    throw 'The old inline Blockly automation helper is still present in index.html.'
  }

  Write-Host '[5/5] Local HTTP assets'
  if ($SkipHttp) {
    Write-Host '  skipped'
  } else {
    foreach ($relative in @('', 'js/espide_ai_api.js', 'js/espide_ai_mcp_bridge.js', 'js/blockly_project_dependencies.js')) {
      $url = [Uri]::new([Uri]$BaseUrl, $relative).AbsoluteUri
      $response = Invoke-WebRequest -UseBasicParsing $url -TimeoutSec 10
      if ($response.StatusCode -ne 200) { throw "HTTP $($response.StatusCode): $url" }
      Write-Host "  HTTP 200 $url"
    }
  }

  Write-Host 'All local ESP IDE AI checks passed.'
} finally {
  Pop-Location
}
