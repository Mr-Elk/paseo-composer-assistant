# Changelog

## 0.0.0 — development

- First installable development version for patched Paseo 0.15.x hosts.
- Manual rewrite of the selected text or the whole draft, with preview before adopting.
- Adoption writes back with the original revision and never sends the message; web undo is preserved.
- Protected code, inline code, URLs, paths and user terms are verified before adopting.
- Settings screen for endpoint, model, key file, protected terms, size and timeout.
- Requests can be cancelled; failures keep the draft untouched.
- Optional input continuation, off by default, offered only after a finished sentence and limited per machine per hour.
- Optional next-message draft after an assistant reply, off by default, sharing the same hourly limit.

Known limits: no real model round-trip verified yet; mobile and unpatched hosts are unsupported by design.
