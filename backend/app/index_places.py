from .vector_store import build_index


def main() -> None:
    count = build_index()
    print(f"Indexed {count} places in the local SQLite vector database.")


if __name__ == "__main__":
    main()
