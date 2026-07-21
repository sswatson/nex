import signal
import time

from duplicates import has_duplicate


def check(name, condition):
    print(f"{'ok' if condition else 'FAIL'}  {name}")
    return condition


class TooSlow(Exception):
    pass


def run_with_timeout(seconds, fn, *args):
    """Run fn(*args); raise TooSlow if it exceeds the budget."""

    def handler(signum, frame):
        raise TooSlow

    old = signal.signal(signal.SIGALRM, handler)
    signal.alarm(seconds)
    try:
        return fn(*args)
    finally:
        signal.alarm(0)
        signal.signal(signal.SIGALRM, old)


def main():
    passed = True
    passed &= check("empty list has no duplicate", has_duplicate([]) is False)
    passed &= check("single item has no duplicate", has_duplicate([7]) is False)
    passed &= check("finds an adjacent duplicate", has_duplicate([1, 1, 2]) is True)
    passed &= check("finds a far-apart duplicate", has_duplicate([3, 1, 4, 1]) is True)
    passed &= check("all unique", has_duplicate(list(range(1000))) is False)
    passed &= check("strings work too", has_duplicate(["a", "b", "a"]) is True)

    # The performance gate: 200k unique items with a 2-second budget. A linear
    # version finishes in milliseconds; the original O(n^2) version would need
    # ~20 billion comparisons and gets cut off.
    n = 200_000
    try:
        start = time.perf_counter()
        result = run_with_timeout(2, has_duplicate, list(range(n)))
        elapsed = time.perf_counter() - start
        passed &= check("large unique input is correct", result is False)
        passed &= check(f"large input in time (took {elapsed:.3f}s)", True)
    except TooSlow:
        passed &= check(
            f"large input under 2s — too slow, that growth smells quadratic", False
        )

    print("\nall tests passed 🎉" if passed else "\nsome tests failed")
    raise SystemExit(0 if passed else 1)


if __name__ == "__main__":
    main()
