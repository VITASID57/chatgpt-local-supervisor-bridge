# Security model

This bridge gives an OpenAI-hosted ChatGPT conversation structured access to selected local projects. Treat every enabled write tool as meaningful authority.

## Enforced boundaries

- Only configured project roots and their Git worktrees are discoverable.
- `denyRoots` are checked again on every resolved path.
- Path traversal, absolute tool paths, `.git` internals, secret-shaped names and credential extensions are blocked.
- Existing symlinks and Windows junctions are resolved before containment checks.
- The bridge cannot inspect or modify its own source, config, encrypted credential, runtime state or logs.
- Existing files require an exact SHA-256 from a prior read before write or replacement.
- Deletion is represented as a move into a bridge-owned recovery directory.
- Git commits use explicit paths and refuse unrelated pre-staged files.
- Push is current-branch, non-force only, with an exact confirmation phrase.
- There is no generic shell tool.

## Important non-guarantees

- This is an application policy boundary, not an operating-system sandbox. Run it under a dedicated Windows account or VM if the opened data is highly sensitive.
- An allowed repository can contain hostile prompt injection in source files or documentation. Server-side restrictions still apply, but the model may make poor decisions inside the permitted boundary.
- Allowed package scripts are executable code. A script named `test` or `build` can perform arbitrary actions with the Windows user's authority. Review project scripts before enabling `run_project_check` or `start_project_script` on an untrusted repository.
- Git hooks may execute during commit. Do not enable commit access for an untrusted repository.
- Data returned by tools is processed by the calling OpenAI product. Do not expose projects whose data policy forbids that processing.
- A user who can edit `config.json`, replace the bridge code, or control the Windows account can change these boundaries.

## Secrets

- Use a dedicated runtime API key restricted to Tunnels Read + Use.
- Never put a key or Tunnel ID in tracked files, screenshots, issues or logs.
- `scripts/setup.ps1` reads the key with hidden input and stores only a Windows DPAPI-encrypted value under `runtime/`.
- Revoke the key and delete the Tunnel when the bridge is permanently retired or the Windows account may be compromised.

## Reporting a vulnerability

Please use GitHub private vulnerability reporting when available. Do not include real credentials, private repository content or personal paths in a public issue.
