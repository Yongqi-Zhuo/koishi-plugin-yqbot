#!/bin/bash

# Start the container, but do not execute anything.
# We must wait for the upload of the files to be completed.
read lang

# Compile according to language.
case $lang in
    "c++")
        g++ yqprogram.cpp -I/yqrt/include -L/yqrt/lib -lyqrt -o yqprogram
        ./yqprogram
        exit 0
        ;;
    "c")
        gcc yqprogram.c -I/yqrt/include -L/yqrt/lib -lyqrt -lstdc++ -o yqprogram
        ./yqprogram
        exit 0
        ;;
    "python")
        python3 /yqrt/lib/yqrt.py
        exit 0
        ;;
    *)
        echo "Language $lang is not supported."
        exit 1
        ;;
esac
