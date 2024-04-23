#ifndef YQRT_H
#define YQRT_H

// C interface

#ifdef __cplusplus
extern "C" {
#endif

typedef struct yqrt_message_t {
  long author;
  long timestamp;
  const char *text;
} yqrt_message_t;

#ifdef __cplusplus
}
#endif

// C++ interface

#ifdef __cplusplus

#include <string>

struct YqrtMessage {
  long author;
  long timestamp;
  std::string text;
  yqrt_message_t toC() const & { return {author, timestamp, text.c_str()}; }
};

#endif // __cplusplus

#endif // YQRT_H
