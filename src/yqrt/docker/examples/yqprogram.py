def on_init():
    print("Initialized.")

counter = 0

def on_message(author, timestamp, text, **kwargs):
    global counter
    print(f"#{counter}: {author}: {text}")
    counter += 1
