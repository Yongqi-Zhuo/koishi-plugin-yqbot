def on_init():
    print("Initialized.")

counter = 0

def on_message(message):
    global counter
    print(f"#{counter}: {message}")
    counter += 1
