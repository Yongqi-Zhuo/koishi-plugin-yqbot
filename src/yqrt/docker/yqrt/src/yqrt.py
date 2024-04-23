from dataclasses import dataclass
import importlib
import importlib.util
import json
import sys

@dataclass
class YqrtMessage:
    author: int
    timestamp: int
    text: str

def main():
    spec = importlib.util.spec_from_file_location('yqprogram', './yqprogram.py')
    yqprogram = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(yqprogram)
    on_init = yqprogram.on_init if hasattr(yqprogram, 'on_init') else lambda: None
    on_message = yqprogram.on_message if hasattr(yqprogram, 'on_message') else lambda **kwargs: None

    while True:
        event = input()
        event = json.loads(event)
        sys.stderr.write(f"Received event: {event}\n")
        kind = event['kind']
        if kind == "init":
            on_init()
        elif kind == "message":
            on_message(**event)
        else:
            sys.stderr.write(f"Unknown event: {kind}\n")
            return 1
        sys.stdout.write('\x07')
        sys.stdout.flush()

if __name__ == '__main__':
    main()
