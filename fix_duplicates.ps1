cd C:\Users\Abhishek\pawbook\pawbook_v2

$files = Get-ChildItem -Filter "*.html"
$fixed = 0

foreach ($file in $files) {
    $content = [System.IO.File]::ReadAllText($file.FullName, [System.Text.Encoding]::UTF8)
    $original = $content

    # Remove var/const API_BASE = '...' line
    $content = [regex]::Replace($content, "[ \t]*(var|const) API_BASE\s*=\s*['""][^'""]+['""]\s*;[ \t]*\r?\n", "", "None")

    # Remove function authHeaders(){...} — handles multiline body
    $content = [regex]::Replace($content, "[ \t]*function authHeaders\s*\(\s*\)\s*\{[^}]+\}[ \t]*\r?\n?", "", "Singleline")

    if ($content -ne $original) {
        [System.IO.File]::WriteAllText($file.FullName, $content, [System.Text.Encoding]::UTF8)
        Write-Host "  FIXED: $($file.Name)"
        $fixed++
    } else {
        Write-Host "  skip:  $($file.Name)"
    }
}

Write-Host "`nDone. $fixed files cleaned."