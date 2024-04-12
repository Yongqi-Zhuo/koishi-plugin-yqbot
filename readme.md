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

由于隔离机制需要 firejail 的支持，因此需要在服务器上安装 firejail。
