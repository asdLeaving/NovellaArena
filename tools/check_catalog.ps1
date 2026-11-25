param([string]$SiteRoot = (Split-Path -Parent $PSScriptRoot))

$ErrorActionPreference = "Stop"
$root = (Resolve-Path -LiteralPath $SiteRoot).Path
$catalog = [IO.File]::ReadAllText((Join-Path $root "data/catalog.json")) | ConvertFrom-Json
foreach ($key in @("models", "topics", "entries")) {
  if ($catalog.$key -isnot [array]) { throw "data/catalog.json 缺少数组 $key。" }
}

function Get-UniqueValues($rows, $key) {
  $values = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
  foreach ($row in $rows) {
    $value = $row.$key
    if ($value -isnot [string] -or [string]::IsNullOrWhiteSpace($value) -or !$values.Add($value)) {
      throw "data/catalog.json 的 $key 为空或重复：$value"
    }
  }
  return ,$values
}

$models = Get-UniqueValues $catalog.models "name"
$topics = Get-UniqueValues $catalog.topics "name"
$null = Get-UniqueValues $catalog.entries "id"
# Use exact spelling even on Windows so these links also work on Pages.
$files = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
Get-ChildItem -LiteralPath $root -Recurse -File -Filter "*.txt" | ForEach-Object {
  $null = $files.Add($_.FullName.Substring($root.Length + 1).Replace("\", "/"))
}
foreach ($entry in $catalog.entries) {
  if (!$models.Contains($entry.model) -or !$topics.Contains($entry.topic)) { throw "文稿引用了不存在的题目或模型：$($entry.id)" }
  if (!$files.Contains($entry.file)) { throw "找不到正文，请检查路径和大小写：$($entry.file)" }
}
foreach ($topic in $catalog.topics) {
  if ($topic.promptFile -and !$files.Contains($topic.promptFile)) { throw "找不到提示词，请检查路径和大小写：$($topic.promptFile)" }
}
