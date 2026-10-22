# WHOIS vs RDAP: How to Research Domain Registration Data and Status Codes

WHOIS and the Registration Data Access Protocol (RDAP) are tools for looking up information about registered internet resources, including many domain names. They do not prove that a domain is legally safe, show every private contact detail, or always tell you whether a name can be registered. Data access and response details vary by registry, registrar, and applicable privacy rules.

> **Quick answer:** WHOIS is the older text-based query protocol and RDAP is a newer web-based, structured protocol. Both can return registration and status information, but data may be redacted, unavailable, or different across providers. Verify important facts with the relevant registrar or registry.

## What a lookup may show

A domain registration response can include the registrar, registration and expiration dates, nameservers, domain status codes, and links to registration services. Contact information may be redacted or omitted under privacy and data-protection rules. Some details can be stale, cached, or not supplied by the server.

A registration lookup is not the same as a DNS query. WHOIS/RDAP asks about registration data; DNS asks for records used to resolve a name. A domain can be registered but have no working website records, or it can resolve to a service while some registrant details are hidden.

## WHOIS and RDAP compared

| Feature | WHOIS | RDAP |
|---|---|---|
| Response format | Historically plain text, with provider-specific layouts | Structured JSON responses with standardized objects and links |
| Discovery | Often requires knowing the correct server or using a client directory | Supports service discovery and web-based access where implemented |
| Internationalization | Varies among services | Designed with internationalized data support in mind |
| Access control | Often limited or inconsistent | Can support differentiated access and response policies |
| Data availability | Depends on the registry/registrar | Also depends on the source and its access policy |

RDAP’s structured format can be easier for software to parse, but it does not make every record public or guarantee complete information. WHOIS may remain available in some contexts; follow current registry instructions.

## Understanding status codes

Status codes describe a registration’s state or restrictions. Common EPP-style examples include `clientTransferProhibited`, which may indicate a registrar-level transfer restriction, and `serverTransferProhibited`, which may indicate a registry-level restriction. Other codes can relate to renewal, update, deletion, hold, or dispute status.

Interpret the exact code using the current registrar, registry, or ICANN documentation. A transfer-prohibited status may be a normal security lock, not evidence of wrongdoing. A hold status may affect DNS delegation. The meaning and available remedy depend on the code, extension, and provider. Do not advise removing a lock without verifying the account owner and purpose.

## A research workflow

1. **Confirm the exact domain and TLD.** Similar names can have different registries and lookup services.
2. **Use a reliable lookup route.** Start with the registrar or registry’s official lookup page, or an RDAP service listed by an authoritative source.
3. **Record the date and source.** A query result is a snapshot and can change.
4. **Read status codes carefully.** Follow links or search official documentation for each code.
5. **Check DNS separately.** Query nameservers and records if your question is about website or email resolution.
6. **Contact the registrar for account or transfer issues.** Public lookup data cannot unlock or change a domain.
7. **Respect privacy.** Do not attempt to deanonymize a redacted registrant through invasive or deceptive methods.

## What the lookup cannot establish

A WHOIS or RDAP result cannot confirm that a seller is the legitimate owner, that a trademark search is clear, that the domain will transfer successfully, or that a website is safe. A listed expiration date may not reflect a pending renewal or registrar grace process. Redaction does not mean a domain is unowned; missing fields do not prove a fraud.

If you are buying a domain, use a trusted transaction process, verify seller control through the agreed workflow, and review legal and historical risks. If you are troubleshooting DNS, inspect the authoritative nameservers and records rather than relying only on registration data.

## Privacy and responsible use

Registration data can include personal information. Access and disclosure are governed by service policy and law. Use the data for legitimate operational or research purposes, comply with applicable privacy rules, and do not scrape or republish personal data without a lawful basis. A public endpoint is not permission to harass a registrant or bypass privacy controls.

### Frequently asked questions

**Is RDAP replacing WHOIS?** RDAP is the newer standardized protocol and has been adopted for many registration-data services, but availability and transitional arrangements vary. Check the relevant registry’s current instructions.

**Can I find the owner’s email?** Sometimes contact data is public, but it may be redacted or replaced with a contact form. Respect privacy rules and provider terms.

**Does an expiration date mean the domain is available then?** No. Renewal, redemption, deletion, and release processes vary. Do not rely on a displayed date as a drop-time guarantee.

**What does `clientTransferProhibited` mean?** It commonly indicates a client/registrar transfer restriction in the status model. Verify its exact meaning and removal process with the registrar.

**Can RDAP confirm a domain is available?** A lookup can indicate whether a registration record was found, but final availability, eligibility, and price should be confirmed with a registrar.

For protocol details, see [RFC 9082 (RDAP query format)](https://www.rfc-editor.org/rfc/rfc9082) and [RFC 9083 (RDAP JSON responses)](https://www.rfc-editor.org/rfc/rfc9083). Consult the relevant registry for live data and status-code interpretation.