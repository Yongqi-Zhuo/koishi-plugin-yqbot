#!/bin/bash

# Create the lib directory if it doesn't exist
mkdir -p lib

# Compile yqrt.cpp into an object file
g++ -c src/yqrt.cpp -Iinclude -o lib/yqrt.o

# Create the static library
ar rcs lib/libyqrt.a lib/yqrt.o

# And the python module
cp src/yqrt.py lib/yqrt.py

# Clean up
rm lib/*.o
rm -r src
rm build.sh
