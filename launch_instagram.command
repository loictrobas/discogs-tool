#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

source venv/bin/activate
streamlit run app_post_instagram.py