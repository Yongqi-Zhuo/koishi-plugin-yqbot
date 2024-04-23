#include <iostream>

#include "yqrt/yqrt.h"

void onInit() { std::cout << "Initialized." << std::endl; }

int var_0;

void onMessage(const YqrtMessage &message) {
  std::cout << "#" << var_0 << ": " << message.author << ": " << message.text
            << std::endl;
  ++var_0;
}
