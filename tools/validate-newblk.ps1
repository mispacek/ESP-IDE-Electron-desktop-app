[CmdletBinding()]
param(
  [Parameter(Mandatory = $true, Position = 0, ValueFromPipeline = $true)]
  [string[]] $Path,

  [ValidateSet('cs', 'en')]
  [string] $Language = 'cs',

  [switch] $Json
)

$ErrorActionPreference = 'Stop'
$results = @()

function Add-Issue {
  param(
    [System.Collections.Generic.List[object]] $List,
    [string] $Severity,
    [string] $Code,
    [string] $MessageCs,
    [string] $MessageEn,
    [object] $Details = $null
  )
  $List.Add([pscustomobject]@{
    severity = $Severity
    code = $Code
    messageCs = $MessageCs
    messageEn = $MessageEn
    details = $Details
  })
}

function Find-AddonFiles {
  param([string[]] $InputPaths)
  $files = [System.Collections.Generic.List[string]]::new()
  foreach ($inputPath in $InputPaths) {
    $resolvedItems = @(Resolve-Path -Path $inputPath -ErrorAction Stop)
    foreach ($resolved in $resolvedItems) {
      $item = Get-Item -LiteralPath $resolved.Path
      if ($item.PSIsContainer) {
        Get-ChildItem -LiteralPath $item.FullName -Filter '*.newblk' -File | ForEach-Object { $files.Add($_.FullName) }
      } else {
        $files.Add($item.FullName)
      }
    }
  }
  return @($files | Sort-Object -Unique)
}

function Get-JsNames {
  param([string] $Source, [string] $Namespace)
  $escaped = [regex]::Escape($Namespace)
  $patterns = @(
    ('{0}\s*\[\s*[''\"](?<name>[A-Za-z0-9_\-]+)[''\"]\s*\]\s*=' -f $escaped),
    ('{0}\.(?<name>[A-Za-z_][A-Za-z0-9_]*)\s*=' -f $escaped)
  )
  $names = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
  foreach ($pattern in $patterns) {
    foreach ($match in [regex]::Matches($Source, $pattern)) {
      [void]$names.Add($match.Groups['name'].Value)
    }
  }
  return $names
}

