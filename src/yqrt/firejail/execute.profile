# include src/yqrt/firejail/standard.inc

caps.drop all
hostname ce-node
ipc-namespace
netfilter
private-dev
net none
no3d
nodbus
nodvd
nogroups
nonewprivs
noroot
nosound
notv
nou2f
novideo
seccomp
x11 none

# shell none
disable-mnt

blacklist /boot
blacklist /sbin
blacklist /usr/local/sbin
blacklist /initrd*
blacklist /vmlinuz*
blacklist /usr/sbin
blacklist ${PATH}/su
blacklist ${PATH}/sudo
blacklist /lost+found
blacklist /media
blacklist /mnt
blacklist /root
blacklist /var
blacklist /snap
blacklist /srv

whitelist /opt/compiler-explorer
read-only /opt/compiler-explorer

read-only /infra

noexec /tmp

# This is for compilation.

private-tmp
private-etc passwd,ld.so.conf.d,ld.so.conf

# Prevent modification of anything left over from the rootfs
read-only /

nice 10
# 1.25GB should make two compiles fit on our ~3.8GB machines
rlimit-as 1342177280
whitelist /opt/intel
read-only /opt/intel
whitelist /opt/arm
read-only /opt/arm
