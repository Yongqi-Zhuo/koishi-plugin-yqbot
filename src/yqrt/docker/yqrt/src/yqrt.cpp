#include <iostream>

#include "yqrt/utils.h"
#include "yqrt/yqrt.h"

extern "C" WEAK void on_init() {}

extern "C" WEAK void on_message(const yqrt_message_t *message) {}

// We intend to use docker checkpoints to suspend and resume this process.
int main(int argc, char *argv[]) {
  std::string event;
  // Format: <event> <length>\n<text>
  while (std::cin >> event) {
    // Now ignore the event.
    std::size_t len;
    std::cin >> len;
    std::cin.ignore(1, '\n');
    std::string text;
    text.resize(len);
    std::cin.read(&text[0], len);
    if (!std::cin) {
      std::cerr << "Bad input." << std::endl;
      return 1;
    }
    std::cerr << "Received event: " << event << ", length: " << len
              << ", text: " << text << std::endl;
    if (event == "init") {
      on_init();
    } else if (event == "message") {
      yqrt_message_t message = {text.c_str()};
      on_message(&message);
    } else {
      std::cerr << "Unknown event: " << event << std::endl;
      return 1;
    }
    // Use escape sequence to signal the end of the event.
    std::cout << '\x07';
    std::cout.flush();
  }
  std::cerr << "End of input." << std::endl;
  return 0;
}
