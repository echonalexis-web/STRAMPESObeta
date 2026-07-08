# Security test script for local server (Windows PowerShell)
# Requires server running at http://localhost:5000

$baseUrl = $env:BASE_URL = "http://localhost:3000"

Write-Host "Ensure the server is running at $baseUrl"
Write-Host "1) Checking security headers (Helmet/CSP/X-Content-Type-Options):\n"
& curl.exe -I -s "$baseUrl/health"

Write-Host "\n2) Rate limit test (POST /api/v1/auth/login) - expect 4xx/429 after limit:\n"
for ($i = 1; $i -le 10; $i++) {
  $code = & curl.exe -s -o NUL -w "%{http_code}" -X POST "$baseUrl/api/v1/auth/login" -H "Content-Type: application/json" -d '{"email":"nonexistent@example.com","password":"wrong"}'
  Write-Host "$i => $code"
}

Write-Host "\n3) CORS check (Origin: http://evil.com) - should be blocked or missing CORS allow header:\n"
& curl.exe -i -s -H "Origin: http://evil.com" "$baseUrl/api/v1/health"

Write-Host "\n4) Upload disallowed file type test (expect 4xx):\n"
$testExe = "$env:TEMP\test.exe"
"malicious" | Out-File -FilePath $testExe -Encoding ASCII
& curl.exe -s -w "\nHTTP_CODE:%{http_code}\n" -F "file=@$testExe" "$baseUrl/api/v1/users/upload-resume"

Write-Host "\n5) Large file upload test (expect file size limit error):\n"
$large = "$env:TEMP\large.bin"
# create ~16MB file
$bytes = New-Object byte[] (16*1024*1024)
[System.IO.File]::WriteAllBytes($large, $bytes)
& curl.exe -s -w "\nHTTP_CODE:%{http_code}\n" -F "file=@$large" "$baseUrl/api/v1/users/upload-resume"

Write-Host "\n6) NoSQL injection attempt (login with JSON payload) - should NOT authenticate:\n"
& curl.exe -i -s -H "Content-Type: application/json" -X POST -d '{"email":{"$gt":""},"password":"x"}' "$baseUrl/api/v1/auth/login"

Write-Host "\n7) Static file path traversal test - expect 403 or safe handling:\n"
& curl.exe -i -s "$baseUrl/uploads/../server.js"

Write-Host "\nCleanup temporary files"
Remove-Item -Force $testExe -ErrorAction SilentlyContinue
Remove-Item -Force $large -ErrorAction SilentlyContinue

Write-Host "\nDone. Review outputs above for expected failures (4xx/403/429) and secure headers."