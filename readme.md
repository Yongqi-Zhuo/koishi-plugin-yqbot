# koishi-plugin-yqbot

[![npm](https://img.shields.io/npm/v/koishi-plugin-yqbot?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-yqbot)

yqbot, bot by yq

## 功能

### 查重

yqbot 特有的 sgl 功能可以帮您查找重复发布的图片。由于使用了 perceptual hash，即使图片经过压缩和缩放，也能找到相似的图片。

### 编程语言

yqbot 可以运行一些简单的代码和 shell 命令。目前支持的语言有：

- C
- C++
- Python

若要正常使用 yqrt，请勿将 koishi 运行于 Docker 容器之中，因为无法嵌套 namespace。

由于隔离运行机制需要 firejail 的支持，因此需要在服务器上安装 [firejail](https://github.com/netblue30/firejail)。例如在 Ubuntu 上，你需要

```bash
sudo add-apt-repository ppa:deki/firejail
sudo apt-get update
sudo apt-get install firejail firejail-profiles
```

如果你需要使用 yqrt 的自定义编程功能，那么 你还需要安装 Docker 和 CRIU，并且需要开启 docker 的实验性功能以支持 checkpoint。Docker 的安装方法请参考[官方文档](https://docs.docker.com/engine/install/ubuntu/)。开启实验性功能是在 `/etc/docker/daemon.json` 中添加 `"experimental": true`。CRIU 可以通过 `sudo apt-get install criu` 安装。
