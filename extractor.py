import json
import requests
from tqdm import tqdm


def download_with_progress(url):
    print("Downloading data...")
    response = requests.get(url, stream=True)
    total_size = int(response.headers.get("content-length", 0))

    # Initialize the progress bar for downloading
    block_size = 1024  # 1 Kibibyte
    progress_bar = tqdm(
        total=total_size, unit="iB", unit_scale=True, desc="Downloading"
    )

    # Download data in chunks and update progress bar
    data = bytearray()
    for data_chunk in response.iter_content(block_size):
        progress_bar.update(len(data_chunk))
        data.extend(data_chunk)
    progress_bar.close()

    return json.loads(data)["data"]


# Fetch data from the URL with progress bar
data = download_with_progress("https://mtgjson.com/api/v5/ModernAtomic.json")

# %%

# Process the cards
card_info = {}
for name, card in tqdm(data.items(), desc="Processing cards"):
    types = card[0]["types"]
    if name.startswith("A-"):
        print(name)
        continue
    if name not in card_info:
        card_info[name.lower()] = types
        if " // " in name:
            # e.g. Sink into Stupor // Soporific Springs
            parts = name.split(" // ")
            for part in parts:
                card_info[part.lower()] = types

print("\nWriting to file...")
# Write the processed data to file
with open("modern_types.js", "w") as f:
    f.write("const cardDatabase = ")
    f.write(json.dumps(card_info))
    f.write(";")

print("Done!")
