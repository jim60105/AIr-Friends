# Vendored jieba dictionary (Traditional Chinese)

`dict.txt.big` is the Traditional-Chinese-capable dictionary of
[fxsjy/jieba](https://github.com/fxsjy/jieba) (MIT), vendored so that tests,
local development and the container work offline and deterministically.

- **Source**: https://github.com/fxsjy/jieba/blob/67fa2e36e72f69d9134b8a1037b83fbb070b9775/extra_dict/dict.txt.big
- **Pinned commit**: `67fa2e36e72f69d9134b8a1037b83fbb070b9775` (master, 2020-02-15)
- **sha256**: `b16011275c42955ccd81fc1adecc93a59dbb7926af69d93fc95d4943d40f6aad`
- **License**: MIT — see `LICENSE` in this directory (copied verbatim from the same commit).

Verify the vendored file matches upstream:

```bash
sha256sum assets/jieba/dict.txt.big
# b16011275c42955ccd81fc1adecc93a59dbb7926af69d93fc95d4943d40f6aad  assets/jieba/dict.txt.big
```