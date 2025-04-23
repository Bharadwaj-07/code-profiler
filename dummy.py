def example_function():
    import time
    time.sleep(1)
    x = [i for i in range(100000)]
    sum1=0
    for i in range(10000):
        sum1+=i**i# Allocate some memory
    return sum(x)

def main():
    print("Starting test...")
    for _ in range(3):
        example_function()
    print("Test completed.")

if __name__ == "__main__":
    main()