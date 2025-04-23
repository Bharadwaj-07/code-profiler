def example_function():
    x = [i for i in range(10000)]
    time.sleep(1)
    return x

def main():
    print("Starting test...")
    for _ in range(3):
        example_function()
    print("Test completed.")

if __name__ == "__main__":
    import time
    main()