# CDN, DNS and Web Hosting: What Each Service Does and How They Work Together

A domain name, DNS provider, content delivery network (CDN), and web host are related but not interchangeable. DNS helps a client locate a service. A CDN can cache or deliver content from distributed points of presence. The origin host runs the website or application. One company may sell several of these services, but the configuration responsibilities still need to be clear.

> **Quick answer:** the browser asks DNS where to connect; the DNS answer may lead to a CDN or directly to the origin host. The CDN may return a cached response or forward the request to the origin. The host runs or stores the application. Each layer has separate settings, logs, and failure modes.

## The roles

**DNS** publishes records and delegations for domain names. A recursive resolver obtains answers, while authoritative nameservers serve the zone. DNS does not store the site’s HTML files and does not, by itself, cache every page.

**A CDN** is a network of edge locations and services that can cache content, terminate TLS, filter traffic, compress responses, or route requests. The exact features depend on the provider and plan. A CDN is not always a simple image cache; it can become a reverse proxy in front of the origin.

**The origin host** is the server or platform that stores static files or runs the website application. It may be a traditional host, cloud platform, static hosting provider, or a managed service.

## A typical request path

A simple architecture can look like this:

1. A visitor requests `www.example.com`.
2. DNS resolves the name to the CDN or service endpoint configured for the domain.
3. The browser connects to the CDN over HTTPS.
4. The CDN checks whether it has a valid cached response for the request.
5. If the response is not cached—or must be revalidated—the CDN contacts the origin host.
6. The origin returns content or an error; the CDN may cache or transform the response under its rules.
7. The CDN returns a response to the browser.

Some architectures send traffic directly to the host, use multiple CDNs, or route APIs separately. The diagram is conceptual; follow the actual provider’s architecture and DNS instructions.

## Why put a CDN in front?

A CDN can serve cacheable content closer to users, reduce repeated origin requests, and provide security or traffic-management features. Whether it improves a particular site depends on where users are, what content can be cached, configuration, and the provider’s network. Dynamic, personalized, or frequently changing content may not benefit from ordinary caching.

A CDN can also introduce additional complexity. There may be separate browser-to-CDN and CDN-to-origin TLS settings, cache keys, redirects, access rules, origin IP controls, and logs. Misconfiguration can expose an origin that was intended to be private or cause the CDN to cache content that should remain user-specific.

## Cache behavior in practice

A cacheable response usually depends on HTTP cache directives, provider configuration, URL, headers, and the CDN’s rules. Do not assume that every response is cached or that a “purge” clears every intermediate cache immediately. A stale page may come from the browser, a recursive DNS cache, the CDN, a proxy, or the origin itself; these are different caches.

Before enabling caching, identify public and private routes. Product images and static CSS may be good candidates, while account pages and personalized responses need careful controls. Test the cache status and response headers for both anonymous and logged-in sessions. Never use a broad cache rule on sensitive content without understanding the consequences.

## Choosing the DNS and hosting arrangement

You can keep DNS at the registrar, use a separate DNS provider, and host the site elsewhere. The registrar controls registration; the authoritative DNS provider answers DNS queries; the CDN may receive website traffic; the host serves origin content. Make a small service map with account owners and recovery contacts for each provider.

When enabling a CDN, follow its current instructions for the apex and `www` names. Some providers use CNAME records, some offer apex aliasing or flattening, and some request nameserver delegation. Record existing email and verification entries before changing nameservers. Do not assume that changing the CDN setting also migrates your mail or website files.

## Common setup mistakes

- **Changing nameservers before copying the zone.** This can interrupt the website, mail, and verification records.
- **Leaving origin access open unintentionally.** If the CDN is meant to be the only path, review firewall and origin access settings.
- **Caching personalized responses.** Test cookies, authorization headers, and cache keys.
- **Misconfiguring TLS between CDN and origin.** HTTPS from browser to CDN does not automatically prove the CDN-to-origin connection is secured.
- **Purging cache instead of fixing deployment.** A purge cannot correct a broken origin or wrong DNS record.
- **Treating CDN as a backup.** A CDN may improve delivery but does not replace application backups and recovery planning.

## A deployment checklist

Document the path from domain to resolver to CDN to origin. Verify the correct DNS records, HTTPS certificate at every relevant endpoint, origin health, cache rules, redirect behavior, and logs. Test a normal page, a non-cacheable route, a missing page, and a deployment rollback. Include a way to bypass or disable the CDN safely during an incident if your architecture supports it.

### Frequently asked questions

**Do I need a CDN for a small website?** Not necessarily. Start with the site’s audience, performance, security, and operational needs. Use the simplest architecture that meets them.

**Is a CDN the same as web hosting?** No. A CDN can cache or proxy content, while the origin host stores or runs the application. Some products bundle both.

**Does a CDN change my domain registration?** No. It may require DNS changes, but registrar ownership remains separate unless you transfer the registration.

**Will a CDN make every page faster?** No. Results depend on cacheability, location, origin performance, and configuration. Measure real pages.

**Can I use email with a CDN?** Yes, but email uses its own DNS records and mail services. Preserve MX and relevant TXT records when changing DNS.

For HTTP cache behavior, see [RFC 9111](https://www.rfc-editor.org/rfc/rfc9111). For exact cache, DNS, and origin settings, check the current documentation of the CDN and host you select.