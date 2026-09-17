#!/usr/bin/env python3
"""The SPA bundle's URLs, and why they carry a content hash (bin/server.py).

The bug this file exists for: `pnpm build` wrote fixed `app.js` / `app.css` names, so two
releases served different bytes at the same two URLs. Nothing between the server and the
screen could tell them apart — the browser's own `max-age=3600`, and a service worker whose
cache version was the hardcoded constant `rs-v1`, both kept serving the previous release's
interface after `git pull && docker compose up -d --build`. Only a hard reload fixed it.

The build now renames the bundle to `app-<hash>.js` / `app-<hash>.css` and publishes the pair
in `bin/static/assets.json`; these tests cover the server half of that — reading the manifest,
refusing a manifest that does not match what is on disk, and falling back to the unhashed names
that `pnpm dev` writes.

Run: python3 -m unittest bin/test_rs_static_assets.py
"""
import importlib
import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)


def load_server(root):
    os.environ["ROOT"] = root
    os.environ["RS_COOKIE_SECURE"] = "0"
    if "server" in sys.modules:
        return importlib.reload(sys.modules["server"])
    return importlib.import_module("server")


class BundleUrls(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()
        os.makedirs(os.path.join(self.root, "state"), exist_ok=True)
        with open(os.path.join(self.root, ".env"), "w") as f:
            f.write("RS_SECRET=" + "a" * 64 + "\nREPOS=acme/widgets\n")
        self.srv = load_server(self.root)
        self.static = Path(tempfile.mkdtemp())
        self.srv.STATIC_DIR = self.static
        self.srv._ASSETS["key"] = False

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)
        shutil.rmtree(self.static, ignore_errors=True)

    def build(self, h="0123456789ab", manifest=True, files=True):
        if files:
            (self.static / f"app-{h}.js").write_text("//js")
            (self.static / f"app-{h}.css").write_text("/*css*/")
        if manifest:
            (self.static / "assets.json").write_text(
                json.dumps({"build": h, "js": f"app-{h}.js", "css": f"app-{h}.css"}))

    def test_the_manifest_names_the_bundle(self):
        self.build()
        self.assertEqual(self.srv.bundle_urls(),
                         ("/static/app-0123456789ab.js", "/static/app-0123456789ab.css"))

    def test_the_shell_links_the_hashed_bundle(self):
        self.build()
        page = self.srv.index_html()
        self.assertIn("src='/static/app-0123456789ab.js'", page)
        self.assertIn("href='/static/app-0123456789ab.css'", page)
        self.assertNotIn("/static/app.js", page)

    def test_a_rebuild_changes_every_bundle_url(self):
        """The whole point: new bytes must mean a URL no cache has ever seen."""
        self.build("aaaaaaaaaaaa")
        first = self.srv.bundle_urls()
        for f in self.static.iterdir():
            f.unlink()
        self.build("bbbbbbbbbbbb")
        self.assertNotEqual(first, self.srv.bundle_urls())
        self.assertIn("/static/app-bbbbbbbbbbbb.js", self.srv.index_html())

    def test_no_manifest_falls_back_to_the_dev_bundle(self):
        """`pnpm dev` writes unhashed app.js and never runs the fingerprint step."""
        (self.static / "app.js").write_text("//js")
        self.assertEqual(self.srv.bundle_urls(), ("/static/app.js", "/static/app.css"))

    def test_a_manifest_naming_missing_files_is_ignored(self):
        """A half-copied deploy must serve the fallback, not 404 the whole app."""
        self.build(manifest=True, files=False)
        self.assertEqual(self.srv.bundle_urls(), ("/static/app.js", "/static/app.css"))

    def test_a_corrupt_or_hostile_manifest_is_ignored(self):
        (self.static / "assets.json").write_text("{not json")
        self.assertEqual(self.srv.bundle_urls(), ("/static/app.js", "/static/app.css"))
        (self.static / "assets.json").write_text(
            json.dumps({"js": "../../etc/passwd", "css": "app-aaaaaaaaaaaa.css"}))
        self.srv._ASSETS["key"] = False
        self.assertEqual(self.srv.bundle_urls(), ("/static/app.js", "/static/app.css"))

    def test_the_device_page_links_the_same_stylesheet(self):
        self.build()
        page = self.srv.device_page("alice", {"Host": "rs.example"}, "phone")
        self.assertIn("/static/app-0123456789ab.css", page)

    def test_only_a_fingerprinted_name_is_cached_for_a_year(self):
        m = self.srv.HASHED_ASSET.match
        self.assertTrue(m("app-0123456789ab.js"))
        self.assertTrue(m("app-0123456789ab.css"))
        self.assertFalse(m("app.js"))
        self.assertFalse(m("sw.js"))
        self.assertFalse(m("app-short.js"))


if __name__ == "__main__":
    unittest.main()
