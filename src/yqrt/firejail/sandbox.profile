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

# This is for user execution.

# Prevent modification of anything left over from the rootfs
read-only /

private-tmp
# private-bin none
private-etc none
memory-deny-write-execute

nice 19

# Blacklist all the things I can think of in /run
# Sadly we can't blanket blacklist /run, as we need
# /run/firejail. And we can't whitelist /run/firejail, as
# that doesn't work.
# We also need /run/user
blacklist /run/NetworkManager
blacklist /run/acpid.socket
blacklist /run/agetty.reload
blacklist /run/atd.pid
blacklist /run/blkid
blacklist /run/cloud-init
blacklist /run/console-setup
blacklist /run/crond.pid
blacklist /run/crond.reboot
blacklist /run/cryptsetup
blacklist /run/dbus
blacklist /run/dmeventd-client
blacklist /run/dmeventd-server
blacklist /run/initctl
blacklist /run/initramfs
blacklist /run/lock
blacklist /run/log
blacklist /run/lvm
blacklist /run/lvmetad.pid
blacklist /run/lxcfs
blacklist /run/lxcfs.pid
blacklist /run/mlocate.daily.lock
blacklist /run/motd.dynamic
blacklist /run/mount
blacklist /run/network
blacklist /run/nginx.pid
blacklist /run/rpc_pipefs
blacklist /run/rpcbind
blacklist /run/rpcbind.lock
blacklist /run/rpcbind.sock
blacklist /run/rsyslogd.pid
blacklist /run/screen
blacklist /run/sendsigs.omit.d
blacklist /run/shm
blacklist /run/snapd-snap.socket
blacklist /run/snapd.socket
blacklist /run/sshd
blacklist /run/sshd.pid
blacklist /run/sudo
blacklist /run/sysconfig
blacklist /run/systemd
blacklist /run/tmpfiles.d
blacklist /run/udev
blacklist /run/unattended-upgrades.lock
blacklist /run/unattended-upgrades.progress
blacklist /run/utmp
blacklist /run/uuidd

# Prevent sandbox talking to rsyslogd
blacklist /dev/log

# Prevent DoS on system-wide entropy generation
blacklist /dev/random

# No need to see anything here
blacklist /infra
blacklist /efs

# Remove some env vars, mostly to stop people emailing me about them
# SUDO_COMMAND is one with actual somewhat sensitive info
rmenv SUDO_COMMAND
rmenv SUDO_USER
rmenv SUDO_UID
rmenv SUDO_GID
rmenv DBUS_SESSION_BUS_ADDRESS

# These seem to work reasonably well...
rlimit-nproc 4
rlimit-fsize 16777216
rlimit-nofile 10
rlimit-as 536870912
