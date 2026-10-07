# 在仓库目录运行：提交本地改动，并经本机代理推送到 GitHub。
cmd /c "chcp 65001 >nul"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$proxy = "http://127.0.0.1:10808"
$ghDir = "C:\Program Files\GitHub CLI"
Set-Location -LiteralPath $PSScriptRoot

$env:HTTP_PROXY = $proxy
$env:HTTPS_PROXY = $proxy
$env:GIT_TERMINAL_PROMPT = "0"
$env:Path = "$ghDir;" + $env:Path

function Fail($message) {
  Write-Host $message
  exit 1
}

if (-not (Test-Path -LiteralPath (Join-Path $ghDir "gh.exe"))) {
  Fail "找不到 GitHub CLI。请先安装 gh，并完成 gh auth login。"
}

git rev-parse --is-inside-work-tree *> $null
if ($LASTEXITCODE -ne 0) {
  Fail "当前目录不是 git 仓库。"
}

git add -A
if ($LASTEXITCODE -ne 0) {
  Fail "git add 失败。"
}

$dirty = git status --porcelain
if ($dirty) {
  $message = "更新站点 " + (Get-Date -Format "yyyy-MM-dd HH:mm")
  git commit -m $message
  if ($LASTEXITCODE -ne 0) {
    Fail "提交失败。"
  }
  Write-Host "已提交：$message"
} else {
  Write-Host "没有新的文件改动。"
}

git -c credential.helper= -c "credential.helper=!gh auth git-credential" -c "http.proxy=$proxy" -c "https.proxy=$proxy" push -u origin HEAD
if ($LASTEXITCODE -ne 0) {
  Fail "推送失败。请确认代理 $proxy 已开启，并且已执行 gh auth login。"
}

Write-Host "已推送到 GitHub。"
Write-Host "https://asdleaving.github.io/NovellaArena/"
