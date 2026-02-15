# Container Tools Reference

This document lists all common tools pre-installed in the AIr-Friends container image via apt, grouped by category. These tools are available for both the ACP Agent and shell-based skills to use at runtime.

## Networking & Web

| Package | Command | Description |
|---------|---------|-------------|
| `curl` | `curl` | Transfer data from or to a server using HTTP, HTTPS, FTP, and other protocols. Useful for API calls, downloading files, and debugging network requests. |
| `wget` | `wget` | Non-interactive network file downloader. Supports recursive downloads, resuming, and mirroring websites. |
| `ca-certificates` | _(system)_ | Provides trusted CA root certificates for SSL/TLS verification. Required by `curl`, `wget`, and other tools to validate HTTPS connections. |

## File & Archive Management

| Package | Command | Description |
|---------|---------|-------------|
| `zip` | `zip`, `unzip` | Create and extract ZIP archives. |
| `7zip` | `7zz` | High-ratio file archiver supporting 7z, ZIP, GZIP, BZIP2, XZ, TAR, and many other formats. |
| `file` | `file` | Detect file types by inspecting magic bytes, not just extensions. Essential for identifying attachment types (Feature 18) when files have wrong or missing extensions. |
| `tree` | `tree` | Display directory structures as an indented tree. Useful for visualizing workspace layouts and project structures in a readable format. |

## Text Processing & Search

| Package | Command | Description |
|---------|---------|-------------|
| `ripgrep` | `rg` | Recursively search files for regex patterns. Extremely fast; respects `.gitignore` rules by default. Used internally by the memory search skill. |
| `jq` | `jq` | Command-line JSON processor. Parse, filter, transform, and format JSON data. Essential for working with API responses and JSONL memory files. |
| `moreutils` | `sponge`, `ts`, `vidir`, `chronic`, `ifdata`, ... | A collection of useful Unix utilities. `sponge` soaks up stdin and writes to a file (avoids read-write conflicts); `ts` adds timestamps to lines; `chronic` runs a command quietly unless it fails. |

## Development & Build

| Package | Command | Description |
|---------|---------|-------------|
| `git` | `git` | Distributed version control system. Pre-installed for repository operations, cloning, and agent workspace management. |
| `build-essential` | `gcc`, `g++`, `make`, `dpkg-dev` | Meta-package providing the C/C++ compiler toolchain and build tools. Required for compiling native extensions and building software from source. |

## Python

| Package | Command | Description |
|---------|---------|-------------|
| `python3` | `python3` | Python 3 interpreter. Available for running Python scripts, data processing, and automation tasks. |
| `python3-pip` | `pip3` | Python package installer. Install and manage Python libraries from PyPI. |
| `python-is-python3` | `python` | Symlinks `python` to `python3`, allowing scripts that reference `python` to work without modification. |

## Multimedia & Document Processing

| Package | Command | Description |
|---------|---------|-------------|
| `ffmpeg` | `ffmpeg`, `ffprobe` | Complete multimedia framework for audio/video conversion, streaming, and processing. `ffprobe` inspects media file metadata. Supports virtually all audio and video formats. |
| `imagemagick` | `magick`, `convert`, `identify`, `mogrify` | Image manipulation suite for converting, resizing, cropping, and transforming images across hundreds of formats. |
| `exiftool` | `exiftool` | Read, write, and edit metadata (EXIF, IPTC, XMP) in image, audio, video, and document files. Useful for inspecting media file properties. |
| `poppler-utils` | `pdftotext`, `pdfinfo`, `pdfimages`, `pdftoppm` | PDF processing utilities. `pdftotext` extracts text from PDFs; `pdfinfo` shows document metadata; `pdftoppm` converts PDF pages to images. |

## System & Debugging

| Package | Command | Description |
|---------|---------|-------------|
| `strace` | `strace` | Trace system calls and signals for a process. Invaluable for debugging runtime issues, diagnosing permission errors, and understanding program behavior. |
| `bc` | `bc` | Arbitrary precision calculator. Supports floating-point math with configurable decimal precision (`scale`), variables, and functions. Useful for exact calculations that exceed floating-point limits. |
