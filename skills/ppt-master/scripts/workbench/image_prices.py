"""Maintain the workbench's daily account-specific ZhenZhen AI estimates."""

import hashlib
import json
import re
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from decimal import Decimal, ROUND_CEILING
from pathlib import Path

import requests

from atomic_io import write_json_atomic
from image_backends.backend_zzai import BASE_URL, image_payload

RESOLUTIONS = ('1k', '2k', '4k')
_lock = threading.Lock()
_running = set()


def _fetch(token):
    headers = {'Authorization': f'Bearer {token}'}
    response = requests.get(f'{BASE_URL}/models', headers=headers, timeout=12)
    response.raise_for_status()
    models = sorted({item['id'] for item in response.json()['data']
                     if re.fullmatch(r'zhenzhen-image-g-v[\d.]+-(?:lowprice|flare|sunburst)', item['id'])})
    if not models:
        raise ValueError('No GPT Image models returned')

    def estimate(pair):
        model, resolution = pair
        payload = image_payload(model, 'A blue ceramic cup on a white background.', '16:9', resolution)
        response = requests.post(f'{BASE_URL}/image/generations/estimate', headers=headers,
                                 json=payload, timeout=15)
        response.raise_for_status()
        quote = response.json(parse_float=Decimal)
        if quote['estimate_available'] is False:
            return model, resolution, None
        if quote['currency'] not in ('CNY', '¥', 'RMB'):
            raise ValueError('Expected a CNY estimate')
        amount = Decimal(quote['amount'])
        if not amount.is_finite() or amount < 0:
            raise ValueError('Invalid estimate')
        return model, resolution, str(amount.quantize(Decimal('0.01'), rounding=ROUND_CEILING))

    table = {model: {} for model in models}
    with ThreadPoolExecutor(max_workers=4) as pool:
        for model, resolution, amount in pool.map(estimate, ((m, r) for m in models for r in RESOLUTIONS)):
            table[model][resolution] = amount
    return table


def daily_prices(directory: Path, token: str, *, refresh_on_open: bool) -> dict:
    """Return the last snapshot immediately and start at most one refresh per local day."""
    if not token:
        return {'status': 'no_key', 'table': {}}
    path = directory / 'image-prices' / (hashlib.sha256(token.encode()).hexdigest() + '.json')
    today = date.today().isoformat()
    with _lock:
        try:
            state = json.loads(path.read_text(encoding='utf-8'))
        except (FileNotFoundError, ValueError):
            state = {}
        if refresh_on_open and state.get('attempt') != today and path not in _running:
            state['attempt'] = today
            write_json_atomic(path, state)
            _running.add(path)

            def refresh():
                try:
                    table = _fetch(token)
                    write_json_atomic(path, {**state, 'updated': today, 'table': table})
                except (requests.RequestException, ValueError, KeyError, TypeError, ArithmeticError, OSError):
                    pass  # The persisted attempt keeps the previous snapshot available for today.
                finally:
                    with _lock:
                        _running.discard(path)

            threading.Thread(target=refresh, daemon=True).start()
        status = 'refreshing' if path in _running else 'ready' if state.get('updated') == today else 'failed'
        return {'status': status, 'updated': state.get('updated'), 'table': state.get('table', {})}
