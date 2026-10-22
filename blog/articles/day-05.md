# How to Transfer a Domain Between Registrars Without Losing Control

A registrar transfer moves management of a domain registration from one registrar to another. It is different from changing DNS records, changing a website host, or moving email. A careful transfer preserves the name’s management while keeping the services that depend on it working.

> **Quick answer:** confirm eligibility and transfer rules for the extension, save the current DNS zone, unlock the domain if required, obtain the authorization code through the current registrar, and complete the receiving registrar’s steps. Do not start until the destination account and contacts are ready.

## Transfer, DNS change, or hosting migration?

| Action | What changes | What may remain the same |
|---|---|---|
| Registrar transfer | The company that manages the registration | DNS provider, nameservers, website host, and email can often remain as configured. |
| Nameserver change | Which DNS servers are authoritative | The registrar may remain unchanged. The new DNS zone must contain required records. |
| DNS record edit | One or more service destinations or policies | The registrar and nameserver delegation can stay the same. |
| Hosting migration | Where website files or application run | Registration and email can remain with their current providers. |

People often combine these tasks, which increases risk. If possible, change one layer at a time and test it before moving the next.

## Before starting

Write down the exact domain and extension, the current registrar, the destination registrar, the registrant/contact details, and the expiration date shown in the account. Check whether the name is eligible to transfer. Policies can restrict transfers in certain circumstances, such as shortly after registration or a previous transfer, or while a dispute or administrative hold is in place. The specific rules differ by TLD and may change, so check current registrar and registry instructions rather than relying on an old fixed waiting-period claim.

Export or copy the DNS zone. Record nameservers, A/AAAA, CNAME, MX, TXT, SRV, CAA, and any other records used by the site, mail, verification, or subdomains. Take screenshots or export a zone file if the provider supports it. Confirm whether the receiving registrar will host DNS and whether an import is required. A registrar transfer does not automatically copy every DNS record.

Check the renewal price, transfer charge, term extension behavior, taxes, and the effect of transfer on privacy or DNS hosting. Keep the current registrar account open until the transfer is complete and the destination account shows the correct registration.

## Typical transfer workflow

1. **Prepare the destination account.** Create an account controlled by the correct person or organization. Add a monitored email and strong authentication.
2. **Verify registrant details.** Correct outdated contacts and ensure you can receive required approval messages. Do not change ownership casually during the same operation unless necessary; policy may treat it separately.
3. **Unlock the domain if required.** Some registrars provide a transfer lock. Follow the current instructions and confirm the status in the account.
4. **Request the authorization code.** It may be called an EPP code, transfer code, or auth code. Obtain it through the official registrar account or verified support channel. Never send it to an unsolicited caller.
5. **Start the transfer at the receiving registrar.** Enter the exact domain and code, review fees, and follow its verification steps.
6. **Approve required messages.** Watch the registered contact inbox and the registrar dashboard. Approval procedures differ; follow the official instructions for this extension.
7. **Monitor the transfer.** Keep the source account and contact channels active until the receiving registrar confirms completion.
8. **Verify after completion.** Confirm registrant, expiry/renewal details, DNS delegation, privacy settings, website, and email.

A transfer may be rejected or paused for an invalid code, a lock, an ineligible status, incomplete verification, or a registry policy condition. Read the error carefully and contact the provider using a known official support route.

## Avoiding downtime

If the current nameservers will remain authoritative, a registrar transfer often does not require changing the DNS zone. Still, verify that the receiving registrar does not automatically replace nameservers or move hosting. If you intend to switch DNS at the same time, prepare the full new zone first, confirm mail records, and test after delegation changes. Lowering TTL can be part of a planned migration, but it is not a universal cure and should be done in advance where appropriate.

For email, retain MX and required TXT records such as sender-authentication policies. For a website, verify the root name and `www` or other subdomains. Monitor certificates and redirects after the change. Keep a rollback plan that describes who can restore the old nameserver setup.

## Common transfer problems

- **Using a code from an old request:** request a fresh code through the current registrar if the previous one expired or was invalidated.
- **Confusing transfer with ownership change:** a registrar transfer changes the provider; registrant changes are a separate operation.
- **Changing nameservers unintentionally:** compare before-and-after delegation and restore the intended values if the provider changed them.
- **Ignoring email notices:** missing a required confirmation can delay or prevent completion.
- **Starting near expiration:** the transfer process may take time or be blocked by policy. Resolve renewal status first and ask both providers about the safest sequence.
- **Sharing the auth code insecurely:** treat it as a credential and send it only through verified channels.

### Transfer checklist

Before: confirm eligibility, price, account owner, contact email, current DNS records, nameservers, and renewal status. During: use the official accounts, protect the authorization code, and monitor approvals. After: verify registrar, registrant, nameservers, records, website, email, privacy, and billing.

### Frequently asked questions

**Will a registrar transfer take my website offline?** Not necessarily. A transfer can leave DNS unchanged, but provider defaults or simultaneous DNS edits can cause disruption. Verify the nameserver plan.

**Will my DNS records move automatically?** Do not assume so. Determine who hosts DNS and whether the receiving registrar imports the zone.

**Can I transfer any domain at any time?** No. Eligibility depends on extension rules and the domain’s current status. Check official instructions.

**Does the transfer code prove I own the domain?** It is an authorization credential for a transfer workflow, not a substitute for account security or legal proof of rights.

**Should I transfer and change hosting together?** Usually it is easier to separate changes, unless there is a clear operational reason to combine them and a tested migration plan.

Use the current registrar and registry guidance for your TLD. Policies and transfer interfaces can change; this article avoids promising a universal number of days.