#include <iostream>
#include <nlohmann/json.hpp>

using json = nlohmann::json;

#include "yqrt/utils.h"
#include "yqrt/yqrt.h"

NLOHMANN_DEFINE_TYPE_NON_INTRUSIVE(YqrtMessage, author, timestamp, text)

// C interface
extern "C" WEAK void on_init() {}
extern "C" WEAK void on_message(const yqrt_message_t *message) {}

// C++ interface
WEAK void onInit() {}
WEAK void onMessage(const YqrtMessage &message) {}

// We intend to use docker checkpoints to suspend and resume this process.
int main(int argc, char *argv[]) {
  json event;
  // Format: {"kind": "...", ...}
  while (std::cin >> event) {
    std::cerr << "Received event: " << event.dump() << std::endl;
    std::string kind;
    event.at("kind").get_to(kind);
    if (kind == "init") {
      onInit();
      on_init();
    } else if (kind == "message") {
      YqrtMessage message;
      event.get_to(message);
      onMessage(message);
      yqrt_message_t c_message = message.toC();
      on_message(&c_message);
    } else {
      std::cerr << "Unknown event: " << kind << std::endl;
      return 1;
    }
    // Use escape sequence to signal the end of the event.
    std::cout << '\x07';
    std::cout.flush();
  }
  std::cerr << "End of input." << std::endl;
  return 0;
}
