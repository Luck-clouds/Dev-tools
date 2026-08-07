@echo off
chcp 65001 

:: 如果没有安装可以解除注释

:: npm install http-server -g

http-server -a 0.0.0.0 -p 8080

echo 端口8080 已开启共享服务

pause