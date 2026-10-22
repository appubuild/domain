# DNS Records Explained: A, AAAA, CNAME, MX, TXT and NS With Examples

DNS records publish information about names in a DNS zone. A website, email service, domain verification, and subdomains may all depend on different records. Editing one record can affect only one service—or, if nameservers are changed, the entire zone. The safest approach is to understand the record’s purpose, save the current zone, and follow the provider’s instructions.

> **Quick answer:** A and AAAA records map names to IPv4 and IPv6 addresses; CNAME aliases one name to another; MX identifies mail exchangers; TXT publishes text data used for verification and policies; NS identifies authoritative nameservers. Exact values come from the service you are configuring.

## A sample zone (fictional)

| Name | Type | Example value | Typical role |
|---|---|---|---|
| `@` | A | `192.0.2.25` | IPv4 destination for the zone’s apex name. |
| `@` | AAAA | `2001:db8::25` | IPv6 destination for the apex. |
| `www` | CNAME | `shops.example.net.` | Alias for a provider-managed host name. |
| `@` | MX | `10 mail.example.net.` | Mail exchanger with a preference value. |
| `@` | TXT | `"v=spf1 …"` | Example placeholder for a mail or verification policy. |
| `@` | NS | `ns1.dns.example.` | Delegation/authoritative nameserver data, depending on zone context. |

The example uses documentation-only address ranges and placeholder names; it is not a working production zone. The `@` shorthand is used by many DNS control panels to mean the zone apex, but interfaces vary. Do not paste these sample values into a real domain.

## A and AAAA: address records

An A record returns an IPv4 address for a name. An AAAA record returns an IPv6 address. A domain may have several records of either type, and services may update them. If a provider gives you an address, copy it exactly and verify whether the record should be at the apex, `www`, or another subdomain.

Having an AAAA record when the service is not reachable over IPv6 can create inconsistent user experiences. Conversely, omitting IPv6 may be intentional for a provider that does not support it. Use the host’s current configuration guidance and test both paths.

## CNAME: an alias

A CNAME points one DNS name to another name. The resolver follows the alias to obtain the target’s data. Many DNS standards restrict placing other record types at the same owner name as a CNAME, so control-panel behavior at the zone apex can involve provider-specific flattening or alias features. Ask the DNS provider how its apex-alias feature works rather than assuming it is a standard CNAME.

A CNAME is commonly used for `www` or a service subdomain. It does not replace MX records for the root domain, and it is not an IP address. If a provider says to create a CNAME, confirm the exact host/name field and target format in that provider’s guide.

## MX: mail routing

MX records identify mail exchangers for a domain. They include a preference value; lower numbers are generally tried before higher values. The mail host names must resolve as required. Mail delivery also depends on the receiving and sending services, mailbox setup, and often TXT records such as SPF, DKIM, and DMARC policies. A correct MX record alone does not prove email will send reliably or pass authentication.

When moving email providers, add and verify the new provider’s records before removing old ones, if the provider’s migration process recommends overlap. Preserve mail records when changing nameservers. Test inbound and outbound messages, not only a provider’s “verified” indicator.

## TXT: verification and policy text

TXT records publish text strings. Services use them for domain control checks, email authentication, and other configuration. Some policies require more than one string or a specific host label. DNS control panels may split or quote values differently; follow the provider’s exact instructions.

Do not overwrite an existing TXT record simply because a second service asks you to add one. A name can have multiple TXT records, subject to service and DNS constraints. Keep a list of who requested each value and when it can be removed.

## NS: who answers for the zone

Nameserver delegation determines which DNS provider is authoritative. Changing the registrar’s nameserver setting can switch the entire domain to a different DNS zone. The new provider must be ready with all needed records before delegation changes. The registrar and authoritative DNS provider can be different companies.

## TTL and record conflicts

The TTL affects how long a record may be cached. It is not an instruction to delete the old record globally. Multiple A or AAAA answers may be intentional, while conflicting CNAMEs or duplicate configuration can be problematic. Check the exact owner name, type, target, TTL, and provider instructions before saving.

## Safe DNS editing workflow

1. Export or screenshot the current zone and identify website, mail, verification, and subdomain dependencies.
2. Confirm which provider is authoritative by checking the delegated nameservers.
3. Read the destination service’s current setup instructions.
4. Add or edit only the required record, preserving unrelated entries.
5. Verify the result at the authoritative nameserver and through recursive resolvers.
6. Test the real service: open the website, send and receive email, or complete the verification workflow.
7. Keep a rollback copy until the change has been stable.

### Frequently asked questions

**Can an apex domain use a CNAME?** Standard DNS has restrictions, though some providers offer flattening or alias features. Check that provider’s implementation.

**Can I have multiple TXT records?** Often yes, but values and policy syntax matter. Avoid replacing existing records without understanding them.

**Will changing an A record affect email?** Not usually by itself, but changing nameservers or a broad zone can. Review the whole zone.

**What is a DNS host?** It is the provider operating authoritative DNS for the zone. It may be separate from the registrar and web host.

**Can I copy records from an online example?** Use examples to understand record types, not as production values. Obtain exact targets from your own provider.

For the DNS record model, consult [RFC 1034](https://www.rfc-editor.org/rfc/rfc1034) and [RFC 1035](https://www.rfc-editor.org/rfc/rfc1035). Provider dashboards may add conveniences that are not identical across vendors.