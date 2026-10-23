# Website Disaster Recovery: Backups, Failover, RTO, RPO and Recovery Testing

A website disaster is not limited to a data center outage. A failed deployment, accidental deletion, compromised credential, broken DNS change, lost encryption key, or unavailable third-party provider can also interrupt service. A disaster recovery plan describes how the team will restore critical functions and data after a serious disruption. It should be small enough to use during pressure and specific enough that someone can follow it without relying on one person’s memory.

> **Quick answer:** Backups are recoverable copies, replication keeps another system up to date, and failover directs service to a standby component. Recovery Time Objective (RTO) is the target time to restore a service; Recovery Point Objective (RPO) is the maximum acceptable data loss measured in time. Define these targets for real user needs, back up data and configuration, and test restoration—not just backup creation.

## Backup, replication, and failover are not the same

A **backup** is a retained copy that can be used to restore data or configuration. It may be a database snapshot, export, object version, or encrypted archive. A backup should be protected from the same credentials and failure modes that could damage production. If a compromised administrator can delete both the live database and every backup, the backup strategy has a gap.

**Replication** copies changes from a primary system to another system. It can support availability or read capacity, but it may copy an accidental deletion, corrupted record, or malicious update. Replication is not automatically a historical backup. A system may need both replication for continuity and versioned backups for recovery.

**Failover** switches traffic or work to a standby service when the primary is unavailable. It can be automatic or manual. Failover is only useful when the standby has the necessary data, credentials, configuration, capacity, and network path. A planned failover should include how to return to the primary and avoid split-brain writes, where two systems accept conflicting changes.

| Mechanism | Main purpose | Important limitation |
|---|---|---|
| Backup | Restore an earlier data or configuration state | Must be retained, protected, and tested |
| Replication | Keep another copy current for availability or reads | May copy corruption or deletion |
| Failover | Route service to a standby component | Standby may be stale, under-sized, or misconfigured |

## Set RTO and RPO from business needs

**RTO** is the target maximum time to restore a service after an outage. **RPO** is the target maximum amount of recent data the organization can afford to lose, expressed as a time interval. A tool that publishes static educational pages may tolerate a longer restore than a service handling time-sensitive account changes. A saved-search database may need a different RPO from a user-uploaded export.

These targets are decisions, not promises created by a dashboard. A five-minute RTO may require a tested standby, automation, staffed response, and extra cost. A near-zero RPO may require synchronous replication or frequent backups with trade-offs in latency and availability. Choose targets based on the consequences of downtime and data loss, and write down the assumptions.

For each critical service, record:

- The service owner and recovery contact.
- The RTO and RPO, and who approved them.
- Which data and configuration must be restored together.
- Where backups are stored and which identity can access them.
- The exact restore procedure and required keys or credentials.
- How users will be informed during an incident.
- How success will be checked before reopening the service.

## Back up more than the database

A recovery plan can fail even when the database backup is intact. A website may also need source code, build artifacts, DNS zone settings, environment configuration, feature flags, encryption keys, uploaded files, email templates, identity-provider configuration, and a list of external providers. Some items should be reconstructed from version control; others need protected exports.

Separate data by recovery need. For example, public static pages can often be rebuilt from source, while user account records and saved searches may need frequent backups. Uploaded files need a copy independent of the production storage account. Configuration should be versioned where safe, but secrets should remain in a protected store with a documented re-creation or rotation process.

Use encryption in transit and at rest where appropriate. Restrict backup access, audit restores, set retention, and avoid placing raw customer exports in a developer’s personal folder. A backup’s encryption key must be recoverable by an authorized person; a perfectly encrypted archive with a lost key is not a usable backup.

## A practical recovery sequence

A small web tool might use static hosting, a database for accounts and saved searches, object storage for exports, and an external domain-data provider. A recovery runbook can start with these steps:

1. **Declare the incident.** Identify the affected service, start time, suspected cause, and incident lead.
2. **Protect users and evidence.** Disable a compromised function or credential, preserve relevant logs, and avoid destructive cleanup.
3. **Choose the recovery path.** Repair the primary, restore a backup, or activate a tested standby based on impact and RTO.
4. **Restore in dependency order.** Re-establish identity and secrets, network and DNS, database, object storage, and application deployment as needed.
5. **Validate data and behavior.** Check record counts or known samples, permissions, critical workflows, error rates, and dependencies.
6. **Reopen gradually.** Route a limited amount of traffic where possible, watch alerts, and confirm users can complete essential tasks.
7. **Communicate.** Provide an accurate status and next update time without speculating about the cause.
8. **Review and improve.** Record what worked, what failed, and which control or runbook needs an owner.

These are planning steps, not a universal order. The incident lead should adapt them to the actual dependencies and security requirements. If data may have been exposed, follow the organization’s legal, contractual, and regulatory notification process with qualified advice.

## Test recovery, not just backup jobs

A successful backup job proves that a process wrote data somewhere. It does not prove that the data is complete, decryptable, compatible with the application, or restorable within the RTO. Schedule restore tests into an isolated environment. Verify representative records, ownership relationships, files, configuration, and application behavior. Record duration and problems, then update the plan.

