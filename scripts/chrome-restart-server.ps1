# Chrome Restart HTTP Server
# n8nからHTTPリクエストでChrome再起動をトリガーするサーバー
#
# 使い方:
#   .\chrome-restart-server.ps1
#
# n8nから呼び出し:
#   HTTP Request ノードで http://host.docker.internal:8888/restart-chrome にGETリクエスト
#
# 管理者権限で実行する必要があります（最初の1回のみURLACL登録が必要）

param(
    [int]$Port = 8888
)

$ChromePath = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$ChromeProfile = "C:\gemini-chrome-profile"
$Prefix = "http://+:$Port/"

# URLACLが登録されていなければ登録（管理者権限必要）
$aclCheck = netsh http show urlacl url=$Prefix 2>&1
if ($aclCheck -match "URL が見つかりません" -or $aclCheck -match "URL is not found") {
    Write-Host "[INFO] Registering URL ACL (requires admin privileges)..."
    netsh http add urlacl url=$Prefix user=Everyone
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($Prefix)

try {
    $listener.Start()
    Write-Host "=========================================="
    Write-Host " Chrome Restart Server Started"
    Write-Host "=========================================="
    Write-Host " Listening on: $Prefix"
    Write-Host " Endpoints:"
    Write-Host "   GET /restart-chrome  - Restart Chrome"
    Write-Host "   GET /status          - Check Chrome status"
    Write-Host "   GET /stop            - Stop this server"
    Write-Host ""
    Write-Host " From n8n (Docker):"
    Write-Host "   http://host.docker.internal:$Port/restart-chrome"
    Write-Host "=========================================="
    Write-Host ""

    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response

        $path = $request.Url.AbsolutePath
        $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

        Write-Host "[$timestamp] $($request.HttpMethod) $path"

        $statusCode = 200
        $responseText = ""

        switch -Regex ($path) {
            "^/restart-chrome/?$" {
                Write-Host "  -> Restarting Chrome..."

                # gemini-chrome-profileを使用しているChromeプロセスを終了
                $chromeProcesses = Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" |
                    Where-Object { $_.CommandLine -match 'gemini-chrome-profile' }

                $killed = 0
                foreach ($proc in $chromeProcesses) {
                    Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
                    $killed++
                }
                Write-Host "  -> Killed $killed Chrome process(es)"

                # 少し待機
                Start-Sleep -Seconds 3

                # Chrome起動
                Start-Process $ChromePath -ArgumentList "--remote-debugging-port=9222", "--remote-debugging-address=0.0.0.0", "--user-data-dir=`"$ChromeProfile`""
                Write-Host "  -> Chrome started"

                # 起動を待機
                Start-Sleep -Seconds 3

                # 確認
                $newProcess = Get-Process chrome -ErrorAction SilentlyContinue
                if ($newProcess) {
                    $responseText = '{"success": true, "message": "Chrome restarted successfully", "processCount": ' + $newProcess.Count + '}'
                } else {
                    $statusCode = 500
                    $responseText = '{"success": false, "message": "Chrome may not have started properly"}'
                }
            }

            "^/status/?$" {
                $chromeProcess = Get-Process chrome -ErrorAction SilentlyContinue
                if ($chromeProcess) {
                    # ポート9222でリッスンしているか確認
                    $listening = netstat -an | Select-String ":9222.*LISTENING"
                    if ($listening) {
                        $responseText = '{"running": true, "debugPort": true, "processCount": ' + $chromeProcess.Count + '}'
                    } else {
                        $responseText = '{"running": true, "debugPort": false, "processCount": ' + $chromeProcess.Count + '}'
                    }
                } else {
                    $responseText = '{"running": false, "debugPort": false, "processCount": 0}'
                }
            }

            "^/stop/?$" {
                Write-Host "  -> Stopping server..."
                $responseText = '{"success": true, "message": "Server stopping"}'
                $buffer = [Text.Encoding]::UTF8.GetBytes($responseText)
                $response.ContentType = "application/json"
                $response.StatusCode = $statusCode
                $response.ContentLength64 = $buffer.Length
                $response.OutputStream.Write($buffer, 0, $buffer.Length)
                $response.Close()
                $listener.Stop()
                break
            }

            default {
                $statusCode = 404
                $responseText = '{"error": "Not found", "endpoints": ["/restart-chrome", "/status", "/stop"]}'
            }
        }

        if ($listener.IsListening) {
            $buffer = [Text.Encoding]::UTF8.GetBytes($responseText)
            $response.ContentType = "application/json"
            $response.StatusCode = $statusCode
            $response.ContentLength64 = $buffer.Length
            $response.OutputStream.Write($buffer, 0, $buffer.Length)
            $response.Close()
        }
    }
} catch {
    Write-Host "[ERROR] $($_.Exception.Message)"
} finally {
    if ($listener.IsListening) {
        $listener.Stop()
    }
    Write-Host "Server stopped."
}
