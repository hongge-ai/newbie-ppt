#!/usr/bin/env python3
"""Generate and edit images through ZhenZhen AI's asynchronous image API."""

import os
import time
from pathlib import Path
from urllib.parse import quote

import requests

from image_backends.backend_common import download_image, require_api_key, resolve_output_path

BASE_URL = "https://api.seedance.nz/v1"
DEFAULT_MODEL = "zhenzhen-image-g-v2.5-flare"
SUPPORTS_REFERENCE_IMAGE = True


def image_payload(model: str, prompt: str, ratio: str, resolution: str) -> dict:
    """Build the same single-image request for estimates and generation."""
    resolution = resolution.lower()
    if resolution == "512px":
        resolution = "1k"
    payload = {"model": model, "prompt": prompt, "resolution": resolution, "size": ratio, "n": 1}
    if model == "zhenzhen-image-g-v2-lowprice":
        payload["metadata"] = {"resolution": resolution}
    if model.endswith(("-flare", "-sunburst")) or model == "zhenzhen-image-g-v2.6-lowprice":
        payload["quality"] = "high"
    return payload


def generate(prompt: str, aspect_ratio: str = "1:1", image_size: str = "1K",
             output_dir: str = None, filename: str = None, model: str = None,
             reference_image: str = None) -> str:
    """Submit one task, wait for its result, and save the downloaded image."""
    token = require_api_key("ZZAI_API_KEY", message="Set ZZAI_API_KEY in image settings.")
    headers = {"Authorization": f"Bearer {token}"}
    payload = image_payload(model or os.getenv("ZZAI_MODEL") or DEFAULT_MODEL, prompt,
                            aspect_ratio, os.getenv("ZZAI_RESOLUTION") or image_size)
    if reference_image:
        with Path(reference_image).open("rb") as handle:
            upload = requests.post(f"{BASE_URL}/files/upload", headers=headers,
                                   files={"file": (Path(reference_image).name, handle)}, timeout=90)
        upload.raise_for_status()
        payload["images"] = [upload.json()["url"]]
    endpoint = f"{BASE_URL}/image/generations"
    response = requests.post(endpoint, headers=headers, json=payload, timeout=90)
    response.raise_for_status()
    submitted = response.json()
    task_id = submitted.get("task_id") or submitted.get("id")
    if not task_id:
        raise RuntimeError("ZhenZhen AI returned no task ID.")
    deadline = time.monotonic() + 1800
    while time.monotonic() < deadline:
        result = requests.get(f"{endpoint}/{quote(task_id, safe='')}", headers=headers, timeout=60)
        result.raise_for_status()
        task = result.json()["data"]
        if task["status"] == "SUCCESS":
            return download_image(task["result_url"], resolve_output_path(prompt, output_dir, filename))
        if task["status"] == "FAILURE":
            raise RuntimeError(f"ZhenZhen AI task failed: {task.get('fail_reason') or task_id}")
        time.sleep(4)
    raise RuntimeError(f"Timed out waiting for ZhenZhen AI task {task_id}.")
