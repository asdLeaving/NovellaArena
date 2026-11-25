# 在当前分支生成静态资源索引、提交并推送。兼容 Windows PowerShell 5.1。
$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding

try {
  $branch = git symbolic-ref --quiet --short HEAD
  if ($LASTEXITCODE -ne 0) { throw "请先切换到用于上传的分支。" }
  $remote = git remote get-url --push origin
  if ($LASTEXITCODE -ne 0) { throw "当前仓库没有 origin 远程地址。" }

  & (Join-Path $PSScriptRoot "tools/check_catalog.ps1")
  & (Join-Path $PSScriptRoot "tools/update_asset_versions.ps1")
  git add -A
  if ($LASTEXITCODE -ne 0) { throw "暂存站点文件失败。" }

  git diff --cached --quiet
  if ($LASTEXITCODE -eq 1) {
    git commit -m ("更新站点 " + (Get-Date -Format "yyyy-MM-dd HH:mm"))
    if ($LASTEXITCODE -ne 0) { throw "提交失败。" }
  } elseif ($LASTEXITCODE -ne 0) { throw "无法读取待提交改动。" }

  $gitOptions = @()
  if ($remote -match "^https://github\.com/") {
    $ghPath = Join-Path $env:ProgramFiles "GitHub CLI"
    if (Test-Path -LiteralPath (Join-Path $ghPath "gh.exe")) { $env:Path += ";$ghPath" }
    if (Get-Command gh -ErrorAction SilentlyContinue) {
      # Try the existing gh login first, then allow normal Git credentials.
      $helpers = @(git config --get-all credential.helper)
      $gitOptions += @("-c", "credential.helper=", "-c", "credential.helper=!gh auth git-credential")
      foreach ($helper in $helpers) { $gitOptions += @("-c", "credential.helper=$helper") }
    }
    # Honor configured proxies. Keep compatibility with the original local proxy when running.
    $gitProxy = git config --get-urlmatch http.proxy $remote
    if (!$gitProxy -and !$env:HTTPS_PROXY -and !$env:HTTP_PROXY -and !$env:ALL_PROXY) {
      $client = [Net.Sockets.TcpClient]::new()
      try {
        if ($client.ConnectAsync("127.0.0.1", 10808).Wait(250) -and $client.Connected) {
          $gitOptions += @("-c", "http.proxy=http://127.0.0.1:10808")
        }
      } catch {} finally { $client.Dispose() }
    }
  }

  git @gitOptions push --set-upstream origin "HEAD:refs/heads/$branch"
  if ($LASTEXITCODE -ne 0) { throw "上传失败。本地提交已保留，请检查网络、登录和远端分支状态后重试。" }
  Write-Host "已上传到 origin/$branch。"
} catch {
  Write-Host $_.Exception.Message -ForegroundColor Red
  exit 1
}
