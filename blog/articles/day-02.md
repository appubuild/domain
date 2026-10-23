# How DNS Works: From Typing a Domain Name to Loading a Website

Typing `shop.example.com` into a browser starts two jobs that are easy to confuse: DNS finds the service associated with the name, and the browser then makes a web request to that service. DNS does not download the page, decide whether the page is safe, or guarantee that a website is available. It supplies naming information that other systems use.

> **Quick answer:** A recursive resolver checks its cache and, when needed, follows DNS referrals from the root to a top-level-domain server and then to the domain’s authoritative nameserver. It returns the relevant answer to the client. The browser uses that answer to connect to the web service.

## The people and servers in a lookup

A DNS lookup involves a **stub resolver** on the user’s device and a **recursive resolver** that does the wider lookup on the client’s behalf. The recursive resolver may be operated by an internet provider, employer, university, or public DNS service. A browser may also use an encrypted DNS transport, but the basic naming hierarchy still matters.

DNS information is distributed. Root servers direct resolvers toward the servers responsible for a top-level domain (TLD), such as `.com`. A TLD nameserver directs the resolver toward the authoritative nameservers for a particular registered domain. The authoritative nameserver holds the zone’s current records. A root server does not contain a list of every website’s address.

## A lookup, step by step

Imagine a visitor enters `shop.lumenbikes.example`. The name is fictional; `.example` is intended for examples.

1. **The client checks available caches.** The browser, operating system, local network, or recursive resolver may already hold a usable answer. If the answer is fresh, the lookup can stop there.
2. **The stub asks a recursive resolver.** The client normally asks one resolver to find the answer. It does not usually contact the root, TLD, and authoritative servers itself.
3. **The recursive resolver checks its cache.** A cached record can satisfy the request until its time to live (TTL) expires. If there is no suitable answer, the resolver begins following referrals.
4. **The resolver asks the DNS hierarchy.** It can ask a root server where to find the TLD, the TLD server where to find the domain’s authoritative nameservers, and an authoritative server for the requested record.
5. **The authoritative server answers.** Depending on the configuration and query, the answer may be an A or AAAA record, an alias, a negative answer, or another response. The resolver may follow a CNAME to learn the target’s address.
6. **The resolver returns and caches the result.** It sends the answer back to the client and may cache it according to the record’s TTL and other rules.
7. **The browser makes a web request.** DNS lookup is only one step. The browser still needs to establish a connection, negotiate TLS for HTTPS, send an HTTP request, and receive a response.

This description is simplified. Real resolver behavior includes retries, delegation checks, multiple records, DNSSEC validation where enabled, and different caching rules.

## Which records can appear?

| Record | Typical purpose | What to remember |
|---|---|---|
| A | Maps a name to an IPv4 address | It is not the only way a website can be routed. |
| AAAA | Maps a name to an IPv6 address | IPv6 support and routing must also be configured. |
| CNAME | Makes one name an alias of another | It does not itself contain the final address; the resolver follows the target. |
| MX | Identifies mail exchangers for a domain | Mail delivery also depends on the mail service’s other requirements. |
| TXT | Publishes text data, often for verification or policy | A TXT record is not automatically a security guarantee. |
| NS | Identifies authoritative nameservers for a zone | Changing delegation can change which DNS zone answers. |

Use the service provider’s current instructions rather than copying a record from a different product or account. A DNS zone can serve a website, mail, verification, and other services at the same time.

## TTL, caching, and “propagation”

A TTL tells caches how long a particular DNS answer may be retained. When an operator edits the authoritative record, an existing cached answer may still be used until it expires. That is why a change can appear at different times to different users. “DNS propagation” is common shorthand for the combined effect of caches and resolver behavior; there is no single global button that refreshes every cache.

If you are planning a migration, inspect existing records and lower a TTL ahead of the change only if you understand the current zone and the provider supports that plan. A lower TTL can increase query volume. It also does not force a cache to discard an answer it already obtained under an earlier TTL.

## DNSSEC: what it adds

DNS Security Extensions (DNSSEC) let validating resolvers check that signed DNS data is authentic and has not been altered in transit. DNSSEC does not encrypt DNS queries, hide a domain name, or protect a website from every attack. A broken chain of signatures or incorrect key rollover can make a validating resolver reject data, so enable it only when the registrar, DNS provider, and parent delegation are configured consistently.

## How to investigate a lookup problem

Start by writing down the exact name, record type, resolver, and time of the test. Then:

- Check the record at the authoritative nameserver, not only in a browser.
- Compare with a second recursive resolver; note that the two may have different caches.
- Inspect TTLs and look for stale or duplicated records.
- Confirm the domain is delegated to the nameservers that contain the intended zone.
- Check the web host separately: a correct DNS answer does not prove the server is responding.
- For email, check MX and any provider-required TXT records as well as the mail service itself.

Command-line tools such as `dig` and `nslookup` can expose responses, but flags and availability vary by operating system. Treat a command result as evidence from that particular resolver, not as universal visibility.

## Common misconceptions

**“The root server returns my website’s IP.”** Usually it returns a referral toward the TLD. The authoritative zone supplies the domain’s record.

**“A domain has one permanent address.”** A name can have multiple records, aliases, changing addresses, or answers served through a CDN.

**“If one device sees the new value, everyone does.”** Different caches and network paths can produce different results for a while.

**“DNS changes the website files.”** DNS directs names to services; it does not edit the content on a server.

## A safe DNS-change checklist

Before changing records, export or record the current zone. Identify every service using the domain, especially email and subdomains. Add the new records at the provider that will be authoritative, confirm nameserver delegation, and test from more than one resolver. Keep the old setup available until the new website and mail services work. If you do not know what a record supports, ask the provider before deleting it.

### Frequently asked questions

**Does DNS choose which web page opens?** DNS helps locate the service. The web server and application decide what page or response to return for a path such as `/products`.

**Why does a website fail when email still works?** Website and mail use different records and services. A broken A/AAAA or web alias can coexist with working MX records.

**Can I use a domain before buying hosting?** Yes. You can register a name and configure it later, use it for email, or point it to another service. Registration alone does not create a website.

**How long do DNS changes take?** There is no universal duration. It depends on TTLs, caches, delegation, provider behavior, and the records changed. Check the actual responses instead of promising a fixed wait.

For foundational concepts, see the DNS standards [RFC 1034](https://www.rfc-editor.org/rfc/rfc1034) and [RFC 1035](https://www.rfc-editor.org/rfc/rfc1035), and the IETF’s [DNSSEC introduction](https://www.rfc-editor.org/rfc/rfc4033). Those references are further reading; current provider behavior should be checked with the provider.