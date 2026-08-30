# Virus Intelligence Database and Private Sample Vault Design

**Date:** 2026-08-30  
**Status:** Awaiting written-spec review  
**Scope:** Virus/threat intelligence catalog, feed imports, private malware sample vault, matching, and SOC integration

## 1. Goals

SOC-OS needs a dedicated virus intelligence module that can recognize known
malware, retain threat-intelligence provenance, correlate indicators with SOC
events, and preserve authorized malware samples for investigation.

The first implementation includes all of these source classes:

- internal indicator and signature records;
- external threat-intelligence feed imports;
- malware sample binaries stored in a private quarantine vault.

The module integrates with File Hash + Byte Analysis, Unified Alert Evidence,
quarantine, Node Gateway telemetry, VirtualBox host telemetry, and the SOC
pipeline. It does not turn the virus database into an execution service.

## 2. Safety boundaries and non-goals

The system must not:

- execute, detonate, or dynamically analyze samples in this phase;
- pass sample content to shell, `eval`, arbitrary subprocesses, an LLM, or an
  unapproved VirtualBox operation;
- expose sample binaries through public object paths;
- treat filename, MIME type, or a feed-claimed hash as authoritative;
- accept arbitrary remote URLs as feed or sample sources;
- silently share tenant-uploaded samples with another tenant;
- delete evidence, event hash-chain records, quarantine captures, matches, or
  audit history during retention cleanup;
- use plain SHA-256 as encryption.

TLS/mTLS protects service transport. HMAC-SHA-256 authenticates service
messages. SHA-256 is the canonical content identity and integrity hash.

Dynamic sample analysis is a separate future sandbox phase. It requires the
authorization execution-plane boundary and a dedicated isolated runtime; it is
not implied by storing a binary in the vault.

## 3. Architecture

```text
Node Gateway ───────────────┐
VirtualBox Gateway Agent ───┼──> API/SOC event normalization
External feed adapters ────┘              │
                                           ├── SHA-256 lookup
Sample intake ── private vault ────────────┤
                                           ├── byte/signature matching
                                           ├── quarantine / risk decision
                                           └── evidence + audit

PostgreSQL: catalog, provenance, matches, scan metadata, audit
Private App Storage: quarantined sample binaries only
```

PostgreSQL is authoritative for structured threat intelligence and sample
metadata. App Storage is only the private binary object store. Neither store
executes sample content.

## 4. Ownership and visibility

### 4.1 Global catalog

Canonical indicator metadata may be shared across tenants:

- SHA-256 indicators;
- family and alias mappings;
- severity and confidence;
- source provenance;
- first/last seen metadata;
- signature metadata and rule versions.

Global catalog entries are still versioned and auditable. Reclassification
does not overwrite the original feed provenance.

### 4.2 Tenant-private data

The following are tenant-scoped by default:

- uploaded sample binaries;
- sample access permissions;
- local observations and scan runs;
- event matches and resource context;
- analyst notes or tenant-specific classification.

Tenant scope is derived from the authenticated principal. A `tenantId` in a
request body or query string is not sufficient for authorization.

## 5. Data model

The database adds isolated tables:

```text
virus_families
virus_catalog_entries
virus_indicators
virus_feed_sources
virus_feed_imports
virus_samples
virus_sample_access
virus_matches
virus_scan_runs
virus_database_audit
```

### 5.1 Catalog records

`virus_families` stores normalized family names and aliases.

`virus_catalog_entries` stores the canonical threat record:

```text
familyId
canonicalName
severity
confidence
status: ACTIVE | REVOKED | SUPERSEDED
description
firstSeen
lastSeen
createdAt
updatedAt
```

`virus_indicators` stores typed indicators:

```text
catalogEntryId
indicatorType: SHA256 | BYTE_FINGERPRINT | SIGNATURE
normalizedValue
ruleVersion
sourceId
confidence
status
```

