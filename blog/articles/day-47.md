# SPF, DKIM and DMARC Explained: Protecting Your Domain From Email Spoofing

A domain name can be used to send legitimate email, but attackers can also place it in a message’s visible `From` field. SPF, DKIM, and DMARC are DNS-based email-authentication mechanisms that help receiving systems evaluate whether a message is authorized and aligned with the domain shown to a recipient. They are important controls, but they do not encrypt email, prevent every form of fraud, or guarantee delivery to the inbox.

> **Quick answer:** SPF lists servers authorized to send for an envelope domain. DKIM adds a cryptographic signature that a receiver can verify using a public key published in DNS. DMARC tells receivers how to evaluate alignment between the visible From domain and SPF or DKIM results, and can request reporting or a policy action. Configure them from your actual sending services, test carefully, and increase enforcement only after legitimate mail is accounted for.

## What email authentication can establish

Email uses several identity fields. The address a person sees in the `From` header is not always the same domain used in the SMTP envelope or the signing domain. SPF and DKIM evaluate identities at different parts of the transaction. DMARC connects those results to the domain visible in the From header using alignment rules.

Authentication helps a receiving service decide whether a message appears authorized by a domain. It does not prove that the human who wrote the message is trustworthy, that a link is safe, or that the content is legitimate. A compromised account or an authorized but abusive sender can still send harmful mail. Continue to use account security, anti-phishing controls, secure mail systems, and user education.

## SPF: which sending hosts are authorized?

Sender Policy Framework (SPF) is a DNS policy that identifies which sending hosts are authorized for a domain used in the SMTP envelope. A receiving mail server can compare the connecting host with that policy. SPF is evaluated against a particular identity; it does not directly authenticate the visible From field in every message.

A domain owner typically publishes SPF information as a DNS TXT record based on the instructions of its mail providers. The record may include a list of authorized sources or references to provider-managed policies. The exact mechanisms depend on the services actually sending mail, such as a business mailbox, support platform, newsletter service, or application notification system.

Important operational points:

- Inventory every service that sends mail using the domain or its subdomains.
- Publish the provider’s current SPF instructions rather than copying an old example.
- Avoid multiple conflicting SPF records for the same DNS name; receivers may treat them as an error.
- Keep the number and behavior of DNS lookups within the relevant specification’s limits.
- Do not authorize a server simply because it can send mail; confirm it is a legitimate, maintained source.
- Re-test after changing providers, hostnames, or sending infrastructure.

SPF has forwarding and envelope-identity limitations. A forwarded message may reach a receiver from a server not listed in the original sender’s SPF policy. This is one reason DMARC can use either aligned SPF or aligned DKIM to pass, rather than relying on SPF alone.

## DKIM: a signature tied to a domain

DomainKeys Identified Mail (DKIM) adds a digital signature to selected message headers and body content. The sending system signs with a private key; the receiving system looks up the corresponding public key in DNS using a selector and signing domain. If verification succeeds, the receiver has evidence that the signed parts were not altered in a way that breaks the signature and that the signer controls the key associated with that domain.

The domain owner usually configures DKIM through the mail provider. The provider supplies a selector and DNS record value; the sender then signs outgoing mail. Keep the private key protected by the provider or mail system, rotate it according to a plan, and remove obsolete selectors only after legitimate senders have moved. Do not publish a guessed or fabricated key record—use the exact current provider instructions.

A valid DKIM signature does not prove that the message is benign. It can be valid for a third-party service that is authorized to send but has a compromised account. Review which services are allowed to sign for the domain, what `d=` signing domain they use, and whether it aligns with the visible From domain for DMARC.

## DMARC: alignment, policy, and reports

Domain-based Message Authentication, Reporting, and Conformance (DMARC) lets a domain owner publish a policy and reporting preferences. A receiver evaluates whether SPF or DKIM passes with an identity aligned to the domain in the visible From header. Alignment can be configured in different modes; the exact behavior should be checked against the current standard and receiver support.

DMARC policies commonly include a monitoring mode that asks receivers not to apply a requested enforcement action, a quarantine request, or a reject request. A monitoring policy is useful while an organization discovers legitimate senders, but it does not itself block spoofing. Moving directly to strict enforcement without an inventory can cause valid messages to be rejected or quarantined.

Aggregate reports can show authentication outcomes and source infrastructure at a summarized level. They may include details about message volumes, sending IPs, and policy results. Decide who will receive them, how reports will be parsed, how long they will be retained, and whether the reporting address is prepared for the volume. Do not assume the report identifies an individual recipient or gives a complete view of every receiver.

| Mechanism | Main identity or evidence | What it contributes | What it does not prove |
|---|---|---|---|
| SPF | SMTP envelope identity and sending host | Whether a host is authorized by the published policy | That the visible From domain is aligned or the message is benign |
| DKIM | Signing domain and message signature | Whether the signed content verifies against a public key | That the signer or content is trustworthy |
| DMARC | Alignment with visible From domain | Policy request and aggregate reporting | Guaranteed inbox delivery or complete anti-fraud protection |

## A safe implementation sequence

