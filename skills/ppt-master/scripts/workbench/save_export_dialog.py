#!/usr/bin/env python3
"""Show the workbench's native Save As picker on the GUI process's main thread.

Usage: python save_export_dialog.py <suggested-filename>
Print the selected PPTX path as JSON, or null when the user cancels.
"""

import json
import sys
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox


def choose_destination(filename: str) -> str | None:
    root = tk.Tk()
    root.withdraw()
    try:
        root.attributes('-topmost', True)
        while True:
            path = filedialog.asksaveasfilename(
                parent=root, title='另存为', initialfile=filename, defaultextension='.pptx',
                filetypes=[('PowerPoint 演示文稿', '*.pptx')], confirmoverwrite=True,
            )
            if not path or Path(path).suffix.lower() == '.pptx':
                return path or None
            messagebox.showinfo('另存为', '请使用 .pptx 扩展名。', parent=root)
    finally:
        root.destroy()


if __name__ == '__main__':
    print(json.dumps(choose_destination(sys.argv[1])))
