import type { SqlDriver } from './types.js';
import { migrate } from './migrate.js';
import { SettingsRepo } from './settingsRepo.js';
import { CharactersRepo } from './charactersRepo.js';
import { ConversationsRepo } from './conversationsRepo.js';
import { MemoryRepo } from './memoryRepo.js';
import { SkillsRepo } from './skillsRepo.js';
import { TasksRepo } from './tasksRepo.js';
import { DocumentsRepo } from './documentsRepo.js';
import { CredentialsRepo } from './credentialsRepo.js';
import { UsageRepo } from './usageRepo.js';
import { AuditRepo } from './auditRepo.js';
import { LicenseRepo } from './licenseRepo.js';

/** Aggregated, typed data layer. One instance per process/connection. */
export class Db {
  readonly settings: SettingsRepo;
  readonly characters: CharactersRepo;
  readonly conversations: ConversationsRepo;
  readonly memories: MemoryRepo;
  readonly skills: SkillsRepo;
  readonly tasks: TasksRepo;
  readonly documents: DocumentsRepo;
  readonly credentials: CredentialsRepo;
  readonly usage: UsageRepo;
  readonly audit: AuditRepo;
  readonly license: LicenseRepo;

  constructor(readonly driver: SqlDriver) {
    this.settings = new SettingsRepo(driver);
    this.characters = new CharactersRepo(driver);
    this.conversations = new ConversationsRepo(driver);
    this.memories = new MemoryRepo(driver);
    this.skills = new SkillsRepo(driver);
    this.tasks = new TasksRepo(driver);
    this.documents = new DocumentsRepo(driver);
    this.credentials = new CredentialsRepo(driver);
    this.usage = new UsageRepo(driver);
    this.audit = new AuditRepo(driver);
    this.license = new LicenseRepo(driver);
  }

  migrate(): number {
    return migrate(this.driver).currentVersion;
  }

  close(): void {
    this.driver.close();
  }
}
