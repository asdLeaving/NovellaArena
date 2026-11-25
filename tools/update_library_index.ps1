param([string]$SiteRoot = (Split-Path -Parent $PSScriptRoot))

# PowerShell publishing works without installing Python or Node.
$ErrorActionPreference = "Stop"
$root = (Resolve-Path -LiteralPath $SiteRoot).Path
$utf8 = [Text.UTF8Encoding]::new($false)
$index = [ordered]@{ titles = [ordered]@{}; references = [ordered]@{} }
$heading = '^(?:第[一二三四五六七八九十百千万零〇两0-9]+(?:[章幕篇部]|部分)|序章|楔子|终章|后记|引子|尾声|序|跋)(?:$|[\s　·.、:：])|^[一二三四五六七八九十百零〇0-9]{1,3}$'
foreach ($folder in @("texts", "prompts")) {
  $directory = Join-Path $root $folder
  if (!(Test-Path -LiteralPath $directory)) { continue }
  $files = Get-ChildItem -LiteralPath $directory -Filter "*.txt" -File -Recurse | Sort-Object FullName
  foreach ($file in $files) {
    $path = $file.FullName.Substring($root.Length + 1).Replace("\", "/")
    $reader = [IO.StreamReader]::new($file.FullName, $utf8, $true)
    try {
      if ($folder -eq "prompts") {
        $first = [string]$reader.ReadLine()
        if ($first.Trim() -match '^[（(]\s*《([^《》]+)》.*[）)]$') {
          $index.references[$path] = $Matches[1].Trim()
        }
      } else {
        do { $line = $reader.ReadLine() } while ($null -ne $line -and !$line.Trim())
        if ($line) {
          $title = $line.Trim()
          if ($title.Length -le 22 -and $title -notmatch '[。！？]$' -and $title -notmatch $heading) {
            $index.titles[$path] = $title
          }
        }
      }
    } finally { $reader.Dispose() }
  }
}
$target = Join-Path $root "data/library-index.json"
$json = ($index | ConvertTo-Json -Depth 3 -Compress) + [char]10
if (!(Test-Path -LiteralPath $target) -or [IO.File]::ReadAllText($target) -cne $json) {
  [IO.File]::WriteAllText($target, $json, $utf8)
}
