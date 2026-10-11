# Runtime compatibility matrix

This document records the fixed M0 audit baseline. Source inspection and upstream unit tests do not constitute Corn integration acceptance. Live M0 remains pending; product UI work must wait for the M0 acceptance gate.

## Fixed dependencies

| Runtime | Version | Immutable reference | Verification |
| --- | --- | --- | --- |
| DeepSeek Harness | `@deepseek-ai/dsh@0.2.0-rc.2` | Tag `dsh-v0.2.0-rc.2`; commit `639ed015397290b3745d163aafe02ffee4aa3f84` | Corn-owned developer Host boots; live HTTP/WS and restart checks passed |
| Claw Suite | `dsh-claw-suite@0.3.0-rc.2` | [Release v0.3.0-rc.2](https://github.com/xingyingyuzhui/dsh-claw-suite/releases/tag/v0.3.0-rc.2); asset `dsh-claw-suite-0.3.0-rc.2.tar.gz` | Downloaded published asset SHA256 and all 10 internal package checksums verified |

Claw release asset SHA256:

```text
99ea3c2007e36345e9b97874e8fb8f0337f607fdfb017bcaaea25fd1ef5808cb
```

All nine components in the published Suite package are exact dependency pins:

| Component | Exact version |
| --- | --- |
| `dsh-claw-core` | `0.3.0-rc.2` |
| `dsh-claw-policy` | `0.3.0-rc.2` |
| `dsh-claw-permissions` | `0.3.0-rc.2` |
| `dsh-claw-observability` | `0.3.0-rc.2` |
| `dsh-claw-identity` | `0.3.0-rc.2` |
| `dsh-claw-memory` | `0.3.0-rc.2` |
| `dsh-claw-gate` | `0.3.0-rc.2` |
| `dsh-claw-delegate` | `0.3.0-rc.2` |
| `dsh-claw-registry` | `0.3.0-rc.2` |

Every internal `dsh-claw-*` dependency in the component tarballs is also pinned to `0.3.0-rc.2`. Registry has the separate dependency `js-yaml:^4.1.0`. The DSH peer range is `^0.2.0-rc.1`; Corn fixes its own DSH version to RC2 rather than relying on that range. Component branch names such as `release/0.3.0-rc.1` are not immutable version evidence.

The local development distribution archive has a different outer checksum. Only the verified published asset is the release baseline.

## Integration contracts and acceptance

| Capability | Verified source contract | Corn acceptance |
| --- | --- | --- |
| Registry JSON routes | Connection Fetch; POST JSON; success `{ok:true,...}`; structured errors | Live authenticated calls and 401/403 negative cases passed; sandboxed diagnostic IPC passed |
| Agent creation | `registry/create` accepts `{name}`; creates workspace, policy, identity seeds, and registry entry | Real creation in Corn home passed |
| Preset readiness | `registry/preset/ensure` accepts `{agentId}`; uses public `agentPresets.register()` and readable base composition | Live ensure and re-registration after restart passed; missing preset rejected |
| Session binding | `registry/session/bind` accepts session/agent IDs, binding state, source, and optional `expectedRevision`; checks actual session cwd and preset | Real official Session creation/binding passed; nonexistent Session rejected |
| Binding state | `provisioning`, `needs_model`, `ready`; independent of Corn Run states | Metadata persistence and recovery pending |
| Identity and memory | Claw workspace cwd under isolated `DSH_HOME/DSclaw`; identity prompt section, memory tool and frozen prompt | Prompt injection, memory operations, and LLM review pending |
| Policy enforcement | Requires policy, permissions, and Gate components; permissions intersect official, agent, and session constraints | Live native Gate deny, ask/reject through Corn transport and cancel/withdraw passed; model-generated bash deny/reject passed; `run_code` is classified `other` and denied under every preset, so PTC nested calls are fail-closed and their per-call gating is not exercised |
| Computer use | Unrecognized tool names classify as `other`; Gate rejects that class | Native CUA adapter and permission mapping pending; do not advertise computer control as verified |
| Cancellation and execution recovery | Requires official runtime event and turn semantics | Native Turn cancellation preserves queue; snapshot reconnect, forced crash, automatic Host recovery, and real model cancel and log recovery (completed and mid-stream) passed |

Creation can return HTTP 200 with `presetError`. Corn must require a successful explicit preset readiness check before creating a session with the agent's `canonicalRoot` and `dshPreset`. A failed preset registration must not fall back to another preset.

`registry/list` performs migrations, synchronization, and persistence; it is not a read-only health probe. Registry writes should be serialized by the adapter and use revision checks where available. Claw binding state must not be interpreted as task execution state.

### Computer-use fail-closed boundary

RC2 `policy-schema.mjs` returns `other` for unrecognized tool names and `allowTool()` rejects that class. Installing the Suite does not make native `computer` or CUA tools compatible. MCP exposure additionally requires an allowed server. Corn must test the actual tool identity and map capabilities without disabling or bypassing Gate, sandbox, or approvals.

Relevant upstream files: `dsh-claw-policy/policy-schema.mjs`, `dsh-claw-permissions/perm-layers.mjs`, and `dsh-claw-gate/host.js` in the verified RC2 component packages.

## Independent runtime boundary

Corn owns its runtime dependencies, isolated DSH home, and `corn-dev` profile. Startup must not read, modify, or depend on an existing user DSH installation, Desktop application, profile, configured bot, authentication cookie, or model credential. Credentials must be configured explicitly for Corn and kept outside source control and renderer access.

Set the isolated `DSH_HOME` before loading plugins. Claw defaults to `DSH_HOME/DSclaw/<slug>`. DSH's first-use default workspace resolves the operating system Documents directory separately: override the pinned `workspace-controller` row's `documentsDirectory` with a Corn-owned absolute directory. Setting `DSH_HOME` alone does not isolate that first-use workspace location.

The Suite installer defaults to the `desktop` profile. Any development installation must pass the isolated profile name explicitly. Final profile manifests retain exact semver pins; local package resolution uses the release installer's overrides. Existing user profiles are not an installation target.

## Verification completed

On 2026-10-10, the following upstream test files ran with an isolated temporary `DSH_HOME`: **35 passed, 0 failed**.

```text
dsh-claw-registry/test/registry-host.test.mjs
dsh-claw-registry/test/registry-preset-supply.test.mjs
dsh-claw-gate/test/fail-closed.test.mjs
dsh-claw-gate/test/host-contract.test.mjs
dsh-claw-permissions/test/acceptance.test.mjs
```

The tested flat workspace component files were compared byte-for-byte with all files in the corresponding verified release tarballs. These tests exercise upstream contexts and policy fixtures. They do not establish that Corn can boot the independent runtime, authenticate its transport, call a model, answer an approval, or operate the current Mac.

**Live M0 acceptance is pending.** Record concrete results for independent boot and shutdown, endpoint authentication, preset provisioning, real streaming chat, cancellation, deny/ask/reject, isolated workspace placement, and reconnect/restart behavior before declaring M0 complete.

Corn's subsequent developer runtime evidence is recorded in [M0 evidence](milestones/M0-EVIDENCE.md). It establishes 16 Host integration checks, native governance/approval/queue checks and isolated baseline cold starts, together with real model lifecycle, fail-closed PTC governance and the unsigned packaged app. Signing and notarization remain deferred. Upstream test results above are separate evidence.