1. **Inventory senders.** List mailboxes, transactional services, support systems, marketing platforms, and any legacy application that sends using the domain.
2. **Collect exact DNS instructions.** Ask each provider which SPF and DKIM records to publish and which From or signing domains it uses.
3. **Check the current zone.** Identify existing SPF, DKIM selectors, DMARC policy, and abandoned services. Coordinate with whoever manages DNS.
4. **Publish SPF and DKIM.** Avoid duplicate or conflicting records. Allow for DNS caching and provider verification steps.
5. **Start DMARC monitoring.** Send reports to a controlled mailbox or reporting service after reviewing privacy and retention.
6. **Classify legitimate sources.** Investigate unknown sources before blocking them; some may be forwarding, a forgotten service, or an attacker.
7. **Fix alignment.** Ensure legitimate mail can pass using aligned SPF or DKIM according to the chosen policy.
8. **Increase enforcement gradually.** Change policy only after testing normal mail flows and planning for exceptions.
9. **Recheck after changes.** Repeat the audit when a provider, application, or DNS configuration changes.

The actual DNS records are provider- and domain-specific. Sample strings found online are not safe to paste without understanding their mechanisms, includes, selectors, and policy effects. A malformed policy can reduce delivery or create false confidence.

## Common mistakes

A frequent mistake is adding a second SPF TXT record instead of editing the existing one. Another is removing an old provider before confirming that no application still sends through it. A DKIM record may be published under the wrong selector, or a key may be rotated without coordinating the sender. A DMARC policy may be set to reject before a forgotten billing system or password-reset service is aligned.

Do not treat SPF, DKIM, and DMARC as a bulk-email reputation service. They do not guarantee that a message avoids spam filtering. Receivers also use content, reputation, user settings, and other signals. Keep sending lists permission-based, protect mailbox accounts with MFA, monitor abuse, and maintain an unsubscribe and complaint-handling process where applicable.

## Domain owner audit checklist

- Are all authorized senders identified, including low-volume transactional mail?
- Is there exactly one valid SPF policy for each relevant sending domain?
- Are SPF DNS lookups and provider includes within supported limits?
- Does each sending service use DKIM with a current key and documented selector?
- Does at least one aligned mechanism pass for legitimate mail under DMARC?
- Are aggregate reports directed to a monitored and protected address?
- Has the team reviewed policy impact before moving to quarantine or reject?
- Are obsolete senders and DNS records removed deliberately?
- Are DNS changes logged with an owner and rollback plan?
- Are mailbox accounts, application credentials, and third-party integrations secured?

## Subdomains and service ownership

Email systems often use different subdomains for distinct purposes—for example, a company mailbox, support platform, or bulk notification service. Decide which domain appears in the visible From address and which domain each service uses for its envelope and DKIM signing identity. Policies published at a parent domain may interact with subdomains according to DMARC rules and receiver behavior, so verify inheritance and overrides before making changes.

A sending inventory should include the person responsible for each system, its vendor, the exact DNS records, and the date it was last tested. This makes cleanup safer when a service is retired. Removing a record that appears old can break a low-volume password reset or invoice sender that nobody remembered. Conversely, leaving a former provider authorized can expand the set of systems capable of sending as the domain.

## Read reports without over-interpreting them

Aggregate DMARC reports can identify sources that pass or fail SPF and DKIM and show whether alignment succeeded. A failed source might be a forgotten legitimate sender, forwarding behavior, a misconfigured service, or an unauthorized sender. Investigate before changing policy. Reports vary in coverage and format, and not every receiver sends them. They do not provide a complete forensic record of every message or prove the identity of an individual sender.

Use a dedicated reporting address or a trusted processor, restrict access, and decide how long reports are kept. Reports can contain IP addresses and domain-level traffic information. If an external service processes them, review its data handling and access controls. Keep a record of the policy state, observed legitimate sources, changes made, and date of the next review.

## Understand the visible From domain and alignment

DMARC evaluation centers on the domain in the visible From header. SPF may pass for a different envelope domain; DKIM may pass for a signing domain that belongs to a third-party service. A passing result is useful for DMARC only when the relevant identity aligns according to the selected mode. When a mail provider uses a branded sending domain, follow its instructions for custom return-path and signing-domain setup so alignment can be evaluated correctly.

Forwarders can complicate SPF because the receiving server sees a different sending host than the original sender. A valid DKIM signature may survive forwarding if the signed content is not changed, but mailing lists or gateways can alter a message. Review real reports and test representative mail paths rather than assuming every route behaves identically. If a business-critical message fails, identify the responsible provider and fix its configuration before tightening enforcement.

Keep a change log for DNS edits with the old and new value, approver, expected propagation, and rollback. DNS management is often shared across teams; a change made without notifying the mail administrator can cause an outage that appears unrelated to the website.

### Frequently asked questions

**Does SPF authenticate the visible From address?** SPF checks an SMTP envelope identity. DMARC uses alignment to connect authentication results to the visible From domain.

**Is DKIM encryption?** No. It is a signature mechanism; it does not hide the message contents.

**Does DMARC guarantee that spoofed messages are rejected?** A policy requests a handling action, but receiver behavior and policy support vary. Enforcement should be tested and monitored.

**Can SPF stop phishing from a compromised mailbox?** Not by itself. An attacker using an authorized account or service may pass SPF, so account security and monitoring remain important.

**Should a new domain use `p=reject` immediately?** Do not make that decision without inventorying senders, testing alignment, and assessing delivery impact. A staged rollout is safer.

## Conclusion

SPF, DKIM, and DMARC help receivers evaluate whether email is authorized and aligned with a domain. Their value depends on accurate DNS records, a complete sender inventory, and gradual policy enforcement. Verify current standards and provider instructions before changing production DNS, monitor reports for unexpected sources, and remember that email authentication is one part of a broader anti-phishing and account-security program.