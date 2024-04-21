import sys
import importlib
import importlib.util

def main():
    spec = importlib.util.spec_from_file_location('yqprogram', './yqprogram.py')
    yqprogram = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(yqprogram)
    on_init = yqprogram.on_init if hasattr(yqprogram, 'on_init') else lambda: None
    on_message = yqprogram.on_message if hasattr(yqprogram, 'on_message') else lambda message: None

    while True:
        line = sys.stdin.readline().strip()
        event, length = line.split(' ')
        length = int(length)
        text = sys.stdin.read(length)
        if len(text) != length:
            sys.stderr.write("Bad input.\n")
            return 1
        sys.stderr.write(f"Received event: {event}, length: {length}, text: {text}\n")
        if event == "init":
            on_init()
        elif event == "message":
            on_message(text)
        else:
            sys.stderr.write(f"Unknown event: {event}\n")
            return 1
        sys.stdout.write('\x07')
        sys.stdout.flush()

if __name__ == '__main__':
    main()
