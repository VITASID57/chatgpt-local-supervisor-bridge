# Contributing

Small, reviewable pull requests are welcome.

Before opening a PR:

```powershell
npm run check
.\scripts\verify-public.ps1
```

Please preserve these project rules:

- no generic shell or force-push tool;
- no automatic expansion of workspace roots;
- no plaintext secrets or account-specific paths;
- existing-file writes keep SHA-256 concurrency checks;
- destructive operations stay recoverable or require a stronger explicit approval design;
- new tools must declare accurate MCP read-only and destructive annotations;
- security-sensitive changes include focused tests and a short threat-model note.

Do not submit generated runtime files, `config.json`, `profile.yaml`, tunnel binaries, screenshots containing identifiers, or logs from a real deployment.
