#include <stdio.h>

#include "yqrt/yqrt.h"

void on_init() {
  printf("Initialized.\n");
}

int var_0;

void on_message(const yqrt_message_t *message) {
  printf("#%d: %s\n", var_0, message->text);
  ++var_0;
}
