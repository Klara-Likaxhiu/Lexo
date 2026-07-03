#!/usr/bin/env bash
# Render build script (optional — same steps as render.yaml buildCommand).
set -o errexit

pip install --upgrade pip setuptools wheel
pip install -r requirements.txt
