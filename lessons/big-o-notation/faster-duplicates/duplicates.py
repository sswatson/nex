def has_duplicate(items):
    """Return True if any value appears more than once in items."""
    # This works, but it's O(n^2): every pair gets compared.
    # Rewrite it to run in O(n). (Hint: what gives you O(1) membership checks?)
    for i in range(len(items)):
        for j in range(i + 1, len(items)):
            if items[i] == items[j]:
                return True
    return False