SHA-256 values are lowercase 64-character hexadecimal strings. Exact hashes
are unique after normalization. Byte fingerprints and signatures have
explicit types and versions; they are not represented as exact hashes.

### 5.2 Feed records

`virus_feed_sources` stores an approved source identity, adapter kind, status,
and sync policy. It does not allow arbitrary URL fetching.

`virus_feed_imports` stores source version/cursor, start/end timestamps,
imported/rejected/deduplicated counts, status, error code, and an idempotency
key. Repeating a source version or cursor is safe.

### 5.3 Sample records

`virus_samples` stores metadata and private object reference:

```text
tenantId
sha256
objectPath
sizeBytes
declaredName
declaredContentType
sourceType
sourceReference
status: UPLOADING | QUARANTINED | HASH_VERIFIED | REJECTED | TOMBSTONED
retentionUntil
createdAt
verifiedAt
```

The computed SHA-256 is authoritative. A claimed hash may be retained as
untrusted input for audit, but never determines identity.

`virus_sample_access` records the principal, capability, purpose, decision,
and timestamp for metadata access, download request, or retention action.

### 5.4 Matches and scan records

`virus_matches` stores:

```text
tenantId
eventId
sampleId
indicatorId
matchType: EXACT_HASH | BYTE_FINGERPRINT | SIGNATURE
matchedValue
confidence
severity
sourceId
nodeId / hostId / vmId
evidenceReference
createdAt
```

`virus_scan_runs` stores bounded lookup or static inspection metadata without
storing executable results as commands. It records scanner version, input
hash, status, findings summary, and correlation ID.

`virus_database_audit` is append-only and records intake, import, verdict,
access, reclassification, and retention events.

## 6. Storage and intake

### 6.1 Private sample vault

Binary samples are stored under a private, content-addressed path such as:

```text
private://virus-samples/quarantine/{sha256}
```

The implementation uses the private object storage path, never a public object
search path. The browser never receives a binary on ordinary list or detail
requests.

The sample flow is:

```text
authorized intake request
→ private presigned upload
→ bounded size check
→ server-side SHA-256 verification
→ metadata validation
→ QUARANTINED / HASH_VERIFIED
→ catalog association
```

Initial sample size is bounded by configuration, with a 50 MB default for the
first rollout. The limit applies before processing and is not bypassed by
compression or nested archives. Archive extraction is not performed by the
intake path.

### 6.2 Access policy

Sample download requires an explicit capability and purpose. The server
returns a short-lived authorized URL only after policy and tenant checks.
Every request is audited.

No public URL, inline browser preview, automatic download, or sample handoff
to a dynamic analyzer exists in the initial phase.

### 6.3 Feed import

Approved adapters may import indicator metadata and provenance. Adapters
support source-specific authentication through managed integrations or
environment secrets; credentials are not stored in catalog rows or exposed in
chat, logs, or audit payloads.

Feed records are normalized, validated, and deduplicated by canonical SHA-256
where applicable. Invalid values are rejected into an import report. An
optional feed sample reference is metadata only unless a separately authorized
sample intake is performed.

## 7. Matching and SOC behavior

The event normalization path performs bounded matching:

```text
normalized event / telemetry
→ exact SHA-256 lookup
→ byte fingerprint lookup
→ versioned signature lookup
→ match confidence and severity
→ correlation / evidence link
→ SOC decision
```

Exact SHA-256 match is deterministic. Byte and signature matches include rule
version, evidence reference, and confidence; they are never mislabeled as
exact matches.

An active malicious match may increase risk and trigger `ISOLATE`. The
response path:

- creates or links quarantine capture;
- sets execution/network access disabled in the logical envelope;
- preserves match and evidence references;
- may create a self-healing preview for an eligible managed resource;
- never executes the sample;
- never changes the original event hash-chain record.

Unknown samples remain `QUARANTINED` until policy assigns a disposition.
Untrusted or conflicting feed claims produce an explicit review state rather
than silently becoming a trusted verdict.

