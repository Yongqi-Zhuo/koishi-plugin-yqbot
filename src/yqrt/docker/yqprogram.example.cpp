#include <iostream>

#include "yqrt/yqrt.h"

extern "C" void on_init() { std::cout << "Initialized." << std::endl; }

int var_0;

extern "C" void on_message(const yqrt_message_t *message) {
  std::cout << "#" << var_0 << ": " << message->text << std::endl;
  ++var_0;
}
