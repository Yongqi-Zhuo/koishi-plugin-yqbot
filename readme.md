# koishi-plugin-yqbot

[![npm](https://img.shields.io/npm/v/koishi-plugin-yqbot?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-yqbot)

yqbot, bot by yq

## 查重

yqbot 特有的 sgl 功能可以帮您查找重复发布的图片。由于使用了 perceptual hash，即使图片经过压缩和缩放，也能找到相似的图片。

### 使用

所有非表情包的图片都会被尝试查重。第一次发送的图片会被记录，之后发送的图片会与之前的图片进行比对。如果相似度超过阈值，yqbot 会提醒用户。

由于检测图片是否为表情包的功能目前需要 `<img summary="[动画表情]" />` 里的 `summary` 字段，而这一字段目前只有 Lagrange.Core 的较新版本支持，所以请务必使用 Lagrange.Core 的最新版本。

## 自动回复

yqbot 可以根据您发送的内容自动回复。与 `koishi-plugin-dialogue` 不同，支持不完全匹配，即，如果您发送的内容包含了关键词，yqbot 也会回复。

### 使用

`/chat remember [-i] <question> <answer>` 给一个问题添加一个回复。如果 `-i` 选项被指定，那么将允许不完全匹配。

`/chat forget [-i] <question> <answer>` 删除一个问题的回复。如果 `-i` 选项被指定，那么将删除允许不完全匹配的问题的回复。

`/chat list` 列出所有已经记住的问题。

`/chat lookup [-i] <question>` 查找一个问题的所有回复。如果 `-i` 选项被指定，那么将显示允许不完全匹配的问题的回复。每一条回复都有一个编号。

`/chat remove [ids...]` 删除对应于这些编号的回复。

## 编程语言

yqbot 可以运行一些简单的代码和 shell 命令。目前支持的语言有：

- C
- C++
- Python

若要正常使用 yqrt，请勿将 koishi 运行于 Docker 容器之中，因为无法嵌套 namespace。

### 安装

由于隔离运行机制需要 firejail 的支持，因此需要在服务器上安装 [firejail](https://github.com/netblue30/firejail)。例如在 Ubuntu 上，你需要

```bash
sudo add-apt-repository ppa:deki/firejail
sudo apt-get update
sudo apt-get install firejail firejail-profiles
```

如果你需要使用 yqrt 的自定义编程功能，那么 你还需要安装 Docker 和 CRIU，并且需要开启 docker 的实验性功能以支持 checkpoint。Docker 的安装方法请参考[官方文档](https://docs.docker.com/engine/install/ubuntu/)。开启实验性功能是在 `/etc/docker/daemon.json` 中添加 `"experimental": true`。CRIU 可以通过 `sudo apt-get install criu` 安装。

### 使用

`/yqrt add [-l language] [-t title] <code>` 添加一个 yqrt 程序。每个程序可以通过容器的 hash，容器的 hash 的前缀来查找。`-l` 选项指定语言，`-t` 选项指定标题。如果你指定了标题，那么你也可以通过标题来查找程序。这一程序在群里有任何消息的时候都会触发，所以如果你不想对一个消息回复，就不要在标准输出（stdout）中输出任何内容。程序的示例请见 `src/yqrt/docker/examples`。比如，你可以：

```c++
#include <iostream>
#include "yqrt/yqrt.h"
void onInit() { std::cout << "Initialized." << std::endl; }
int var_0;
void onMessage(const YqrtMessage &message) {
  std::cout << "#" << var_0 << ": " << message.author << ": " << message.text
            << std::endl;
  ++var_0;
}
```

而且程序的状态会被保存，所以你无需关心数据的持久化，而可以当成程序始终在运行。具体的 API 请参考 `src/yqrt/docker/yqrt/include/yqrt/yqrt.h`。

`/yqrt remove [-f] <abbr>` 删除一个 yqrt 程序。如果 `-f` 选项被指定，那么会强制删除，不论是否在运行。

`/yqrt list` 列出所有已经添加的 yqrt 程序。
