# Web Application Threat Modeling: How to Identify Risks Before They Become Incidents

Threat modeling is a structured way to ask how an application could be misused or fail before an incident forces the question. It is not a one-time compliance form and does not require a large security team. A small product team can make a useful model by listing important assets, drawing how data moves, identifying trust boundaries, and deciding which threats deserve controls first.

> **Quick answer:** Start with the system’s purpose and assets, sketch the components and data flows, mark where trust changes, and examine each flow for threats to confidentiality, integrity, availability, and accountability. Frameworks such as STRIDE provide prompts, not a complete risk score. Prioritize mitigations by likelihood, impact, and feasibility, then revisit the model when the product or infrastructure changes.

## What belongs in a threat model

A **threat** is a potential event that could cause harm, such as an unauthorized account change or an outage. A **vulnerability** is a weakness that could help an event occur. **Risk** combines a plausible threat with the potential impact and likelihood in the specific context. The labels are sometimes used differently, so a team should agree on its definitions and record assumptions.

Begin by defining scope. A model for a static blog is different from one for a registrar account system. Write down what the product does, who uses it, what it connects to, and what is out of scope. Include an environment and data classification: public article content, private account records, credentials, payment state, and operational logs do not have the same sensitivity.

A simple data-flow diagram is often enough for the first review:

```text
Visitor → browser → public site / API gateway → application service
                                  │                 ├── database
                                  │                 └── lookup provider
                                  └── analytics or error reporting service
```

Add where users authenticate, where data is stored, where secrets are kept, and where external providers receive information. Use arrows to represent requests and responses. Mark boundaries such as browser-to-server, public-to-private network, tenant-to-tenant, and organization-to-third-party.

## Identify assets and trust boundaries

An **asset** is something worth protecting or keeping available. It can be data, a credential, a business process, service reputation, or an operational capability. For a domain research tool, assets might include account sessions, saved candidate lists, provider API keys, lookup quotas, email addresses, and DNS-management permissions.

A **trust boundary** is a point where data or authority crosses between actors or components with different trust levels. Examples include a public form sending input to a server, a gateway forwarding a user identity to an application, or an API response arriving from a third party. Every boundary deserves a question: who can send data here, how is it authenticated, and which system validates it?

The browser is under the visitor’s control. Client-side validation improves usability but cannot enforce access control. A request can be modified before it reaches the server. Similarly, a field named `userId` in a JSON body does not prove that the caller owns that account. Enforce resource authorization on the server for each operation.

## Use STRIDE as a prompt list

STRIDE groups threat prompts into six categories: spoofing, tampering, repudiation, information disclosure, denial of service, and elevation of privilege. It is a brainstorming aid, not a substitute for domain expertise or a prediction that every category applies equally.

| STRIDE category | Question to ask | Example area to review |
|---|---|---|
| Spoofing | Can an attacker impersonate a user, service, or provider? | Login, webhook, service identity |
| Tampering | Can data or a request be changed without authorization? | DNS settings, saved lists, API parameters |
| Repudiation | Can an important action lack a trustworthy record? | Account changes and approvals |
| Information disclosure | Can private data reach an unintended person or system? | Shared cache, logs, exports, API response |
| Denial of service | Can a request exhaust service or provider capacity? | Search endpoint, expensive lookup, file upload |
| Elevation of privilege | Can a user gain more access than intended? | Role checks, tenant boundaries, admin actions |

For every relevant threat, note an existing control, evidence that it works, and a follow-up owner. If the control is only “the client hides the button,” it is not a server-side access-control measure.

## Example: a domain generator and lookup service

Imagine a site that has a browser-based idea generator and an optional API that queries an external registration-data provider. The generator may not store input at all. The lookup service receives a domain, calls a provider, and returns a status. Each component creates different risks.

- **Confidentiality:** Candidate names may be sensitive. Do not log or transmit them to analytics unless the purpose is necessary, disclosed, and appropriately controlled.
- **Integrity:** A user may try to retrieve another account’s saved list by changing an identifier. Check ownership on every request.
- **Availability:** A script could request lookups in a tight loop. Apply quotas, timeouts, batch limits, and provider-aware rate controls.
- **Accuracy:** A provider timeout or empty response might be misread as “available.” Return `unknown` with source and time instead of guessing.
- **Secrets:** The upstream credential must remain server-side, scoped to the lookup function, and rotated if exposed.
- **Third parties:** Search inputs or logs sent to analytics, hosting, or monitoring providers create additional data flows that should be reviewed.

A simple risk matrix can help prioritize, but avoid a false sense of mathematical precision. Label impact and likelihood qualitatively, explain why, and decide who will reduce the risk. A low-likelihood, high-impact account takeover may still deserve attention before a frequent but harmless UI bug.

## Choose mitigations that address the threat

Mitigation should sit at the layer that has the necessary authority. Input validation can reduce malformed requests; parameterized queries prevent a class of database injection; authentication identifies a caller; authorization limits the caller to permitted resources; rate limits bound work; backups support recovery. No single control covers all threats.

For web applications, review:

- Secure authentication, session expiration, and account recovery.
- Server-side authorization on every protected record and action.
- Input validation, output encoding, and safe file handling.
- Secret storage, key rotation, and least-privilege service identities.
- HTTPS and secure configuration for every public and internal connection.
- Rate limits and abuse monitoring for expensive operations.
- Safe cache keys and explicit behavior for personalized responses.
- Dependency updates, build integrity, and deployment permissions.
- Logging that supports investigation without exposing credentials or private searches.
- Tested backup, incident response, and rollback procedures.

