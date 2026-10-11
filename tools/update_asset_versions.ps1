# Run before publishing; push-update.ps1 invokes this automatically.
param([string]$SiteRoot = (Split-Path -Parent $PSScriptRoot))

$ErrorActionPreference = "Stop"
$sitePath = (Resolve-Path -LiteralPath $SiteRoot).Path
$utf8 = [System.Text.UTF8Encoding]::new($false)
$versions = @{}
$sha = [System.Security.Cryptography.SHA256]::Create()
try {
  Get-ChildItem -LiteralPath (Join-Path $sitePath "assets") -File -Recurse |
    Where-Object { $_.Extension -in ".css", ".js" } |
    ForEach-Object {
      # Git may convert line endings; identical text should retain its version.
      $content = [System.IO.File]::ReadAllText($_.FullName, $utf8).Replace("`r`n", "`n")
      $digest = $sha.ComputeHash($utf8.GetBytes($content))
      $assetPath = $_.FullName.Substring($sitePath.Length + 1).Replace("\", "/")
      $versions[$assetPath] = [System.BitConverter]::ToString($digest).Replace("-", "").ToLowerInvariant()
    }
} finally {
  $sha.Dispose()
}

$pattern = 'assets/[A-Za-z0-9_./-]+\.(?:css|js)(?:\?v=[A-Za-z0-9._-]+)?'
$updated = 0
Get-ChildItem -LiteralPath $sitePath -Filter "*.html" -File | ForEach-Object {
  $html = [System.IO.File]::ReadAllText($_.FullName, $utf8)
  $next = [regex]::Replace($html, $pattern, [System.Text.RegularExpressions.MatchEvaluator]{
    param($match)
    $assetPath = $match.Value.Split("?")[0]
    if (-not $versions.ContainsKey($assetPath)) { throw "Missing asset: $assetPath" }
    return $assetPath + "?v=" + $versions[$assetPath]
  })
  if ($next -cne $html) {
    [System.IO.File]::WriteAllText($_.FullName, $next, $utf8)
    $updated += 1
  }
}
Write-Host "Updated asset versions in $updated HTML file(s)."
