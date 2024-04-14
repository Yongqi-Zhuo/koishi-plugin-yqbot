#!/bin/bash
g++ /mnt/yqprogram.cpp -I/yqrt/include -L/yqrt/lib -lyqrt -o /mnt/yqprogram
cp /mnt/yqprogram ./yqprogram
./yqprogram