function Validate-AddonFile {
  param([string] $FilePath)

  $issues = [System.Collections.Generic.List[object]]::new()
  $raw = Get-Content -LiteralPath $FilePath -Raw -Encoding UTF8
  $delimiter = '<!toolbox!>'
  $delimiterCount = ([regex]::Matches($raw, [regex]::Escape($delimiter))).Count
  $metadata = $null
  $jsPart = ''
  $xmlPart = ''
  $xmlDocument = $null

  if ([System.IO.Path]::GetExtension($FilePath) -ne '.newblk') {
    Add-Issue $issues 'error' 'FILE_EXTENSION' 'Soubor nemá příponu .newblk.' 'The file does not have the .newblk extension.'
  }

  if ($delimiterCount -ne 1) {
    Add-Issue $issues 'error' 'DELIMITER_COUNT' "Delimiter <!toolbox!> musí být právě jednou; nalezeno: $delimiterCount." "The <!toolbox!> delimiter must occur exactly once; found: $delimiterCount." @{ count = $delimiterCount }
  } else {
    $parts = $raw.Split(@($delimiter), 2, [System.StringSplitOptions]::None)
    $jsPart = $parts[0]
    $xmlPart = $parts[1]

    # Windows PowerShell truncates long scalar strings piped to a native
    # process. Real-world add-ons commonly exceed that limit, so validate the
    # complete JavaScript through a temporary UTF-8 file instead of stdin.
    $syntaxFile = Join-Path ([System.IO.Path]::GetTempPath()) ("espide-newblk-{0}.js" -f [guid]::NewGuid().ToString('N'))
    try {
      [System.IO.File]::WriteAllText($syntaxFile, $jsPart, [System.Text.UTF8Encoding]::new($false))
      $syntaxOutput = @(& node --check $syntaxFile 2>&1)
      if ($LASTEXITCODE -ne 0) {
        Add-Issue $issues 'error' 'JS_SYNTAX' 'JavaScript část neprošla kontrolou syntaxe.' 'The JavaScript section failed syntax validation.' ($syntaxOutput -join "`n")
      }
    } finally {
      Remove-Item -LiteralPath $syntaxFile -Force -ErrorAction SilentlyContinue
    }

    try {
      $xmlDocument = [System.Xml.XmlDocument]::new()
      $xmlDocument.PreserveWhitespace = $true
      $xmlDocument.LoadXml("<xml>$xmlPart</xml>")
    } catch {
      Add-Issue $issues 'error' 'XML_PARSE' 'Toolbox část není platné XML.' 'The toolbox section is not valid XML.' $_.Exception.Message
    }
  }

  $metadataMatch = [regex]::Match($jsPart, '(?s)/\*\s*(?<json>\{.*?\})\s*\*/')
  if ($metadataMatch.Success) {
    try {
      $metadata = $metadataMatch.Groups['json'].Value | ConvertFrom-Json
    } catch {
      $relaxedJson = [regex]::Replace($metadataMatch.Groups['json'].Value, ',\s*([}\]])', '$1')
      try {
        $metadata = $relaxedJson | ConvertFrom-Json
        Add-Issue $issues 'warning' 'METADATA_TRAILING_COMMA' 'Metadata obsahují koncovou čárku; IDE je může tolerovat, ale validní JSON ji nepovoluje.' 'Metadata contain a trailing comma; the IDE may tolerate it, but valid JSON does not.'
      } catch {
        Add-Issue $issues 'error' 'METADATA_JSON' 'Metadata v úvodním komentáři nejsou platné JSON.' 'Metadata in the leading comment are not valid JSON.' $_.Exception.Message
      }
    }
  } else {
    Add-Issue $issues 'warning' 'METADATA_MISSING' 'Doplněk nemá rozpoznatelnou JSON metadata hlavičku.' 'The add-on has no recognizable JSON metadata header.'
  }

  if ($metadata) {
    foreach ($required in @('id', 'name', 'description', 'version', 'author')) {
      if (-not $metadata.PSObject.Properties[$required] -or [string]::IsNullOrWhiteSpace([string]$metadata.$required)) {
        Add-Issue $issues 'warning' 'METADATA_FIELD_MISSING' "V metadatech chybí položka '$required'." "Metadata field '$required' is missing." @{ field = $required }
      }
    }
    if ($metadata.example -and ([string]$metadata.example -notmatch '^[A-Z0-9]{6}$')) {
      Add-Issue $issues 'error' 'EXAMPLE_CODE' 'Metadata example musí být šest znaků A-Z nebo 0-9.' 'The example metadata must contain six A-Z or 0-9 characters.' @{ value = $metadata.example }
    }
    if ($metadata.toolbox_mode -and $metadata.toolbox_mode -ne 'addon_only') {
      Add-Issue $issues 'warning' 'TOOLBOX_MODE_UNKNOWN' "Neznámá hodnota toolbox_mode: $($metadata.toolbox_mode)." "Unknown toolbox_mode value: $($metadata.toolbox_mode)."
    }
  }

  if ($xmlDocument) {
    $normalBlocksInShadow = @($xmlDocument.SelectNodes('//shadow//block'))
    foreach ($node in $normalBlocksInShadow) {
      Add-Issue $issues 'error' 'SHADOW_NON_SHADOW_CHILD' 'Shadow obsahuje běžný block; Blockly hlásí Shadow block not allowed non-shadow child.' 'A shadow contains a normal block; Blockly reports Shadow block not allowed non-shadow child.' @{ type = $node.GetAttribute('type') }
    }

    $variableFieldsInShadow = @($xmlDocument.SelectNodes('//shadow//field')) | Where-Object { $_.GetAttribute('name') -match '^(VAR|VARIABLE|VAR_NAME)$' }
    foreach ($node in $variableFieldsInShadow) {
      Add-Issue $issues 'error' 'SHADOW_VARIABLE_REFERENCE' 'Shadow obsahuje odkaz na proměnnou; Blockly shadow bloky proměnné nepovolují.' 'A shadow contains a variable reference; Blockly shadow blocks cannot reference variables.' @{ field = $node.GetAttribute('name') }
    }

    foreach ($node in @($xmlDocument.SelectNodes('//*[@data-name-cs or @data-name-en or @data-text-cs or @data-text-en or @data-value-cs or @data-value-en]'))) {
      foreach ($pair in @(@('data-name-cs', 'data-name-en'), @('data-text-cs', 'data-text-en'), @('data-value-cs', 'data-value-en'))) {
        $hasCs = $node.HasAttribute($pair[0])
        $hasEn = $node.HasAttribute($pair[1])
        if ($hasCs -xor $hasEn) {
          Add-Issue $issues 'warning' 'BILINGUAL_PAIR_MISSING' "Lokalizovaný atribut '$($pair[0])/$($pair[1])' musí obsahovat českou i anglickou variantu." "Localized attribute '$($pair[0])/$($pair[1])' must contain both Czech and English variants." @{ node = $node.Name; csAttribute = $pair[0]; enAttribute = $pair[1] }
        }
      }
    }

    $blockDefinitions = Get-JsNames $jsPart 'Blockly.Blocks'
    $pythonGenerators = Get-JsNames $jsPart 'Blockly.Python'
    $visibleTypes = @($xmlDocument.SelectNodes('//category/block[@type]') | ForEach-Object { $_.GetAttribute('type') } | Sort-Object -Unique)
    foreach ($type in $visibleTypes) {
      if (-not $blockDefinitions.Contains($type)) {
        Add-Issue $issues 'warning' 'VISIBLE_BLOCK_DEFINITION_NOT_LOCAL' "Viditelný blok '$type' není definovaný v doplňku; ověř, že jde o existující blok ESP IDE." "Visible block '$type' is not defined by the add-on; verify that it is an existing ESP IDE block." @{ type = $type }
      } elseif (-not $pythonGenerators.Contains($type)) {
        Add-Issue $issues 'warning' 'PYTHON_GENERATOR_MISSING' "Blok '$type' nemá nalezený Python generátor." "Block '$type' has no detected Python generator." @{ type = $type }
      }
    }

    $callbackKeys = @($xmlDocument.SelectNodes('//button[@callbackKey]') | ForEach-Object { $_.GetAttribute('callbackKey') } | Sort-Object -Unique)
    $registeredCallbacks = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
    foreach ($match in [regex]::Matches($jsPart, 'registerButtonCallback\s*\(\s*["''](?<name>[^"'']+)["'']')) {
      [void]$registeredCallbacks.Add($match.Groups['name'].Value)
    }
    foreach ($callback in $callbackKeys) {
      if (-not $registeredCallbacks.Contains($callback)) {
        Add-Issue $issues 'error' 'CALLBACK_MISSING' "Toolbox callback '$callback' není v JavaScriptu zaregistrovaný." "Toolbox callback '$callback' is not registered in JavaScript." @{ callbackKey = $callback }
      }
    }

    $xmlPinRoles = @($xmlDocument.SelectNodes('//*[@data-pin-role]') | ForEach-Object { $_.GetAttribute('data-pin-role') } | Sort-Object -Unique)
    if ($metadata -and $metadata.pin_defaults) {
      $metadataRoles = @($metadata.pin_defaults.PSObject.Properties.Value | ForEach-Object { $_.PSObject.Properties.Name } | Sort-Object -Unique)
      foreach ($role in $xmlPinRoles) {
        if ($role -notin $metadataRoles) {
          Add-Issue $issues 'warning' 'PIN_ROLE_WITHOUT_DEFAULT' "Pin role '$role' nemá hodnotu v pin_defaults." "Pin role '$role' has no value in pin_defaults." @{ role = $role }
        }
      }
      foreach ($role in $metadataRoles) {
        if ($role -notin $xmlPinRoles) {
          Add-Issue $issues 'warning' 'PIN_DEFAULT_UNUSED' "Pin default '$role' nemá odpovídající data-pin-role v toolboxu." "Pin default '$role' has no matching data-pin-role in the toolbox." @{ role = $role }
        }
      }
    } elseif ($xmlPinRoles.Count -gt 0) {
      Add-Issue $issues 'warning' 'PIN_DEFAULTS_MISSING' 'Toolbox používá data-pin-role, ale metadata neobsahují pin_defaults.' 'The toolbox uses data-pin-role, but metadata contain no pin_defaults.'
    }
  }

  $errors = @($issues | Where-Object severity -eq 'error')
  $warnings = @($issues | Where-Object severity -eq 'warning')
  return [pscustomobject]@{
    path = $FilePath
    passed = $errors.Count -eq 0
    delimiterCount = $delimiterCount
    metadata = if ($metadata) { @{ id = $metadata.id; name = $metadata.name; version = $metadata.version } } else { $null }
    errorCount = $errors.Count
    warningCount = $warnings.Count
    issues = @($issues)
  }
}

$files = Find-AddonFiles $Path
if (-not $files.Count) { throw 'Nebyl nalezen žádný .newblk soubor. / No .newblk file was found.' }
foreach ($file in $files) { $results += Validate-AddonFile $file }

if ($Json) {
  $results | ConvertTo-Json -Depth 8
} else {
  foreach ($result in $results) {
    $status = if ($result.passed) { 'OK' } else { 'FAIL' }
    Write-Host "[$status] $($result.path) (errors=$($result.errorCount), warnings=$($result.warningCount))"
    foreach ($issue in $result.issues) {
      $message = if ($Language -eq 'cs') { $issue.messageCs } else { $issue.messageEn }
      Write-Host "  [$($issue.severity.ToUpperInvariant())] $($issue.code): $message"
      if ($issue.details) { Write-Host "    $($issue.details | ConvertTo-Json -Compress -Depth 5)" }
    }
  }
}

if (@($results | Where-Object { -not $_.passed }).Count -gt 0) { exit 1 }
