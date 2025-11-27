# Inicia NGROK rodando o servidor Node na porta 2032 (sem janelas)
Start-Process -FilePath "C:\ngrok.exe" -ArgumentList "http 2032" -WindowStyle Hidden

# Aguarda o ngrok iniciar
Start-Sleep -Seconds 4

# Obtém o domínio público gerado
$ngrokApi = Invoke-RestMethod http://127.0.0.1:4040/api/tunnels
$publicUrl = $ngrokApi.tunnels[0].public_url

# Monta o corpo do POST
$body = @{ url = $publicUrl } | ConvertTo-Json

# Envia para o webhook do n8n
Invoke-RestMethod -Method Post `
  -Uri "https://n8n.svd.tec.br/webhook/ngrok" `
  -ContentType "application/json" `
  -Body $body