Controls should be testable. A review can ask for an automated test that proves one account cannot read another account’s record, a configuration check that catches a public secret, or a restoration exercise that confirms the backup can be used. A written policy without evidence may not reduce the underlying risk.

## Keep the model current

Threat models go stale when architecture changes. Revisit them when a site adds accounts, payment, a new API provider, file uploads, a browser extension, AI tools, or a new data-retention practice. Also revisit after incidents, major dependency changes, a shift to multi-tenant hosting, or a new type of user.

A lightweight review can take place in a normal planning meeting. Ask what new data enters the system, who can access it, what happens if a dependency is unavailable, and which action could cause irreversible harm. Record decisions and accepted risks with an owner and review date. If a risk requires legal, privacy, or specialist security advice, escalate it rather than pretending a checklist settles the question.

## A one-page review worksheet

1. **System:** What user task does this feature support?
2. **Assets:** What data, credentials, money, or availability must be protected?
3. **Actors:** Which users, services, administrators, and third parties interact with it?
4. **Flow:** Where does data enter, move, get stored, and leave?
5. **Boundaries:** Where does trust or privilege change?
6. **Threats:** What could be spoofed, changed, denied, exposed, disrupted, or over-privileged?
7. **Controls:** Which preventive, detective, and recovery controls exist?
8. **Evidence:** What test, log, review, or exercise demonstrates the control works?
9. **Priorities:** Which issue has the highest plausible impact, and who owns it?
10. **Review date:** What change should trigger the next update?

## Walk one feature through STRIDE

Take a saved-domain endpoint as a concrete example. For **spoofing**, ask whether a stolen session can impersonate an account. For **tampering**, ask whether an attacker can alter a saved list or submit a different account identifier. For **repudiation**, ask whether an administrator can reconstruct who changed a record. For **information disclosure**, check whether an API response or shared cache reveals another user’s candidates. For **denial of service**, consider oversized batches and repeated provider lookups. For **elevation of privilege**, test whether a standard account can reach an administrative operation.

The review should identify evidence, not just ideas. Authentication tests can prove a missing session is rejected. Authorization tests can try a second account’s record ID. Rate-limit tests can show that a batch is bounded. A logging review can verify that tokens and private names are redacted. A tabletop exercise can show whether the incident contact is known. If the team cannot demonstrate a control, record it as an assumption and decide whether it needs verification.

## Prioritize and assign risk owners

A simple matrix can categorize impact and likelihood as low, medium, or high, but the labels need definitions. “High likelihood” might mean a public endpoint is routinely exposed to untrusted input, not a claim that a specific attack will happen. “High impact” should describe the actual consequence, such as loss of account access or exposure of private data. Include uncertainty and dependencies in the note.

Prioritize risks that combine broad exposure with a serious consequence, especially when a simple control is available. A missing server-side ownership check is usually more urgent than a small visual defect. Some risks require a design decision rather than a code patch: for example, whether to store a naming query at all. Assign one person to each follow-up and a date to review accepted risks. A risk without an owner tends to remain a sentence in a document.

## Defensive review worksheet for a domain tool

- List every public route, API, upload, admin action, and third-party integration.
- Identify which routes use account credentials and which are anonymous.
- Check that provider keys never enter the browser bundle or logs.
- Test cross-account access, invalid input, oversized requests, and repeated submissions.
- Confirm that provider outages return an explicit unknown state.
- Review analytics, error reports, and backups for candidate-domain data.
- Verify who can change DNS, billing, and recovery settings.
- Confirm there is a way to disable a compromised key and restore service.

## Distinguish prevention, detection, and recovery

A threat model should include all three control types. Prevention may block a user from reading another account’s saved list. Detection may alert on repeated access denials or an unusual number of lookups. Recovery may revoke a credential, restore a backup, or provide a user notification. Prevention can fail; detection without an owner may be ignored; recovery without tested backups may take too long. Map each high-impact threat to at least one control that can be demonstrated.

Prioritize security work alongside product changes rather than postponing it until the end. A new file-upload feature changes the attack surface; a new analytics integration changes the data flow; a new admin role changes privilege boundaries. Review those changes in the design stage when they are still inexpensive to adjust, and update the diagram after implementation to reflect what was actually built.

### Frequently asked questions

**Do small projects need threat modeling?** Yes, at an appropriate scale. A short diagram and risk discussion can catch exposed secrets or missing authorization before launch.

**Is STRIDE a risk score?** No. It provides categories for considering threats. Teams still need to assess context, impact, likelihood, and available evidence.

**Does HTTPS prevent all web attacks?** No. It protects a network connection against some threats, but it does not fix authorization, unsafe code, compromised accounts, or malicious content.

**Should every risk be eliminated?** Not always possible. Prioritize, mitigate, transfer, or formally accept risks based on impact, obligations, and resources, then review the decision.

**When should I revisit the model?** When data flows, user roles, integrations, deployment, or business consequences change—and after a security incident.

## Conclusion

Threat modeling makes security questions concrete before code is released. Map assets and data flows, mark trust boundaries, use STRIDE or another framework to prompt discussion, and assign controls that can be tested. Keep the model proportional and current. A brief, honest review that leads to a specific fix is more valuable than a large checklist that nobody owns.