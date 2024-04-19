#!/bin/bash

# Start the container, but do not execute anything.
# We must wait for the upload of the files to be completed.
read
# Signal that we have received.
printf 'started\a'

# Compile and run the program.
g++ yqprogram.cpp -I/yqrt/include -L/yqrt/lib -lyqrt -o yqprogram
./yqprogram
