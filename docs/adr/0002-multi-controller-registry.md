# Multi-controller registry for cross-node pairing

## Status

Accepted

## Context

A mailbox **name** must work on any **node** the user opts into. WebAuthn credentials are bound to each **node**'s domain, so one passkey cannot sign on another origin. Users move by pairing: the old **node** authorizes adding a new controller and shipping a sealed **DEK**.

## Decision

- A **name** may have up to 8 **controllers** (WebAuthn P-256 keys).
- `linkNode` adds a controller and opts in the inviting **node** in one signed write.
- `optIn`, `optOut`, and `removeController` accept a signature from any current controller.
- Controllers are added, not rotated: the old key stays valid until explicitly removed.

## Consequences

- A user can leave a **node** without returning to it (opt-out and remove-controller from the new **node**).
- Pairing requires one ceremony on the **node** that still holds the original passkey.
- The registry contract must be redeployed; there is no in-place migration of single-controller records.