Test different failure modes: a deleted record, a lost environment, a corrupted deployment, a revoked credential, an unavailable provider, and a DNS mistake. A tabletop exercise can test communication and decision-making without disrupting production. A technical failover exercise should have a safe scope, observers, a stop condition, and a tested rollback.

A backup monitoring checklist should verify:

- The expected job completed and its output is readable.
- The copy exists in a separate failure domain or account where practical.
- Retention and deletion policies match the recovery plan.
- Encryption keys and restore credentials are accessible to authorized responders.
- Restore time and recovered data point meet the approved objectives.
- Alerts reach a monitored owner when a backup or restore fails.

## Communicate during recovery

Users need to know what is unavailable, whether their data may be affected, what action they should take, and when the next update will arrive. Do not state that no data was lost or exposed until the investigation supports that conclusion. If a third-party provider is the cause, distinguish confirmed information from assumptions and link to the provider’s official status updates where appropriate.

Keep a contact tree that does not depend entirely on the production email system. Identify the incident lead, technical owner, customer-support contact, hosting provider, domain registrar, and legal or privacy adviser as relevant. Review access to emergency credentials periodically and record who can approve a failover or restore.

## A realistic plan for a small website

A small static site might store source in version control, publish immutable build artifacts, maintain an external copy of DNS and hosting configuration, and test a redeploy to a clean environment. If it adds accounts, it should create encrypted database backups and test restoring them. If it accepts uploads, it needs a separate backup and access policy for those files. The service may not need an expensive multi-region standby, but it still needs an owner, a recovery path, and a tested copy of important data.

For a domain lookup product, the third-party data provider may be outside the site owner’s recovery control. The interface should degrade safely: show that results are unavailable, preserve user data if appropriate, and avoid returning stale records as fresh. Maintain an alternative communication path and know how provider credentials can be rotated if compromised.

## Separate backups from the failure they are meant to survive

A backup stored in the same cloud account with the same administrator credentials as production may be vulnerable to the same compromise. Where practical, use a separate account or role with restricted deletion rights, multi-factor authentication, and an independent audit trail. Keep at least one recovery copy that cannot be modified by the application’s normal runtime identity. For offline or immutable storage, verify the product’s retention and restoration behavior rather than relying on a marketing label.

Back up configuration as well as content. DNS records, identity-provider settings, firewall rules, deployment manifests, environment variable names, and build instructions may be needed to recreate a service. Do not store raw secrets in an unprotected backup. Record how an authorized responder can retrieve or rotate them, and keep that procedure available outside the production system.

## Define service tiers and recovery dependencies

Not every page needs the same recovery target. A public static archive may be restored by redeploying a verified build. Account login, saved searches, payment state, and uploaded files may need separate RTO and RPO targets. Map the order in which dependencies must return: identity, network, data, application, DNS, then external integrations may be one path, but another system may require a different sequence.

A provider outage might not be recoverable by the site owner. Identify which features can operate without the provider, what message users will see, and whether a manual alternative exists. Do not claim that an alternate source is equivalent until it has been validated. A clear degraded mode can be safer than returning stale or unverified information.

## Exercise decisions as well as commands

A recovery test should include the human decisions that precede technical work: who declares an incident, who approves a failover, which user groups need an update, and who can authorize a restore that may overwrite newer data. Keep a simple decision log during the exercise. Afterward, compare actual restore time and recovered data with the approved RTO and RPO, and revise the target or investment if the plan cannot meet it.

Test one scenario at a time before running a complex multi-region failover. Use a non-production environment and define a stop condition. A successful exercise ends with proof that the application can serve a critical task, not merely that a backup file exists. Record follow-up tasks with owners and dates so the next test can verify that the gaps were closed.

## Keep a recovery contact outside the main system

Store runbooks, emergency contacts, and recovery credentials in a protected location that remains available if the main website, email provider, or identity system is unavailable. Limit access, require strong authentication, and review the list after staff changes. A paper or offline copy may be appropriate for a critical recovery key, but it needs secure physical storage and a process for updates.

### Frequently asked questions

**Does replication replace backups?** No. Replication can reproduce unwanted changes. Keep recoverable historical copies and test them.

**What is a good RTO or RPO?** It depends on the service’s impact and resources. Set a justified target and verify that the technical design can meet it.

**How often should I test a restore?** Often enough to maintain confidence and meet policy or legal obligations. The schedule should reflect how quickly data and dependencies change.

**Is a cloud provider’s durability guarantee a recovery plan?** No. Durability, regional availability, accidental deletion, account compromise, and application recovery are different concerns.

**What if a provider is down?** Communicate the affected feature, stop unsafe retries, use a tested alternative if one exists, and do not claim that an unverified result is current.

## Conclusion

Disaster recovery combines protected copies, tested restoration, safe failover, and clear communication. Define RTO and RPO according to user impact, inventory data and configuration, isolate backup credentials, and practice restoring to a clean environment. A small team does not need a complex plan, but it does need to know what it will do when the normal path stops working.