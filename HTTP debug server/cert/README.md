# HTTPS 证书目录

HTTPS 默认关闭。需要使用自签证书时，将 PEM 文件放在这里：

```text
cert/
├─ server-key.pem    # 私钥
└─ server-cert.pem   # 证书
```

然后把 `start-server.cmd` 中的 `DEBUG_SERVER_HTTPS` 改为 `true`，或在启动前设置环境变量：

```powershell
$env:DEBUG_SERVER_HTTPS = "true"
& ".\HTTP debug server\start-server.cmd"
```

也可以使用其他位置的证书：

```powershell
$env:DEBUG_SERVER_HTTPS = "true"
$env:DEBUG_SERVER_HTTPS_KEY = "E:\本地受信证书\server\127.0.0.1-key.pem"
$env:DEBUG_SERVER_HTTPS_CERT = "E:\本地受信证书\server\127.0.0.1.pem"
& ".\HTTP debug server\start-server.cmd"
```

如果私钥带密码，可通过 `DEBUG_SERVER_HTTPS_PASSPHRASE` 提供。