## 8. API surface

The central API exposes:

```text
GET  /api/virus-db/entries
POST /api/virus-db/entries
GET  /api/virus-db/entries/{id}
POST /api/virus-db/indicators/lookup
POST /api/virus-db/samples/intake
GET  /api/virus-db/samples/{id}/metadata
POST /api/virus-db/samples/{id}/download-request
GET  /api/virus-db/feeds
POST /api/virus-db/feeds/{id}/sync
GET  /api/virus-db/matches
GET  /api/virus-db/audit
```

All request bodies and responses are schema-validated. Write, upload,
download, feed-sync, and reclassification endpoints require authenticated
principal and capability checks. The current unauthenticated control routes
must not be reused for private sample access.

## 9. Indexes and database safety

Required indexes include:

- normalized exact SHA-256;
- `(indicatorType, normalizedValue)`;
- family and catalog status;
- severity, confidence, and source;
- sample `(tenantId, sha256)`;
- match `(tenantId, eventId)`;
- match `(tenantId, createdAt)`;
- feed `(sourceId, sourceVersion/cursor)`;
- audit `(tenantId, createdAt)`.

Constraints enforce lowercase SHA-256 format, bounded statuses, valid
non-negative sample size, and unique source import idempotency. Private data
queries always include tenant predicates and use the authenticated principal's
scope.

Schema changes are additive first. Development migration and HCK-BIOS schema
readiness are required before enabling intake or feed sync. Production is not
modified as part of design work.

## 10. Dashboard

The SOC dashboard adds `/virus-database` with:

1. **Threat Catalog** — families, aliases, indicators, severity, confidence;
2. **Hash Lookup** — exact SHA-256 lookup and evidence links;
3. **Sample Vault** — metadata, status, size, retention, and access state;
4. **Feed Imports** — source, version/cursor, counts, errors, last sync;
5. **Matches** — event/node/host/VM context and SOC outcome;
6. **Audit** — immutable intake, access, verdict, and retention events.

Sample content is not rendered inline. The download control is hidden or
disabled when the operator lacks the required capability. Loading, empty,
error, rejected, and quarantined states are explicit.

## 11. Verification

### Integrity and intake

- server-computed hash is authoritative;
- claimed/computed hash mismatch is rejected;
- duplicate hash deduplicates safely;
- malformed metadata and oversized samples are rejected;
- archive/nested-content limits cannot bypass size policy;
- private sample object is not available through public paths.

### Authorization and tenancy

- unauthenticated upload/download is denied;
- cross-tenant sample access is denied;
- catalog visibility does not imply sample access;
- every download and reclassification creates audit;
- invalid capability and status transitions fail closed.

### Matching

- exact hash lookup is deterministic and indexed;
- byte/signature match preserves type/version/confidence;
- feed reimport is idempotent;
- revoked catalog entries preserve historical matches;
- malicious match can trigger quarantine without execution;
- event evidence and hash chain remain unchanged.

### Operations

- feed adapter failures produce explicit import errors;
- no unbounded retry storm;
- object storage outage does not create a false verified sample;
- database outage does not create a false positive “stored” response;
- audit write failure blocks sensitive state transitions.

## 12. Rollout

1. Add schema and metadata-only catalog with synthetic benign fixtures.
2. Add exact SHA-256 lookup and event correlation.
3. Provision private object storage and enable authorized sample intake.
4. Add feed adapter interface and one controlled source at a time.
5. Add byte/signature matching with versioned rules.
6. Add dashboard, access workflow, retention, and audit review.
7. Add optional bounded static analysis.
8. Design and authorize dynamic sandbox analysis separately.

The first release is complete only when PostgreSQL schema readiness is
reported by HCK-BIOS, private sample paths are non-public, hash verification
and tenant authorization tests pass, matching integrates with quarantine,
browser E2E covers catalog/intake/lookup/audit states, and no sample reaches
an execution path.